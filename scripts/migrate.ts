/**
 * CLI entry point: `npm run db:migrate`
 *
 * Applies every pending migration against DATABASE_URL and exits non-zero on
 * failure, so it can gate a deployment.
 */
import { runMigrations } from '@/lib/db/migrate';
import { closePool } from '@/lib/db/client';

async function main(): Promise<void> {
  const result = await runMigrations({ log: (message) => console.log(`  ${message}`) });

  if (result.applied.length === 0) {
    console.log(`Database is up to date (${result.skipped.length} migrations already applied).`);
  } else {
    console.log(`Applied ${result.applied.length} migration(s).`);
  }
}

main()
  .catch((error: unknown) => {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
