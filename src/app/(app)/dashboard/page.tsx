import Link from 'next/link';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { getDashboard } from '@/lib/interview/history';
import { getUsage } from '@/lib/billing/entitlements';
import { getPlan, METRIC_LABELS } from '@/lib/billing/plans';
import { INTERVIEW_TYPE_LABELS, VERDICT_LABELS } from '@/lib/schemas/domain';
import {
  Badge, Card, CardHeader, EmptyState, ProgressBar, ScorePill, StatTile, buttonClass,
} from '@/components/ui/primitives';
import { LineChart } from '@/components/charts/line-chart';
import { RadarChart } from '@/components/charts/radar-chart';
import { BarList } from '@/components/charts/bar-list';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [data, usage] = await Promise.all([
    getDashboard(session.user.id),
    getUsage(session.user.id, session.user.plan),
  ]);

  const hasHistory = data.progression.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[var(--text)]">Dashboard</h1>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            {hasHistory
              ? `${data.totals.interviewsCompleted} completed interview${data.totals.interviewsCompleted === 1 ? '' : 's'} on record.`
              : 'Run your first interview to start building a picture of where you stand.'}
          </p>
        </div>
        <Link href="/interviews/new" className={buttonClass('primary', 'md')}>
          Start an interview
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Latest score"
          value={data.totals.latestScore ?? '—'}
          trend={data.totals.scoreDelta}
          hint={data.totals.scoreDelta === null ? 'No prior interview to compare' : 'Change from your previous interview'}
        />
        <StatTile
          label="Average"
          value={data.totals.averageScore ?? '—'}
          hint={`Across ${data.totals.interviewsCompleted} completed`}
        />
        <StatTile label="Best" value={data.totals.bestScore ?? '—'} hint="Your highest overall score" />
        <StatTile
          label="Practice time"
          value={formatDuration(data.totals.totalPracticeSeconds)}
          hint="Excluding paused time"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Score progression"
            description="Every interview is scored against the same rubric, so these are comparable."
          />
          {hasHistory ? (
            <LineChart
              ariaLabel="Overall interview score over time"
              points={data.progression.map((point, index) => ({
                label: `#${index + 1}`,
                value: point.score,
                sublabel: `${point.roleTitle} · ${INTERVIEW_TYPE_LABELS[point.interviewType]}`,
              }))}
            />
          ) : (
            <EmptyState
              title="No interviews yet"
              description="Your progression chart fills in as you complete interviews."
              action={
                <Link href="/interviews/new" className={buttonClass('secondary', 'sm')}>
                  Start your first
                </Link>
              }
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Skill profile" description="Most recent score per skill." />
          {data.skills.length >= 3 ? (
            <RadarChart
              ariaLabel="Skill profile radar"
              axes={data.skills.slice(0, 8).map((skill) => ({
                label: skill.skillLabel,
                value: skill.score,
              }))}
            />
          ) : (
            <EmptyState
              title="Not enough skills assessed"
              description="A profile needs at least three skills with evidence behind them."
            />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Skill breakdown"
            description="Weakest first. Skills the job needs but the interview never reached show as untested."
          />
          <BarList
            colorByBand
            showBandLabel
            items={data.skills.slice(0, 10).map((skill) => ({
              label: skill.skillLabel,
              value: skill.score,
              meta: skill.observations > 1 ? `${skill.observations}×` : undefined,
              untested: skill.score === 0 && skill.observations === 0,
            }))}
            emptyMessage="Complete an interview to see your skill breakdown."
          />
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Strongest and weakest" />
            {data.strongestSkill || data.weakestSkill ? (
              <dl className="space-y-3">
                {data.strongestSkill ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">Strongest</dt>
                      <dd className="truncate text-[13px] font-medium text-[var(--text)]">
                        {data.strongestSkill.skillLabel}
                      </dd>
                    </div>
                    <ScorePill score={data.strongestSkill.score} />
                  </div>
                ) : null}
                {data.weakestSkill ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">Weakest</dt>
                      <dd className="truncate text-[13px] font-medium text-[var(--text)]">
                        {data.weakestSkill.skillLabel}
                      </dd>
                    </div>
                    <ScorePill score={data.weakestSkill.score} />
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="text-[13px] text-[var(--text-muted)]">
                Nothing assessed yet.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="This month" description={`${getPlan(session.user.plan).name} plan`} />
            <ul className="space-y-3">
              {usage.map((entry) => (
                <li key={entry.metric}>
                  <div className="mb-1 flex items-baseline justify-between text-[12px]">
                    <span className="text-[var(--text-muted)]">{METRIC_LABELS[entry.metric]}</span>
                    <span className="font-medium tabular-nums text-[var(--text)]">
                      {entry.used}
                      {entry.limit === null ? ' / ∞' : ` / ${entry.limit}`}
                    </span>
                  </div>
                  <ProgressBar
                    value={entry.limit === null ? 0 : entry.used}
                    max={entry.limit ?? 1}
                    color={
                      entry.limit !== null && entry.used >= entry.limit
                        ? 'var(--viz-bad)'
                        : 'var(--viz-accent)'
                    }
                  />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent interviews"
            action={
              <Link href="/interviews" className="text-[12px] font-medium text-[var(--accent-text)] hover:underline">
                View all
              </Link>
            }
          />
          {data.recentInterviews.length > 0 ? (
            <ul className="divide-y divide-[var(--border)]">
              {data.recentInterviews.map((interview) => (
                <li key={interview.id}>
                  <Link
                    href={`/interviews/${interview.id}`}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 py-3 transition hover:bg-[var(--surface-hover)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-[var(--text)]">
                        {interview.roleTitle}
                      </p>
                      <p className="mt-0.5 text-[12px] text-[var(--text-subtle)]">
                        {INTERVIEW_TYPE_LABELS[interview.interviewType]} · {interview.difficulty} ·{' '}
                        {new Date(interview.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {interview.overallScore !== null ? (
                      <ScorePill score={interview.overallScore} />
                    ) : (
                      <Badge tone={interview.status === 'in_progress' ? 'accent' : 'neutral'}>
                        {interview.status.replace('_', ' ')}
                      </Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing here yet" description="Interviews you run will appear here." />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Recommended next"
            description="Drawn from the gaps your most recent reports identified."
          />
          {data.recommendations.length > 0 ? (
            <ul className="space-y-3">
              {data.recommendations.map((recommendation, index) => (
                <li key={`${recommendation.title}-${index}`} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[10px] font-semibold text-[var(--accent-text)]">
                    {recommendation.priority}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[var(--text)]">{recommendation.title}</p>
                    {recommendation.detail ? (
                      <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
                        {recommendation.detail}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No recommendations yet"
              description="Complete an interview and its report will produce a prioritised plan."
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
