import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { listInterviews } from '@/lib/interview/history';
import { INTERVIEW_TYPE_LABELS, VERDICT_LABELS } from '@/lib/schemas/domain';
import { Badge, Card, EmptyState, ScorePill, buttonClass } from '@/components/ui/primitives';
import { LineChart } from '@/components/charts/line-chart';

export const metadata: Metadata = { title: 'Interviews' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, 'neutral' | 'accent' | 'success' | 'warning'> = {
  created: 'neutral',
  in_progress: 'accent',
  paused: 'warning',
  evaluating: 'accent',
  completed: 'success',
  abandoned: 'neutral',
  failed: 'warning',
};

export default async function InterviewsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const interviews = await listInterviews(session.user.id, 100, 0);
  const scored = interviews.filter((interview) => interview.overallScore !== null).reverse();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[var(--text)]">Interviews</h1>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Every interview you have run, with its outcome.
          </p>
        </div>
        <Link href="/interviews/new" className={buttonClass('primary', 'md')}>
          New interview
        </Link>
      </div>

      {scored.length >= 2 ? (
        <Card>
          <h2 className="mb-4 text-[15px] font-semibold tracking-tight text-[var(--text)]">
            Progression
          </h2>
          <LineChart
            ariaLabel="Overall score across completed interviews"
            points={scored.map((interview, index) => ({
              label: `#${index + 1}`,
              value: interview.overallScore ?? 0,
              sublabel: `${interview.roleTitle} · ${new Date(interview.createdAt).toLocaleDateString()}`,
            }))}
          />
        </Card>
      ) : null}

      {interviews.length === 0 ? (
        <EmptyState
          title="No interviews yet"
          description="Start one and it will appear here with its full report."
          action={
            <Link href="/interviews/new" className={buttonClass('primary', 'sm')}>
              Start an interview
            </Link>
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border)] text-[12px] text-[var(--text-subtle)]">
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Difficulty</th>
                  <th className="px-5 py-3 font-medium">Progress</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 text-right font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {interviews.map((interview) => (
                  <tr
                    key={interview.id}
                    className="border-b border-[var(--border)] last:border-0 transition hover:bg-[var(--surface-hover)]"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={
                          interview.status === 'completed'
                            ? `/interviews/${interview.id}/report`
                            : `/interviews/${interview.id}`
                        }
                        className="font-medium text-[var(--text)] hover:text-[var(--accent-text)]"
                      >
                        {interview.roleTitle}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-[var(--text-muted)]">
                      {INTERVIEW_TYPE_LABELS[interview.interviewType]}
                    </td>
                    <td className="px-5 py-3 text-[var(--text-muted)] capitalize">
                      {interview.difficulty}
                    </td>
                    <td className="px-5 py-3 text-[var(--text-muted)] tabular-nums">
                      {interview.answeredCount}/{interview.plannedQuestions}
                    </td>
                    <td className="px-5 py-3 text-[var(--text-muted)]">
                      {new Date(interview.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {interview.overallScore !== null ? (
                          <>
                            {interview.verdict ? (
                              <span className="hidden text-[12px] text-[var(--text-subtle)] sm:inline">
                                {VERDICT_LABELS[interview.verdict]}
                              </span>
                            ) : null}
                            <ScorePill score={interview.overallScore} />
                          </>
                        ) : (
                          <Badge tone={STATUS_TONE[interview.status] ?? 'neutral'}>
                            {interview.status.replace('_', ' ')}
                          </Badge>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
