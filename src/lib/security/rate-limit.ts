import { config } from '@/lib/config';
import { queryOne } from '@/lib/db/client';

/**
 * Fixed-window rate limiting.
 *
 * The Postgres backend is the default because serverless deployments run many
 * instances and an in-memory counter would let a caller multiply their limit by
 * the number of cold starts. The memory backend exists for tests and
 * single-process development.
 */

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets — sent as Retry-After. */
  retryAfterSeconds: number;
}

/**
 * Named limits.
 *
 * Auth endpoints are tight because they are the ones worth brute-forcing.
 * Answer submission is generous: a real interview is a burst of activity and
 * throttling a candidate mid-sentence would be worse than the abuse it stops.
 */
export const RATE_LIMITS = {
  login: { limit: 8, windowSeconds: 300 },
  // Registration is limited per IP. Shared addresses are common — an office,
  // a university, a bootcamp cohort all sign up from one NAT — so this is set
  // to stop scripted abuse rather than to cap a classroom.
  register: { limit: 20, windowSeconds: 3600 },
  passwordChange: { limit: 5, windowSeconds: 3600 },
  resumeUpload: { limit: 12, windowSeconds: 3600 },
  jobCreate: { limit: 30, windowSeconds: 3600 },
  interviewStart: { limit: 20, windowSeconds: 3600 },
  answerSubmit: { limit: 240, windowSeconds: 3600 },
  reportGenerate: { limit: 30, windowSeconds: 3600 },
  readApi: { limit: 600, windowSeconds: 300 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

const memoryBuckets = new Map<string, { hits: number; expiresAt: number }>();

/**
 * Consume one unit from the caller's bucket.
 *
 * `identity` should be a user id where one is known and a hashed IP otherwise —
 * never a raw IP, which would put personal data in the limiter table.
 */
export async function checkRateLimit(
  name: RateLimitName,
  identity: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[name];
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const bucket = `${name}:${identity}:${windowStart}`;
  const expiresAt = new Date(windowStart + windowMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - Date.now()) / 1000));

  if (config.rateLimit.backend === 'memory') {
    return consumeMemory(bucket, rule, windowStart + windowMs, retryAfterSeconds);
  }

  try {
    // A single upsert does the increment atomically, so concurrent requests
    // cannot both read the same count and each decide they are under the limit.
    const row = await queryOne<{ hits: number }>(
      `INSERT INTO rate_limits (bucket, hits, expires_at)
            VALUES ($1, 1, $2)
       ON CONFLICT (bucket)
       DO UPDATE SET hits = rate_limits.hits + 1
        RETURNING hits`,
      [bucket, expiresAt],
    );

    const hits = row?.hits ?? 1;
    return {
      allowed: hits <= rule.limit,
      remaining: Math.max(0, rule.limit - hits),
      retryAfterSeconds,
    };
  } catch {
    // A limiter outage must not take the product down with it. Fall back to the
    // in-process counter, which still stops a runaway client on this instance.
    return consumeMemory(bucket, rule, windowStart + windowMs, retryAfterSeconds);
  }
}

function consumeMemory(
  bucket: string,
  rule: RateLimitRule,
  expiresAtMs: number,
  retryAfterSeconds: number,
): RateLimitResult {
  const now = Date.now();
  for (const [key, value] of memoryBuckets) {
    if (value.expiresAt <= now) memoryBuckets.delete(key);
  }

  const entry = memoryBuckets.get(bucket) ?? { hits: 0, expiresAt: expiresAtMs };
  entry.hits += 1;
  memoryBuckets.set(bucket, entry);

  return {
    allowed: entry.hits <= rule.limit,
    remaining: Math.max(0, rule.limit - entry.hits),
    retryAfterSeconds,
  };
}

/** Delete expired buckets. Called opportunistically from the health endpoint. */
export async function pruneRateLimits(): Promise<void> {
  const { query } = await import('@/lib/db/client');
  await query('DELETE FROM rate_limits WHERE expires_at < now()').catch(() => {});
}

/** Test seam. */
export function resetMemoryRateLimits(): void {
  memoryBuckets.clear();
}
