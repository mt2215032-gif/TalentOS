import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getPool } from '@/lib/db/client';

/**
 * Forward-only SQL migration runner.
 *
 * Files in db/migrations are applied in filename order, once each, inside a
 * transaction. The recorded checksum makes silent edits to an already-applied
 * migration an error rather than a drift that only shows up in production.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

async function ensureMigrationsTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations(
  options: { log?: (message: string) => void } = {},
): Promise<MigrationResult> {
  const log = options.log ?? (() => {});
  await ensureMigrationsTable();

  const entries = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const { rows: applied } = await getPool().query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migrations',
  );
  const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]));

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const name of entries) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = appliedByName.get(name);

    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `Migration ${name} has changed since it was applied. ` +
            `Migrations are immutable — add a new migration instead of editing this one.`,
        );
      }
      result.skipped.push(name);
      continue;
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        name,
        checksum,
      ]);
      await client.query('COMMIT');
      log(`applied ${name}`);
      result.applied.push(name);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(
        `Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      client.release();
    }
  }

  return result;
}
