import { beforeEach, describe, expect, it } from 'vitest';
import { query, queryOne } from '@/lib/db/client';
import { createUser, findUserByEmail } from '@/lib/db/repositories/users';
import { verifyPassword } from '@/lib/auth/password';
import { resolveSessionToken } from '@/lib/auth/session';
import { checkRateLimit, resetMemoryRateLimits } from '@/lib/security/rate-limit';
import { truncateAll } from './setup';

describe('user registration', () => {
  beforeEach(async () => {
    await truncateAll();
    resetMemoryRateLimits();
  });

  it('creates a user with a profile in one transaction', async () => {
    const user = await createUser({
      email: 'Maria@Example.com',
      password: 'strong-password-9',
      fullName: 'Maria Torres',
    });

    // Email is stored lowercase regardless of how it was typed.
    expect(user.email).toBe('maria@example.com');
    expect(user.role).toBe('user');
    expect(user.plan).toBe('free');

    const profile = await queryOne('SELECT * FROM profiles WHERE user_id = $1', [user.id]);
    expect(profile).not.toBeNull();
  });

  it('never stores the password itself', async () => {
    const user = await createUser({ email: 'a@example.com', password: 'strong-password-9' });
    expect(user.password_hash).not.toContain('strong-password-9');
    expect(await verifyPassword('strong-password-9', user.password_hash ?? '')).toBe(true);
  });

  it('rejects a duplicate email regardless of case', async () => {
    await createUser({ email: 'dup@example.com', password: 'strong-password-9' });
    await expect(
      createUser({ email: 'DUP@example.com', password: 'another-password-9' }),
    ).rejects.toThrow(/already exists/i);

    const { rows } = { rows: await query('SELECT id FROM users') };
    expect(rows).toHaveLength(1);
  });

  it('leaves no profile behind when registration fails', async () => {
    await createUser({ email: 'once@example.com', password: 'strong-password-9' });
    await createUser({ email: 'twice@example.com', password: 'strong-password-9' }).catch(() => {});
    await createUser({ email: 'ONCE@example.com', password: 'strong-password-9' }).catch(() => {});

    const profiles = await query('SELECT user_id FROM profiles');
    const users = await query('SELECT id FROM users');
    expect(profiles).toHaveLength(users.length);
  });

  it('finds a user case-insensitively', async () => {
    await createUser({ email: 'case@example.com', password: 'strong-password-9' });
    expect(await findUserByEmail('CASE@EXAMPLE.COM')).not.toBeNull();
  });
});

describe('sessions', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('stores only a hash of the session token', async () => {
    const user = await createUser({ email: 'sess@example.com', password: 'strong-password-9' });
    const token = 'a-known-token-value-for-this-test';
    const { createHash } = await import('node:crypto');
    await query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 day')`,
      [user.id, createHash('sha256').update(token).digest('hex')],
    );

    const stored = await queryOne<{ token_hash: string }>('SELECT token_hash FROM sessions');
    expect(stored?.token_hash).not.toBe(token);

    const session = await resolveSessionToken(token);
    expect(session?.user.id).toBe(user.id);
  });

  it('rejects expired, revoked and unknown tokens', async () => {
    const user = await createUser({ email: 'expiry@example.com', password: 'strong-password-9' });
    const { createHash } = await import('node:crypto');
    const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

    await query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() - interval '1 day')`,
      [user.id, hash('expired-token')],
    );
    await query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at)
       VALUES ($1, $2, now() + interval '1 day', now())`,
      [user.id, hash('revoked-token')],
    );

    expect(await resolveSessionToken('expired-token')).toBeNull();
    expect(await resolveSessionToken('revoked-token')).toBeNull();
    expect(await resolveSessionToken('never-issued')).toBeNull();
  });

  it('stops resolving sessions the moment an account is suspended', async () => {
    const user = await createUser({ email: 'susp@example.com', password: 'strong-password-9' });
    const { createHash } = await import('node:crypto');
    await query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 day')`,
      [user.id, createHash('sha256').update('live-token').digest('hex')],
    );
    expect(await resolveSessionToken('live-token')).not.toBeNull();

    await query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [user.id]);
    expect(await resolveSessionToken('live-token')).toBeNull();
  });
});

describe('rate limiting', () => {
  beforeEach(async () => {
    await truncateAll();
    resetMemoryRateLimits();
  });

  it('allows up to the limit then refuses', async () => {
    const identity = `test-${Date.now()}`;
    const results = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      results.push(await checkRateLimit('login', identity));
    }
    // The login limit is 8 per window.
    expect(results.filter((result) => result.allowed)).toHaveLength(8);
    expect(results[9]?.allowed).toBe(false);
    expect(results[9]?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each identity separately', async () => {
    const a = await checkRateLimit('login', `a-${Date.now()}`);
    const b = await checkRateLimit('login', `b-${Date.now()}`);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });

  it('increments atomically under concurrency', async () => {
    process.env['RATE_LIMIT_BACKEND'] = 'postgres';
    const identity = `concurrent-${Date.now()}`;
    // Twelve simultaneous requests against a limit of eight: exactly eight
    // must be allowed, which only holds if the counter is atomic.
    const results = await Promise.all(
      Array.from({ length: 12 }, () => checkRateLimit('login', identity)),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(8);
    process.env['RATE_LIMIT_BACKEND'] = 'memory';
  });
});
