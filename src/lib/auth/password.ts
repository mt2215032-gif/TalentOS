import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/**
 * Promisified scrypt.
 *
 * `util.promisify` resolves to the first overload, which has no options
 * parameter, so the cost parameters below would be dropped at the type level.
 * Wrapping it explicitly keeps them.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * Password hashing with scrypt.
 *
 * scrypt is memory-hard and ships with Node, so there is no native build step
 * to break a Vercel deployment. Parameters follow current OWASP guidance for
 * scrypt (N=2^16, r=8, p=1 — roughly 64 MB per hash).
 *
 * The stored format is self-describing, so parameters can be raised later and
 * old hashes still verify: `scrypt$N$r$p$salt$hash`.
 */

const N = 65536;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/** scrypt needs maxmem above 128*N*r; the default 32 MB is not enough at N=2^16. */
const MAX_MEM = 256 * N * R;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Comparison is constant-time. A malformed stored hash returns false rather
 * than throwing, so a corrupted row cannot be used to distinguish accounts.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const n = Number.parseInt(parts[1] ?? '', 10);
    const r = Number.parseInt(parts[2] ?? '', 10);
    const p = Number.parseInt(parts[3] ?? '', 10);
    const salt = Buffer.from(parts[4] ?? '', 'base64');
    const expected = Buffer.from(parts[5] ?? '', 'base64');

    if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
    if (salt.length === 0 || expected.length === 0) return false;

    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: Math.max(MAX_MEM, 256 * n * r),
    });

    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export interface PasswordCheck {
  ok: boolean;
  problems: string[];
}

/**
 * Password policy.
 *
 * Length is the requirement that actually matters, so the floor is 10 rather
 * than a shorter password padded with composition rules. Obvious passwords are
 * rejected outright.
 */
export function checkPasswordStrength(password: string): PasswordCheck {
  const problems: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    problems.push(`Use at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (/^(.)\1+$/.test(password)) {
    problems.push('Use more than one repeated character.');
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    problems.push('This password is too common. Choose something less predictable.');
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9\W_]/.test(password)) {
    problems.push('Mix letters with at least one number or symbol.');
  }

  return { ok: problems.length === 0, problems };
}

/** The handful of passwords that dominate credential-stuffing lists. */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '12345678', '123456789',
  '1234567890', 'qwertyuiop', 'letmein123', 'welcome123', 'admin12345',
  'iloveyou123', 'football123', 'monkey12345', 'abc123456', 'changeme123',
  'talentos123', 'interview123',
]);
