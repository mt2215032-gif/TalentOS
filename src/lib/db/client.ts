import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '@/lib/config';

/**
 * PostgreSQL access.
 *
 * A single pool is shared per process. On serverless platforms each instance
 * gets its own small pool (DATABASE_POOL_MAX), which is why the default is 5
 * rather than the driver's 10 — a burst of cold starts must not exhaust the
 * database's connection budget.
 */

declare global {
  // Next.js dev mode re-imports modules on every edit; without this the process
  // would accumulate one pool per reload until Postgres refuses connections.
  // eslint-disable-next-line no-var
  var __talentosPool: Pool | undefined;
}

function createPool(): Pool {
  const pool = new Pool({
    connectionString: config.database.url,
    max: config.database.poolMax,
    // Managed providers (Supabase, Neon, RDS) terminate TLS with certificates
    // that are not in Node's default trust store when connecting through the
    // pooler host, so verification is relaxed only when SSL is explicitly on.
    ssl: config.database.ssl === 'require' ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Never let a runaway query pin a pooled connection open.
    statement_timeout: 30_000,
  });

  pool.on('error', (error) => {
    // An idle client failing is recoverable — the pool discards it. Log rather
    // than crash the server process.
    console.error('[db] idle client error', error.message);
  });

  return pool;
}

export function getPool(): Pool {
  if (!globalThis.__talentosPool) {
    globalThis.__talentosPool = createPool();
  }
  return globalThis.__talentosPool;
}

/** Run a parameterised query. Never interpolate user input into `text`. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as unknown[]);
  return result.rows;
}

/** Run a query expected to match at most one row. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Run a query that must match exactly one row, throwing otherwise. */
export async function queryExactlyOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T> {
  const row = await queryOne<T>(text, params);
  if (!row) {
    throw new Error('Expected exactly one row, got none.');
  }
  return row;
}

/**
 * Execute `fn` inside a transaction, rolling back on any thrown error.
 *
 * Used wherever a single logical write spans multiple tables — persisting an
 * evaluation together with its skill scores, recommendations and learning plan,
 * for instance, must be all-or-nothing.
 */
export async function transaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already broken; releasing it below discards it.
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Close the shared pool. Used by tests and by graceful shutdown. */
export async function closePool(): Promise<void> {
  const pool = globalThis.__talentosPool;
  if (pool) {
    globalThis.__talentosPool = undefined;
    await pool.end();
  }
}

/** Lightweight connectivity probe for the health endpoint. */
export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'unknown database error',
    };
  }
}
