import { ZodError } from 'zod';
import { AiError } from '@/lib/ai/types';

/**
 * The application's error contract.
 *
 * Handlers throw `AppError`; one helper turns anything thrown into a safe HTTP
 * response. Unrecognised errors always become a generic 500 — stack traces,
 * SQL text and provider messages never reach a client.
 */

export type AppErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'ai_unavailable'
  | 'internal_error';

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  quota_exceeded: 402,
  ai_unavailable: 503,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** Field-level messages, safe to render next to form inputs. */
  readonly fields?: Record<string, string>;
  readonly retryAfterSeconds?: number;
  override readonly cause?: unknown;

  constructor(
    code: AppErrorCode,
    message: string,
    options: {
      fields?: Record<string, string>;
      retryAfterSeconds?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (options.fields) this.fields = options.fields;
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
    this.cause = options.cause;
  }
}

export const unauthorized = (message = 'You need to sign in to do that.'): AppError =>
  new AppError('unauthorized', message);

export const forbidden = (message = 'You do not have access to this resource.'): AppError =>
  new AppError('forbidden', message);

export const notFound = (what = 'resource'): AppError =>
  new AppError('not_found', `That ${what} does not exist, or is not yours.`);

export const conflict = (message: string): AppError => new AppError('conflict', message);

export const badRequest = (message: string, fields?: Record<string, string>): AppError =>
  new AppError('bad_request', message, fields ? { fields } : {});

export interface ErrorPayload {
  error: {
    code: AppErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
}

export interface NormalizedError {
  status: number;
  payload: ErrorPayload;
  retryAfterSeconds?: number;
  /** Full detail for the server log, never sent to the client. */
  logDetail: string;
}

/**
 * Turn anything thrown into a safe response plus a loggable detail.
 *
 * This is the single place that decides what a client is allowed to learn about
 * a failure.
 */
export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof AppError) {
    return {
      status: error.status,
      payload: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      },
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
      logDetail: `${error.code}: ${error.message}${error.cause ? ` (cause: ${describeCause(error.cause)})` : ''}`,
    };
  }

  if (error instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.') || '_';
      // Keep the first message per field: a list of five messages for one input
      // is noise in a form.
      if (!fields[path]) fields[path] = issue.message;
    }
    return {
      status: 422,
      payload: {
        error: {
          code: 'validation_failed',
          message: 'Some of the values you submitted are not valid.',
          fields,
        },
      },
      logDetail: `validation_failed: ${error.issues.map((i) => `${i.path.join('.')}=${i.message}`).join('; ')}`,
    };
  }

  if (error instanceof AiError) {
    return {
      status: error.kind === 'rate_limit' ? 429 : 503,
      payload: {
        error: {
          code: error.kind === 'rate_limit' ? 'rate_limited' : 'ai_unavailable',
          // AiError.userMessage is written to be safe for candidates.
          message: error.userMessage,
        },
      },
      logDetail: `ai_${error.kind} (${error.provider}): ${error.message}`,
    };
  }

  return {
    status: 500,
    payload: {
      error: {
        code: 'internal_error',
        message: 'Something went wrong on our side. Please try again.',
      },
    },
    logDetail: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error),
  };
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  return String(cause);
}
