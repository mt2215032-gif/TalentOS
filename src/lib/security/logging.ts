import { config } from '@/lib/config';
import { query } from '@/lib/db/client';

/**
 * Structured logging.
 *
 * Errors are written to both stderr (for the platform's log drain) and the
 * error_log table (for the admin dashboard). Writing a log row must never fail
 * the request that produced it.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

function shouldLog(level: keyof typeof LEVELS): boolean {
  return LEVELS[level] >= LEVELS[config.logLevel];
}

export function log(
  level: keyof typeof LEVELS,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  if (!shouldLog(level)) return;
  const entry = JSON.stringify({ level, message, ts: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.log(entry);
}

export interface ErrorLogInput {
  scope: string;
  code: string;
  message: string;
  userId?: string;
  context?: Record<string, unknown>;
}

export async function logError(input: ErrorLogInput): Promise<void> {
  log('error', input.message, { scope: input.scope, code: input.code });

  try {
    await query(
      `INSERT INTO error_log (user_id, scope, code, message, context)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.userId ?? null,
        input.scope.slice(0, 200),
        input.code.slice(0, 100),
        // Truncated so a stack trace cannot bloat the table.
        input.message.slice(0, 4000),
        JSON.stringify(input.context ?? {}),
      ],
    );
  } catch {
    // Already reported to stderr above; swallowing keeps the request alive.
  }
}
