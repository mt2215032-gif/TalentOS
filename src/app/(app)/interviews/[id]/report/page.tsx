import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getReport } from '@/lib/interview/evaluation';
import { loadInterview } from '@/lib/interview/engine';
import {
  DIFFICULTY_LABELS, INTERVIEW_TYPE_LABELS, VERDICT_LABELS,
} from '@/lib/schemas/domain';
import {
  Badge, Card, CardHeader, buttonClass, scoreBand,
} from '@/components/ui/primitives';
import { BarList } from '@/components/charts/bar-list';
import { RadarChart } from '@/components/charts/radar-chart';
import { GenerateReportPrompt } from '@/components/interview/generate-report';

export const metadata: Metadata = { title: 'Interview report' };
export const dynamic = 'force-dynamic';

const DIMENSION_LABELS: Record<string, string> = {
  technicalKnowledge: 'Technical knowledge',
  problemSolving: 'Problem solving',
  communication: 'Communication',
  practicalExperience: 'Practical experience',
  criticalThinking: 'Critical thinking',
  roleFit: 'Role fit',
};

const CONFIDENCE_NOTE: Record<string, string> = {
  low: 'Few answers carried enough detail to assess, so treat this score as provisional.',
  medium: 'Enough was demonstrated to support these scores, though more answers would sharpen them.',
  high: 'The interview gathered substantial evidence behind these scores.',
};

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const stored = await getReport(session.user.id, id);

  if (!stored) {
    // Distinguish "not yours / does not exist" from "not generated yet".
    const interview = await loadInterview(session.user.id, id).catch(() => null);
    if (!interview) notFound();
    return (
      <div className="mx-auto max-w-2xl">
        <GenerateReportPrompt
          interviewId={id}
          roleTitle={interview.role_title}
          answered={interview.answered_count}
          canGenerate={interview.answered_count > 0}
        />
      </div>
    );
  }

  const { report, learningPlan, transcript, interview } = stored;
  const band = scoreBand(report.overallScore);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/interviews"
            className="text-[12px] font-medium text-[var(--text-subtle)] hover:text-[var(--text)]"
          >
            ← All interviews
          </Link>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-tight text-[var(--text)]">
            {interview.role_title}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--text-muted)]">
            <span>{INTERVIEW_TYPE_LABELS[interview.interview_type]}</span>
            <span aria-hidden="true">·</span>
            <span>{DIFFICULTY_LABELS[interview.difficulty]}</span>
            <span aria-hidden="true">·</span>
            <span>{transcript.length} questions</span>
            {interview.completed_at ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{new Date(interview.completed_at).toLocaleDateString()}</span>
              </>
            ) : null}
          </p>
        </div>
        <Link href="/interviews/new" className={buttonClass('secondary', 'md')}>
          Run another
        </Link>
      </div>

      {/* ── Verdict ─────────────────────────────────────────────────────── */}
      <Card raised>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-5">
            <ScoreDial score={report.overallScore} color={band.color} />
            <div>
              <p className="text-[12px] uppercase tracking-wide text-[var(--text-subtle)]">
                Overall
              </p>
              <p className="mt-1 text-[15px] font-semibold text-[var(--text)]">
                {VERDICT_LABELS[report.verdict]}
              </p>
              <Badge tone={band.tone} className="mt-1.5">
                {band.label}
              </Badge>
            </div>
          </div>
          <div className="min-w-0 flex-1 border-t border-[var(--border)] pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
            <p className="text-[14px] leading-relaxed text-[var(--text)]">{report.summary}</p>
            <p className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-subtle)]">
              <Badge tone={report.evidenceConfidence === 'high' ? 'success' : report.evidenceConfidence === 'low' ? 'warning' : 'neutral'}>
                {report.evidenceConfidence} evidence confidence
              </Badge>
              <span>{CONFIDENCE_NOTE[report.evidenceConfidence]}</span>
            </p>
          </div>
        </div>
      </Card>

      {/* ── Dimensions and skills ───────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Scored dimensions"
            description="Each is judged independently — fluency about work you did not do does not raise technical knowledge."
          />
          <BarList
            items={Object.entries(report.dimensions).map(([key, value]) => ({
              label: DIMENSION_LABELS[key] ?? key,
              value: value as number,
            }))}
            colorByBand
            showBandLabel
          />
        </Card>

        <Card>
          <CardHeader title="Skill profile" description="Where this interview left each skill." />
          {report.skillScores.filter((skill) => skill.evidenceCount > 0).length >= 3 ? (
            <RadarChart
              ariaLabel="Skill scores from this interview"
              axes={report.skillScores
                .filter((skill) => skill.evidenceCount > 0)
                .slice(0, 8)
                .map((skill) => ({ label: skill.skillLabel, value: skill.score }))}
            />
          ) : (
            <BarList
              colorByBand
              showBandLabel
              items={report.skillScores.map((skill) => ({
                label: skill.skillLabel,
                value: skill.score,
                meta: skill.evidenceCount === 0 ? 'untested' : `${skill.evidenceCount}×`,
                untested: skill.evidenceCount === 0,
              }))}
              emptyMessage="No skills were scored in this interview."
            />
          )}
        </Card>
      </div>

      {/* ── Strengths and weaknesses ────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Strengths" description="Backed by what you actually said." />
          {report.strengths.length > 0 ? (
            <ul className="space-y-3">
              {report.strengths.map((strength, index) => (
                <li key={index} className="border-l-2 border-[var(--success)] pl-3">
                  <p className="text-[13px] font-semibold text-[var(--text)]">{strength.title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
                    {strength.detail}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
              No answer in this interview scored highly enough to record as a strength. That is
              information, not a formatting problem.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader title="Weaknesses" description="Specific, with what was missing." />
          {report.weaknesses.length > 0 ? (
            <ul className="space-y-3">
              {report.weaknesses.map((weakness, index) => (
                <li key={index} className="border-l-2 border-[var(--danger)] pl-3">
                  <p className="text-[13px] font-semibold text-[var(--text)]">{weakness.title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
                    {weakness.detail}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-[var(--text-muted)]">
              No significant weaknesses were identified.
            </p>
          )}
        </Card>
      </div>

      {/* ── Skill gaps ──────────────────────────────────────────────────── */}
      {report.skillGaps.length > 0 ? (
        <Card>
          <CardHeader
            title="Skill gaps"
            description="Ordered by how much each costs you for this role."
          />
          <ul className="divide-y divide-[var(--border)]">
            {report.skillGaps.map((gap, index) => (
              <li key={index} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex w-full shrink-0 items-center gap-2 sm:w-56">
                  <Badge
                    tone={
                      gap.severity === 'critical' ? 'danger'
                      : gap.severity === 'high' ? 'warning'
                      : 'neutral'
                    }
                  >
                    {gap.severity}
                  </Badge>
                  <span className="truncate text-[13px] font-medium text-[var(--text)]">
                    {gap.skillLabel}
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">{gap.detail}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ── Question-by-question ────────────────────────────────────────── */}
      <Card padded={false}>
        <div className="px-5 pt-5 sm:px-6 sm:pt-6">
          <CardHeader
            title="Question by question"
            description="What was good, what was missing, and the specific next step."
          />
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {report.questionAnalysis.map((analysis) => {
            const turn = transcript.find((entry) => entry.position === analysis.position);
            const questionBand = scoreBand(analysis.score);
            return (
              <li key={analysis.position} className="px-5 py-5 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-[var(--text-subtle)]">
                      Question {analysis.position}
                      {turn?.skillLabel ? ` · ${turn.skillLabel}` : ''}
                      {turn?.difficulty ? ` · ${turn.difficulty}` : ''}
                    </p>
                    <p className="mt-1 text-[14px] font-medium leading-relaxed text-[var(--text)]">
                      {turn?.question ?? '—'}
                    </p>
                  </div>
                  <Badge tone={questionBand.tone}>{analysis.score}/100</Badge>
                </div>

                {turn?.answer ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[12px] font-medium text-[var(--text-subtle)] hover:text-[var(--text)]">
                      Your answer
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap rounded-[var(--radius-control)] bg-[var(--bg-subtle)] p-3 text-[13px] leading-relaxed text-[var(--text-muted)]">
                      {turn.answer}
                    </p>
                  </details>
                ) : (
                  <p className="mt-3 text-[12px] italic text-[var(--text-subtle)]">
                    No answer was given.
                  </p>
                )}

                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--success)]">
                      What was good
                    </dt>
                    <dd className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
                      {analysis.whatWasGood}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--danger)]">
                      What was missing
                    </dt>
                    <dd className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
                      {analysis.whatWasMissing}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                    A strong answer contains
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {analysis.idealAnswerCharacteristics.map((characteristic, index) => (
                      <li key={index} className="flex gap-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
                        <span className="text-[var(--text-subtle)]" aria-hidden="true">—</span>
                        {characteristic}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[13px] leading-relaxed text-[var(--text)]">
                    <span className="font-semibold">Next time: </span>
                    {analysis.howToImprove}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* ── Improvement plan ────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title={learningPlan.title}
          description={learningPlan.objective}
        />
        <ol className="space-y-4">
          {learningPlan.weeks.map((week) => (
            <li key={week.weekNumber} className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[12px] font-semibold text-[var(--accent-text)]">
                {week.weekNumber}
              </div>
              <div className="min-w-0 flex-1 pb-4 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-[var(--border)]">
                <p className="text-[13px] font-semibold text-[var(--text)]">{week.focus}</p>
                <ul className="mt-2 space-y-1">
                  {week.activities.map((activity, index) => (
                    <li key={index} className="flex gap-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
                      <span className="text-[var(--text-subtle)]" aria-hidden="true">—</span>
                      {activity}
                    </li>
                  ))}
                </ul>
                {week.successCriteria ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-subtle)]">
                    <span className="font-medium">Done when: </span>
                    {week.successCriteria}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        {learningPlan.recommendations.length > 0 ? (
          <div className="mt-6 border-t border-[var(--border)] pt-5">
            <h3 className="text-[13px] font-semibold text-[var(--text)]">Recommendations</h3>
            <ul className="mt-3 space-y-2.5">
              {learningPlan.recommendations.map((recommendation, index) => (
                <li key={index} className="flex gap-3">
                  <Badge tone={recommendation.priority <= 2 ? 'accent' : 'neutral'}>
                    {recommendation.kind.replace('_', ' ')}
                  </Badge>
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
          </div>
        ) : null}
      </Card>

      <p className="text-center text-[11px] text-[var(--text-subtle)]">
        Evaluated by the {interview.engine_provider === 'heuristic' ? 'offline heuristic engine' : interview.engine_provider} engine.
        {interview.engine_provider === 'heuristic'
          ? ' It measures the structure and specificity of an answer, not whether its claims are true.'
          : ''}
      </p>
    </div>
  );
}

/** Circular score dial. Length and number both carry the value. */
function ScoreDial({ score, color }: { score: number; color: string }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;

  return (
    <svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={`Overall score ${score} out of 100`}>
      <circle cx="44" cy="44" r={radius} fill="none" stroke="var(--bg-subtle)" strokeWidth="8" />
      <circle
        cx="44" cy="44" r={radius}
        fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        transform="rotate(-90 44 44)"
      />
      <text x="44" y="49" textAnchor="middle" fontSize="22" fontWeight="600" fill="var(--text)">
        {score}
      </text>
    </svg>
  );
}
