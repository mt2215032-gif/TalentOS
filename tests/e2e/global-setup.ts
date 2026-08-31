import { Client } from 'pg';

/**
 * E2E global setup.
 *
 * Clears the rate-limit table so a suite that registers several accounts from
 * one address is not throttled by a limit that exists for real traffic. It
 * touches nothing else — the tests create and verify their own data.
 */
export default async function globalSetup(): Promise<void> {
  const connectionString =
    process.env['E2E_DATABASE_URL'] ?? process.env['DATABASE_URL'];

  // Against a remote deployment there is no database to reach; the suite still
  // runs, it just cannot pre-clear limits.
  if (!connectionString) return;

  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query('DELETE FROM rate_limits');
  } catch {
    // A missing table simply means migrations have not run against this
    // database yet; the tests themselves will report that far more clearly.
  } finally {
    await client.end().catch(() => {});
  }
}
