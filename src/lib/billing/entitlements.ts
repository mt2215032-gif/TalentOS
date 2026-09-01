import { query, queryOne } from '@/lib/db/client';
import { AppError } from '@/lib/security/errors';
import { getPlan, METRIC_LABELS, type PlanId, type UsageMetric } from '@/lib/billing/plans';

/**
 * Quota enforcement.
 *
 * Usage is counted per calendar month in usage_counters. Increments are atomic
 * and happen at the point of use, so a burst of concurrent requests cannot each
 * read the same count and decide there is room.
 */

/** First day of the current billing month, as a DATE literal. */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export interface UsageSnapshot {
  metric: UsageMetric;
  used: number;
  limit: number | null;
  remaining: number | null;
}

export async function getUsage(userId: string, plan: PlanId): Promise<UsageSnapshot[]> {
  const rows = await query<{ metric: UsageMetric; used: number }>(
    'SELECT metric, used FROM usage_counters WHERE user_id = $1 AND period_start = $2',
    [userId, currentPeriod()],
  );
  const byMetric = new Map(rows.map((row) => [row.metric, row.used]));
  const quotas = getPlan(plan).quotas;

  return (Object.keys(quotas) as UsageMetric[]).map((metric) => {
    const used = byMetric.get(metric) ?? 0;
    const limit = quotas[metric];
    return {
      metric,
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
    };
  });
}

/**
 * Consume one unit of a metric, or throw if the plan does not allow it.
 *
 * The check and the increment are one statement: the insert always happens, and
 * the resulting count decides. An over-limit call is rolled back so a rejected
 * request does not burn quota.
 */
export async function consumeQuota(
  userId: string,
  plan: PlanId,
  metric: UsageMetric,
  amount = 1,
): Promise<void> {
  const limit = getPlan(plan).quotas[metric];
  if (limit === null) return;

  if (limit === 0) {
    throw new AppError(
      'quota_exceeded',
      `${METRIC_LABELS[metric]} are not included in the ${getPlan(plan).name} plan.`,
    );
  }

  const row = await queryOne<{ used: number }>(
    `INSERT INTO usage_counters (user_id, period_start, metric, used)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, period_start, metric)
     DO UPDATE SET used = usage_counters.used + $4, updated_at = now()
       RETURNING used`,
    [userId, currentPeriod(), metric, amount],
  );

  const used = row?.used ?? amount;
  if (used > limit) {
    // Give the unit back — the caller is being refused, so it should not count.
    await query(
      `UPDATE usage_counters SET used = GREATEST(0, used - $4)
        WHERE user_id = $1 AND period_start = $2 AND metric = $3`,
      [userId, currentPeriod(), metric, amount],
    );
    throw new AppError(
      'quota_exceeded',
      `You have used all ${limit} ${METRIC_LABELS[metric].toLowerCase()} in your ${getPlan(plan).name} plan this month. Upgrade for more.`,
    );
  }
}

/** Check a boolean feature flag on the user's plan. */
export function requireFeature(
  plan: PlanId,
  feature: keyof ReturnType<typeof getPlan>['features'],
  label: string,
): void {
  if (!getPlan(plan).features[feature]) {
    throw new AppError('quota_exceeded', `${label} is not included in the ${getPlan(plan).name} plan.`);
  }
}
