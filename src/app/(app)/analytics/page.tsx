import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getDashboard } from '@/lib/interview/history';
import { getUserCostSummary } from '@/lib/analytics/metrics';
import { getPlan } from '@/lib/billing/plans';
import { query } from '@/lib/db/client';
import { INTERVIEW_TYPE_LABELS } from '@/lib/schemas/domain';
import {
  Card, CardHeader, EmptyState, StatTile, buttonClass,
} from '@/components/ui/primitives';
import { LineChart } from '@/components/charts/line-chart';
import { BarList } from '@/components/charts/bar-list';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const plan = getPlan(session.user.plan);

  // Gated in the UI as well as the API, so the page explains the limit rather
  // than surfacing a 402 the user cannot act on.
  if (!plan.features.advancedAnalytics) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card raised className="text-center">
          <h1 className="text-[19px] font-semibold tracking-tight text-[var(--text)]">
            Advanced analytics
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
            Score trends by interview type, per-skill history and cost breakdowns are part of the Pro
            plan and above. Your dashboard still shows progression and your current skill profile.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Link href="/dashboard" className={buttonClass('primary', 'md')}>
              Back to dashboard
            </Link>
            <Link href="/#pricing" className={buttonClass('secondary', 'md')}>
              See plans
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const [dashboard, cost, byType] = await Promise.all([
    getDashboard(session.user.id),
    getUserCostSummary(session.user.id),
    query<{ interview_type: string; count: string; avg_score: string | null }>(
      `SELECT i.interview_type,
              count(*)::text AS count,
              round(avg(e.overall_score), 1)::text AS avg_score
         FROM interviews i
         LEFT JOIN evaluations e ON e.interview_id = i.id
        WHERE i.user_id = $1
        GROUP BY i.interview_type
        ORDER BY count(*) DESC`,
      [session.user.id],
    ),
  ]);

  const completionRate =
    dashboard.totals.interviewsStarted === 0
      ? 0
      : Math.round((dashboard.totals.interviewsCompleted / dashboard.totals.interviewsStarted) * 100);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[var(--text)]">Analytics</h1>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          How your performance has moved, and where it is still weak.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Interviews" value={dashboard.totals.interviewsStarted} hint="Started" />
        <StatTile
          label="Completion rate"
          value={`${completionRate}%`}
          hint={`${dashboard.totals.interviewsCompleted} finished`}
        />
        <StatTile
          label="Average score"
          value={dashboard.totals.averageScore ?? '—'}
          trend={dashboard.totals.scoreDelta}
        />
        <StatTile
          label="AI cost"
          value={`$${cost.totalUsd.toFixed(3)}`}
          hint={
            cost.averagePerInterviewUsd === null
              ? 'Nothing spent yet'
              : `$${cost.averagePerInterviewUsd.toFixed(4)} per interview`
          }
        />
      </div>

      <Card>
        <CardHeader
          title="Score over time"
          description="Same rubric every interview, so the line is meaningful."
        />
        {dashboard.progression.length > 0 ? (
          <LineChart
            ariaLabel="Overall score over time"
            points={dashboard.progression.map((point, index) => ({
              label: `#${index + 1}`,
              value: point.score,
              sublabel: `${point.roleTitle} · ${new Date(point.date).toLocaleDateString()}`,
            }))}
          />
        ) : (
          <EmptyState title="No completed interviews" description="Finish one to start the trend." />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Skill levels"
            description="Most recent score per skill, weakest first."
          />
          <BarList
            colorByBand
            showBandLabel
            items={dashboard.skills.map((skill) => ({
              label: skill.skillLabel,
              value: skill.score,
              meta: `${skill.observations}×`,
              untested: skill.score === 0 && skill.observations === 0,
            }))}
            emptyMessage="No skills assessed yet."
          />
        </Card>

        <Card>
          <CardHeader title="By interview type" description="Where you perform best." />
          {byType.length > 0 ? (
            <BarList
              items={byType.map((row) => ({
                label:
                  INTERVIEW_TYPE_LABELS[row.interview_type as keyof typeof INTERVIEW_TYPE_LABELS] ??
                  row.interview_type,
                value: row.avg_score ? Math.round(Number.parseFloat(row.avg_score)) : 0,
                meta: `${row.count} run${row.count === '1' ? '' : 's'}`,
                untested: row.avg_score === null,
              }))}
              colorByBand
              showBandLabel
            />
          ) : (
            <EmptyState title="Nothing to compare yet" description="Run interviews of different types." />
          )}
        </Card>
      </div>
    </div>
  );
}
