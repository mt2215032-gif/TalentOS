import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { getSession, hashIp, type AuthenticatedSession, type SessionUser } from '@/lib/auth/session';
import { checkRateLimit, type RateLimitName } from '@/lib/security/rate-limit';
import { AppError, forbidden, normalizeError, unauthorized } from '@/lib/security/errors';
import { logError } from '@/lib/security/logging';

/**
 * Request pipeline for every API route.
 *
 * Wrapping handlers here means authentication, rate limiting, body validation
 * and error shaping cannot be forgotten on a new endpoint — the type system
 * requires the handler to declare what it needs.
 */

export interface RouteContext<TBody> {
  request: NextRequest;
  body: TBody;
  params: Record<string, string>;
}

export interface AuthedRouteContext<TBody> extends RouteContext<TBody> {
  user: SessionUser;
  session: AuthenticatedSession;
}

interface BaseOptions {
  rateLimit?: RateLimitName;
}

interface HandlerOptions<TSchema extends z.ZodType | undefined> extends BaseOptions {
  /** Zod schema for the JSON body. Omit for GET/DELETE. */
  schema?: TSchema;
  /** Require an authenticated admin. Implies authentication. */
  adminOnly?: boolean;
}

type Body<TSchema> = TSchema extends z.ZodType ? z.infer<TSchema> : undefined;

/**
 * Client identity for rate limiting.
 *
 * Prefers the authenticated user id; falls back to a hashed forwarded IP so
 * anonymous endpoints (login, register) are still limited without storing
 * personal data.
 */
function rateLimitIdentity(request: NextRequest, userId?: string): string {
  if (userId) return `u:${userId}`;
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? null;
  return `ip:${hashIp(ip) ?? 'unknown'}`;
}

async function parseBody<TSchema extends z.ZodType>(
  request: NextRequest,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('bad_request', 'The request body must be valid JSON.');
  }
  // Throws ZodError, which normalizeError turns into a 422 with field messages.
  return schema.parse(raw);
}

function applyRateLimitHeaders(response: NextResponse, retryAfterSeconds?: number): NextResponse {
  if (retryAfterSeconds !== undefined) {
    response.headers.set('Retry-After', String(retryAfterSeconds));
  }
  return response;
}

/** Wrap a handler that does not require authentication. */
export function publicRoute<TSchema extends z.ZodType | undefined = undefined>(
  options: HandlerOptions<TSchema>,
  handler: (context: RouteContext<Body<TSchema>>) => Promise<NextResponse>,
) {
  return async (
    request: NextRequest,
    routeArgs?: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      if (options.rateLimit) {
        const result = await checkRateLimit(options.rateLimit, rateLimitIdentity(request));
        if (!result.allowed) {
          throw new AppError('rate_limited', 'Too many requests. Please slow down and try again.', {
            retryAfterSeconds: result.retryAfterSeconds,
          });
        }
      }

      const params = routeArgs?.params ? await routeArgs.params : {};
      const body = options.schema
        ? ((await parseBody(request, options.schema)) as Body<TSchema>)
        : (undefined as Body<TSchema>);

      return await handler({ request, body, params });
    } catch (error) {
      return respondWithError(error, request);
    }
  };
}

/** Wrap a handler that requires an authenticated user. */
export function authedRoute<TSchema extends z.ZodType | undefined = undefined>(
  options: HandlerOptions<TSchema>,
  handler: (context: AuthedRouteContext<Body<TSchema>>) => Promise<NextResponse>,
) {
  return async (
    request: NextRequest,
    routeArgs?: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      const session = await getSession();
      if (!session) throw unauthorized();
      if (options.adminOnly && session.user.role !== 'admin') {
        // Deliberately the same message a non-admin gets for a missing resource,
        // so the admin surface is not discoverable by probing.
        throw forbidden();
      }

      if (options.rateLimit) {
        const result = await checkRateLimit(
          options.rateLimit,
          rateLimitIdentity(request, session.user.id),
        );
        if (!result.allowed) {
          throw new AppError('rate_limited', 'Too many requests. Please slow down and try again.', {
            retryAfterSeconds: result.retryAfterSeconds,
          });
        }
      }

      const params = routeArgs?.params ? await routeArgs.params : {};
      const body = options.schema
        ? ((await parseBody(request, options.schema)) as Body<TSchema>)
        : (undefined as Body<TSchema>);

      return await handler({ request, body, params, user: session.user, session });
    } catch (error) {
      return respondWithError(error, request);
    }
  };
}

async function respondWithError(error: unknown, request: NextRequest): Promise<NextResponse> {
  const normalized = normalizeError(error);

  // 5xx and 402/429 are worth recording; ordinary 4xx validation noise is not.
  if (normalized.status >= 500 || normalized.status === 429 || normalized.status === 402) {
    await logError({
      scope: new URL(request.url).pathname,
      code: normalized.payload.error.code,
      message: normalized.logDetail,
    });
  }

  return applyRateLimitHeaders(
    NextResponse.json(normalized.payload, { status: normalized.status }),
    normalized.retryAfterSeconds,
  );
}

/** Success response helper, so every route returns the same envelope shape. */
export function ok<T>(data: T, init?: { status?: number }): NextResponse {
  return NextResponse.json({ data }, { status: init?.status ?? 200 });
}
