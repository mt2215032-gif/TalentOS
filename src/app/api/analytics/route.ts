import { authedRoute, ok } from '@/lib/security/api';
import { getUserCostSummary } from '@/lib/analytics/metrics';
import { getDashboard } from '@/lib/interview/history';
import { requireFeature } from '@/lib/billing/entitlements';
import { query } from '@/lib/db/client';

export const runtime = 'nodejs';

/** The user's own analytics. Gated on the plan's advancedAnalytics feature. */
export const GET = authedRoute({ rateLimit: 'readApi' }, async ({ user }) => {
  requireFeature(user.plan, 'advancedAnalytics', 'Advanced analytics');

  const [dashboard, cost, byType, skillHistory] = await Promise.all([
    getDashboard(user.id),
    getUserCostSummary(user.id),
    query<{ interview_type: string; count: string; avg_score: string | null }>(
      `SELECT i.interview_type,
              count(*)::text AS count,
              round(avg(e.overall_score), 1)::text AS avg_score
         FROM interviews i
         LEFT JOIN evaluations e ON e.interview_id = i.id
        WHERE i.user_id = $1
        GROUP BY i.interview_type
        ORDER BY count(*) DESC`,
      [user.id],
    ),
    query<{ skill_label: string; score: number; created_at: Date }>(
      `SELECT skill_label, score, created_at
         FROM skill_scores
        WHERE user_id = $1
        ORDER BY created_at ASC
        LIMIT 400`,
      [user.id],
    ),
  ]);

  return ok({
    totals: dashboard.totals,
    progression: dashboard.progression,
    skills: dashboard.skills,
    byType: byType.map((row) => ({
      interviewType: row.interview_type,
      count: Number.parseInt(row.count, 10),
      averageScore: row.avg_score ? Number.parseFloat(row.avg_score) : null,
    })),
    skillHistory: skillHistory.map((row) => ({
      skillLabel: row.skill_label,
      score: row.score,
      date: row.created_at,
    })),
    cost,
  });
});
