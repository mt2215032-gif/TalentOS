import { query, queryOne, transaction } from '@/lib/db/client';
import { config } from '@/lib/config';
import { hashPassword } from '@/lib/auth/password';
import { conflict } from '@/lib/security/errors';

/**
 * User and profile persistence.
 *
 * Every function takes the acting user's id explicitly. There is no ambient
 * "current user" in the data layer, which is what makes it impossible to write
 * a query that forgets to scope itself.
 */

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string | null;
  role: 'user' | 'admin';
  plan: 'free' | 'pro' | 'premium' | 'enterprise';
  status: 'active' | 'suspended' | 'deleted';
  email_verified_at: Date | null;
  last_login_at: Date | null;
  created_at: Date;
}

export interface ProfileRecord {
  user_id: string;
  full_name: string | null;
  headline: string | null;
  location: string | null;
  phone: string | null;
  links: Record<string, string>;
  years_experience: string | null;
  seniority: string | null;
  target_role: string | null;
  target_industry: string | null;
  onboarding_done_at: Date | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  return queryOne<UserRecord>('SELECT * FROM users WHERE lower(email) = lower($1)', [
    normalizeEmail(email),
  ]);
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  return queryOne<UserRecord>('SELECT * FROM users WHERE id = $1', [id]);
}

export interface CreateUserInput {
  email: string;
  password: string;
  fullName?: string | null;
}

/**
 * Register a user and their profile atomically.
 *
 * Admin rights come from the ADMIN_EMAILS allowlist, never from anything the
 * client sends.
 */
export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const role = config.auth.adminEmails.includes(email) ? 'admin' : 'user';

  return transaction(async (tx) => {
    const existing = await tx.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (existing.rowCount && existing.rowCount > 0) {
      throw conflict('An account with that email already exists.');
    }

    const { rows } = await tx.query<UserRecord>(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING *`,
      [email, passwordHash, role],
    );
    const user = rows[0];
    if (!user) throw new Error('User insert returned no row.');

    await tx.query('INSERT INTO profiles (user_id, full_name) VALUES ($1, $2)', [
      user.id,
      input.fullName?.trim() || null,
    ]);

    return user;
  });
}

export async function markLogin(userId: string): Promise<void> {
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
}

export async function updatePassword(userId: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}

export async function getProfile(userId: string): Promise<ProfileRecord | null> {
  return queryOne<ProfileRecord>('SELECT * FROM profiles WHERE user_id = $1', [userId]);
}

export interface ProfileUpdate {
  fullName?: string | null;
  headline?: string | null;
  location?: string | null;
  phone?: string | null;
  links?: Record<string, string>;
  yearsExperience?: number | null;
  seniority?: string | null;
  targetRole?: string | null;
  targetIndustry?: string | null;
  onboardingDone?: boolean;
}

/**
 * Patch a profile.
 *
 * Only keys present in the update are written, so a partial form submission
 * cannot blank out fields the user did not touch.
 */
export async function updateProfile(userId: string, update: ProfileUpdate): Promise<ProfileRecord> {
  const columns: Record<string, unknown> = {};
  if ('fullName' in update) columns['full_name'] = update.fullName;
  if ('headline' in update) columns['headline'] = update.headline;
  if ('location' in update) columns['location'] = update.location;
  if ('phone' in update) columns['phone'] = update.phone;
  if ('links' in update) columns['links'] = JSON.stringify(update.links ?? {});
  if ('yearsExperience' in update) columns['years_experience'] = update.yearsExperience;
  if ('seniority' in update) columns['seniority'] = update.seniority;
  if ('targetRole' in update) columns['target_role'] = update.targetRole;
  if ('targetIndustry' in update) columns['target_industry'] = update.targetIndustry;
  if (update.onboardingDone) columns['onboarding_done_at'] = new Date();

  const keys = Object.keys(columns);
  if (keys.length === 0) {
    const existing = await getProfile(userId);
    if (!existing) throw new Error('Profile not found.');
    return existing;
  }

  // Column names come from the fixed map above, never from user input.
  const assignments = keys.map((key, index) => `${key} = $${index + 2}`).join(', ');
  const row = await queryOne<ProfileRecord>(
    `UPDATE profiles SET ${assignments} WHERE user_id = $1 RETURNING *`,
    [userId, ...keys.map((key) => columns[key])],
  );
  if (!row) throw new Error('Profile not found.');
  return row;
}

/** Admin listing. Exposes no password hashes and no candidate content. */
export interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  plan: string;
  status: string;
  created_at: Date;
  last_login_at: Date | null;
  interview_count: string;
  avg_score: string | null;
}

export async function listUsersForAdmin(limit = 50, offset = 0): Promise<AdminUserRow[]> {
  return query<AdminUserRow>(
    `SELECT u.id, u.email, u.role, u.plan, u.status, u.created_at, u.last_login_at,
            count(DISTINCT i.id)::text AS interview_count,
            round(avg(e.overall_score), 1)::text AS avg_score
       FROM users u
       LEFT JOIN interviews i ON i.user_id = u.id
       LEFT JOIN evaluations e ON e.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2`,
    [Math.min(limit, 200), Math.max(offset, 0)],
  );
}
