import { afterAll, beforeAll } from 'vitest';
import { config } from '@/lib/config';
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
  // vitest.config.mts injects DATABASE_URL from TEST_DATABASE_URL before any
  // module loads. Verify it landed rather than trusting it: this suite drops a
  // schema, and doing that to the wrong database would be unrecoverable.
  const url = config.database.url;

  if (!process.env['TEST_DATABASE_URL']) {
    throw new Error(
      'TEST_DATABASE_URL is not set. API tests need a disposable PostgreSQL database.',
    );
  }
  if (url !== process.env['TEST_DATABASE_URL']) {
    throw new Error(
      'The database client is not pointed at TEST_DATABASE_URL. Refusing to drop a schema that ' +
        'may belong to a development or production database.',
    );
  }
  if (!/test/i.test(url)) {
    throw new Error(
      `Refusing to run destructive tests against "${url.replace(/:[^:@]*@/, ':***@')}" — ` +
        'the database name must contain "test".',
    );
  }

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
