import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getDailyUsage, getPlatformOverview } from '@/lib/analytics/metrics';
import { listUsersForAdmin } from '@/lib/db/repositories/users';
import { pingDatabase } from '@/lib/db/client';
import { getProvider } from '@/lib/ai';
import { INTERVIEW_TYPE_LABELS } from '@/lib/schemas/domain';
import { Badge, Card, CardHeader, EmptyState, StatTile } from '@/components/ui/primitives';
import { BarList, GroupedBars } from '@/components/charts/bar-list';

export const metadata: Metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  // The layout already requires a session; this requires the role. A non-admin
  // is sent to their dashboard rather than shown that the page exists.
  if (session.user.role !== 'admin') redirect('/dashboard');

  const [overview, daily, users, database] = await Promise.all([
    getPlatformOverview(),
    getDailyUsage(30),
    listUsersForAdmin(25, 0),
    pingDatabase(),
  ]);
  const provider = getProvider();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[var(--text)]">Admin</h1>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Platform health and usage. Candidate CVs, questions and answers are not shown here.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Users"
          value={overview.users.total}
          hint={`${overview.users.activeLast30Days} active in 30 days · ${overview.users.newLast7Days} new this week`}
        />
        <StatTile
          label="Interviews"
          value={overview.interviews.total}
          hint={`${overview.interviews.completionRate}% completion rate`}
        />
        <StatTile
          label="Average score"
          value={overview.interviews.averageScore ?? '—'}
          hint={
            overview.interviews.averageDurationSeconds
              ? `${Math.round(overview.interviews.averageDurationSeconds / 60)} min average duration`
              : 'No completed interviews'
          }
        />
        <StatTile
          label="AI spend"
          value={`$${overview.ai.totalCostUsd.toFixed(2)}`}
          hint={
            overview.ai.costPerInterviewUsd === null
              ? 'No interviews yet'
              : `$${overview.ai.costPerInterviewUsd.toFixed(4)} per interview`
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Daily activity" description="Interviews started and completed, last 30 days." />
          <GroupedBars
            ariaLabel="Interviews started and completed per day over the last 30 days"
            seriesLabels={['Started', 'Completed']}
            data={daily.map((point) => ({
              label: point.day,
              values: [point.interviews, point.completed],
            }))}
          />
        </Card>

        <Card>
          <CardHeader title="System health" />
          <dl className="space-y-3 text-[13px]">
            <HealthRow
              label="Database"
              ok={database.ok}
              detail={database.ok ? `${database.latencyMs} ms` : (database.error ?? 'unreachable')}
            />
            <HealthRow
              label="AI engine"
              ok
              detail={provider.isLlm ? provider.name : 'offline heuristic'}
              warn={!provider.isLlm}
            />
            <HealthRow
              label="AI failure rate"
              ok={overview.ai.failureRate < 5}
              warn={overview.ai.failureRate >= 5 && overview.ai.failureRate < 20}
              detail={`${overview.ai.failureRate}% of ${overview.ai.calls} calls`}
            />
            <HealthRow
              label="AI latency"
              ok
              detail={
                overview.ai.averageLatencyMs === null
                  ? 'no data'
                  : `${overview.ai.averageLatencyMs} ms average`
              }
            />
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Popular interview types" description="By number started." />
          <BarList
            max={Math.max(1, ...overview.popularTypes.map((type) => type.count))}
            items={overview.popularTypes.map((type) => ({
              label:
                INTERVIEW_TYPE_LABELS[type.interviewType as keyof typeof INTERVIEW_TYPE_LABELS] ??
                type.interviewType,
              value: type.count,
              meta: type.averageScore === null ? undefined : `avg ${type.averageScore}`,
            }))}
            emptyMessage="No interviews run yet."
          />
        </Card>

        <Card>
          <CardHeader
            title="Most common skill gaps"
            description="Across all candidates, aggregated."
          />
          <BarList
            max={Math.max(1, ...overview.commonGaps.map((gap) => gap.gapCount))}
            items={overview.commonGaps.map((gap) => ({
              label: gap.skillLabel,
              value: gap.gapCount,
              meta: `avg ${gap.averageScore}`,
            }))}
            emptyMessage="No skill gaps recorded yet."
          />
        </Card>
      </div>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title="Users" description="Account metadata and aggregate scores only." />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-[12px] text-[var(--text-subtle)]">
                <th className="px-5 py-2 font-medium">Email</th>
                <th className="px-5 py-2 font-medium">Plan</th>
                <th className="px-5 py-2 font-medium">Role</th>
                <th className="px-5 py-2 text-right font-medium">Interviews</th>
                <th className="px-5 py-2 text-right font-medium">Avg score</th>
                <th className="px-5 py-2 text-right font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="max-w-[220px] truncate px-5 py-2.5 text-[var(--text)]">{user.email}</td>
                  <td className="px-5 py-2.5">
                    <Badge tone={user.plan === 'free' ? 'neutral' : 'accent'}>{user.plan}</Badge>
                  </td>
                  <td className="px-5 py-2.5 text-[var(--text-muted)]">{user.role}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-[var(--text-muted)]">
                    {user.interview_count}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-[var(--text-muted)]">
                    {user.avg_score ?? '—'}
                  </td>
                  <td className="px-5 py-2.5 text-right text-[var(--text-muted)]">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Recent errors" description="Most recent first, truncated." />
        {overview.recentErrors.length > 0 ? (
          <ul className="divide-y divide-[var(--border)]">
            {overview.recentErrors.map((error, index) => (
              <li key={index} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-3">
                <span className="w-40 shrink-0 font-mono text-[11px] text-[var(--text-subtle)]">
                  {new Date(error.createdAt).toLocaleString()}
                </span>
                <span className="w-32 shrink-0 truncate font-mono text-[11px] text-[var(--danger)]">
                  {error.code}
                </span>
                <span className="min-w-0 truncate text-[12px] text-[var(--text-muted)]" title={error.message}>
                  {error.scope} — {error.message}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No errors logged" description="Nothing has failed since the last reset." />
        )}
      </Card>
    </div>
  );
}

function HealthRow({
  label, ok, warn = false, detail,
}: {
  label: string; ok: boolean; warn?: boolean; detail: string;
}) {
  const tone = !ok ? 'var(--danger)' : warn ? 'var(--warning)' : 'var(--success)';
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-[var(--text-muted)]">
        <span className="h-2 w-2 rounded-full" style={{ background: tone }} aria-hidden="true" />
        {label}
      </dt>
      <dd className="truncate text-right font-medium text-[var(--text)]" title={detail}>
        {detail}
      </dd>
    </div>
  );
}
