import { query, queryOne } from '@/lib/db/client';

/**
 * Product and operational metrics for the admin dashboard.
 *
 * Everything here reads from the reporting views defined in migration 0004, so
 * the aggregation logic lives in one place and a BI tool connecting to the same
 * views sees identical numbers.
 *
 * No query in this file returns question text, answer text or any other
 * candidate content.
 */

export interface PlatformOverview {
  users: { total: number; activeLast30Days: number; newLast7Days: number };
  interviews: {
    total: number;
    completed: number;
    abandoned: number;
    completionRate: number;
    averageScore: number | null;
    averageDurationSeconds: number | null;
  };
  ai: {
    calls: number;
    failures: number;
    failureRate: number;
    totalCostUsd: number;
    costPerInterviewUsd: number | null;
    averageLatencyMs: number | null;
  };
  popularTypes: Array<{ interviewType: string; count: number; averageScore: number | null }>;
  commonGaps: Array<{ skillLabel: string; gapCount: number; averageScore: number }>;
  recentErrors: Array<{ scope: string; code: string; message: string; createdAt: Date }>;
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const [userRow, interviewRow, aiRow, types, gaps, errors] = await Promise.all([
    queryOne<{ total: string; active_30: string; new_7: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE last_login_at > now() - interval '30 days')::text AS active_30,
              count(*) FILTER (WHERE created_at > now() - interval '7 days')::text AS new_7
         FROM users WHERE status <> 'deleted'`,
    ),
    queryOne<{
      total: string;
      completed: string;
      abandoned: string;
      avg_score: string | null;
      avg_duration: string | null;
    }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE i.status = 'completed')::text AS completed,
              count(*) FILTER (WHERE i.status = 'abandoned')::text AS abandoned,
              round(avg(e.overall_score), 1)::text AS avg_score,
              round(avg(i.duration_seconds))::text AS avg_duration
         FROM interviews i
         LEFT JOIN evaluations e ON e.interview_id = i.id`,
    ),
    queryOne<{
      calls: string;
      failures: string;
      cost: string | null;
      latency: string | null;
    }>(
      `SELECT count(*)::text AS calls,
              count(*) FILTER (WHERE NOT ok)::text AS failures,
              round(sum(cost_usd), 4)::text AS cost,
              round(avg(latency_ms))::text AS latency
         FROM ai_usage_events`,
    ),
    query<{ interview_type: string; count: string; avg_score: string | null }>(
      `SELECT interview_type,
              sum(started)::text AS count,
              round(avg(avg_score), 1)::text AS avg_score
         FROM analytics_interview_funnel
        GROUP BY interview_type
        ORDER BY sum(started) DESC
        LIMIT 8`,
    ),
    query<{ skill_label: string; gap_count: string; avg_score: string }>(
      `SELECT skill_label, gap_count::text, avg_score::text
         FROM analytics_skill_gaps
        WHERE gap_count > 0
        ORDER BY gap_count DESC, avg_score ASC
        LIMIT 10`,
    ),
    query<{ scope: string; code: string; message: string; created_at: Date }>(
      `SELECT scope, code, message, created_at
         FROM error_log
        ORDER BY created_at DESC
        LIMIT 15`,
    ),
  ]);

  const totalInterviews = Number.parseInt(interviewRow?.total ?? '0', 10);
  const completed = Number.parseInt(interviewRow?.completed ?? '0', 10);
  const calls = Number.parseInt(aiRow?.calls ?? '0', 10);
  const failures = Number.parseInt(aiRow?.failures ?? '0', 10);
  const totalCost = aiRow?.cost ? Number.parseFloat(aiRow.cost) : 0;

  return {
    users: {
      total: Number.parseInt(userRow?.total ?? '0', 10),
      activeLast30Days: Number.parseInt(userRow?.active_30 ?? '0', 10),
      newLast7Days: Number.parseInt(userRow?.new_7 ?? '0', 10),
    },
    interviews: {
      total: totalInterviews,
      completed,
      abandoned: Number.parseInt(interviewRow?.abandoned ?? '0', 10),
      completionRate: totalInterviews === 0 ? 0 : Math.round((completed / totalInterviews) * 100),
      averageScore: interviewRow?.avg_score ? Number.parseFloat(interviewRow.avg_score) : null,
      averageDurationSeconds: interviewRow?.avg_duration
        ? Number.parseInt(interviewRow.avg_duration, 10)
        : null,
    },
    ai: {
      calls,
      failures,
      failureRate: calls === 0 ? 0 : Math.round((failures / calls) * 100),
      totalCostUsd: totalCost,
      costPerInterviewUsd: totalInterviews === 0 ? null : totalCost / totalInterviews,
      averageLatencyMs: aiRow?.latency ? Number.parseInt(aiRow.latency, 10) : null,
    },
    popularTypes: types.map((row) => ({
      interviewType: row.interview_type,
      count: Number.parseInt(row.count, 10),
      averageScore: row.avg_score ? Number.parseFloat(row.avg_score) : null,
    })),
    commonGaps: gaps.map((row) => ({
      skillLabel: row.skill_label,
      gapCount: Number.parseInt(row.gap_count, 10),
      averageScore: Number.parseFloat(row.avg_score),
    })),
    recentErrors: errors.map((row) => ({
      scope: row.scope,
      code: row.code,
      // Truncated: an admin needs the shape of the error, not a full stack.
      message: row.message.slice(0, 240),
      createdAt: row.created_at,
    })),
  };
}

export interface DailyUsagePoint {
  day: string;
  interviews: number;
  completed: number;
  costUsd: number;
}

export async function getDailyUsage(days = 30): Promise<DailyUsagePoint[]> {
  const rows = await query<{
    day: string;
    interviews: string;
    completed: string;
    cost: string | null;
  }>(
    `WITH span AS (
       SELECT generate_series(
         (now() - ($1::int - 1) * interval '1 day')::date,
         now()::date,
         interval '1 day'
       )::date AS day
     )
     SELECT to_char(span.day, 'YYYY-MM-DD') AS day,
            coalesce(sum(f.started), 0)::text   AS interviews,
            coalesce(sum(f.completed), 0)::text AS completed,
            coalesce((SELECT round(sum(c.cost_usd), 4)
                        FROM analytics_ai_cost c
                       WHERE c.day = span.day), 0)::text AS cost
       FROM span
       LEFT JOIN analytics_interview_funnel f ON f.day = span.day
      GROUP BY span.day
      ORDER BY span.day ASC`,
    [Math.min(Math.max(days, 1), 180)],
  );

  return rows.map((row) => ({
    day: row.day,
    interviews: Number.parseInt(row.interviews, 10),
    completed: Number.parseInt(row.completed, 10),
    costUsd: row.cost ? Number.parseFloat(row.cost) : 0,
  }));
}

/** Per-user AI spend, for the user's own cost transparency panel. */
export async function getUserCostSummary(userId: string): Promise<{
  totalUsd: number;
  interviewCount: number;
  averagePerInterviewUsd: number | null;
}> {
  const row = await queryOne<{ total: string | null; interviews: string }>(
    `SELECT round(sum(cost_usd), 6)::text AS total,
            count(DISTINCT interview_id)::text AS interviews
       FROM ai_usage_events WHERE user_id = $1`,
    [userId],
  );
  const total = row?.total ? Number.parseFloat(row.total) : 0;
  const interviews = Number.parseInt(row?.interviews ?? '0', 10);
  return {
    totalUsd: total,
    interviewCount: interviews,
    averagePerInterviewUsd: interviews === 0 ? null : total / interviews,
  };
}
