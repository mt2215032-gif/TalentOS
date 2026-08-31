import { afterAll, beforeAll } from 'vitest';
import { closePool, query } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrate';

/**
 * API test harness.
 *
 * Runs against a real PostgreSQL database, because the things worth testing
 * here — transactional writes, unique constraints, atomic quota increments,
 * user-scoped queries — are exactly the things a mocked database cannot check.
 *
 * TEST_DATABASE_URL must point at a database that can be wiped.
 */

beforeAll(async () => {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. API tests need a disposable PostgreSQL database.',
    );
  }
  process.env['DATABASE_URL'] = url;
  process.env['AI_PROVIDER'] = 'none';
  process.env['RATE_LIMIT_BACKEND'] = 'memory';

  await query('DROP SCHEMA IF EXISTS public CASCADE');
  await query('CREATE SCHEMA public');
  await runMigrations();
}, 60_000);

afterAll(async () => {
  await closePool();
});

/** Remove all rows between test files without re-running migrations. */
export async function truncateAll(): Promise<void> {
  await query(`
    TRUNCATE users, sessions, auth_identities, resumes, jobs, interviews,
             ai_usage_events, analytics_events, error_log, rate_limits, usage_counters
    RESTART IDENTITY CASCADE
  `);
}
