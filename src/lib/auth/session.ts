import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { config } from '@/lib/config';
import { query, queryOne } from '@/lib/db/client';

/**
 * Session management.
 *
 * Sessions are opaque random tokens. Only their SHA-256 is stored, so a
 * database leak yields no usable sessions. The cookie is httpOnly, Secure in
 * production and SameSite=Lax, which blocks the CSRF paths that matter while
 * keeping normal top-level navigation working.
 */

const TOKEN_BYTES = 32;

export interface SessionUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  plan: 'free' | 'pro' | 'premium' | 'enterprise';
  status: 'active' | 'suspended' | 'deleted';
}

export interface AuthenticatedSession {
  sessionId: string;
  user: SessionUser;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Hash of the client IP, so rate limiting and audit work without storing IPs. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${config.auth.secret}:${ip}`).digest('hex').slice(0, 32);
}

export interface CreateSessionInput {
  userId: string;
  userAgent?: string | null;
  ip?: string | null;
}

/** Issue a session and set the cookie. Returns the raw token for tests. */
export async function createSession(input: CreateSessionInput): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + config.auth.sessionTtlDays * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.userId,
      hashToken(token),
      input.userAgent?.slice(0, 400) ?? null,
      hashIp(input.ip ?? null),
      expiresAt,
    ],
  );

  const cookieStore = await cookies();
  cookieStore.set(config.auth.cookieName, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return token;
}

/**
 * Resolve the current session from the request cookie.
 *
 * Returns null for expired, revoked or unknown tokens, and for users whose
 * account is no longer active — a suspension takes effect immediately rather
 * than at the next login.
 */
export async function getSession(): Promise<AuthenticatedSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(config.auth.cookieName)?.value;
  if (!token) return null;
  return resolveSessionToken(token);
}

/** Session lookup by raw token, usable outside a cookie context. */
export async function resolveSessionToken(token: string): Promise<AuthenticatedSession | null> {
  const row = await queryOne<{
    session_id: string;
    user_id: string;
    email: string;
    role: SessionUser['role'];
    plan: SessionUser['plan'];
    status: SessionUser['status'];
    last_seen_at: Date;
  }>(
    `SELECT s.id AS session_id, u.id AS user_id, u.email, u.role, u.plan, u.status, s.last_seen_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.status = 'active'`,
    [hashToken(token)],
  );

  if (!row) return null;

  // Refresh last_seen_at at most hourly: session activity is useful for the
  // admin view but not worth a write on every request.
  const hourAgo = Date.now() - 60 * 60 * 1000;
  if (row.last_seen_at.getTime() < hourAgo) {
    void query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]).catch(
      () => {},
    );
  }

  return {
    sessionId: row.session_id,
    user: {
      id: row.user_id,
      email: row.email,
      role: row.role,
      plan: row.plan,
      status: row.status,
    },
  };
}

/** Revoke the current session and clear the cookie. */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(config.auth.cookieName)?.value;

  if (token) {
    await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [hashToken(token)]);
  }
  cookieStore.delete(config.auth.cookieName);
}

/** Revoke every session for a user — used on password change. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
    userId,
  ]);
}

/** Remove expired rows. Called opportunistically; safe to run concurrently. */
export async function pruneExpiredSessions(): Promise<number> {
  const rows = await query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM sessions
        WHERE expires_at < now() - interval '7 days'
        RETURNING 1
     ) SELECT count(*)::text AS count FROM deleted`,
  );
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}

/**
 * Constant-time string comparison for tokens supplied by a client.
 *
 * Used where a secret is compared outside the database, so that a timing
 * difference cannot reveal a prefix.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
