import { authedRoute, ok } from '@/lib/security/api';
import { evaluateInterview, getReport } from '@/lib/interview/evaluation';
import { loadInterview } from '@/lib/interview/engine';
import { notFound } from '@/lib/security/errors';
import { track } from '@/lib/analytics/events';

export const runtime = 'nodejs';
/** Final evaluation is the longest AI call in the product. */
export const maxDuration = 180;

/** Fetch a saved report, or null when it has not been generated yet. */
export const GET = authedRoute({ rateLimit: 'readApi' }, async ({ params, user }) => {
  const id = params['id'];
  if (!id) throw notFound('interview');

  const report = await getReport(user.id, id);
  if (!report) return ok({ report: null });

  return ok({
    evaluationId: report.evaluationId,
    interview: {
      id: report.interview.id,
      roleTitle: report.interview.role_title,
      interviewType: report.interview.interview_type,
      difficulty: report.interview.difficulty,
      status: report.interview.status,
      completedAt: report.interview.completed_at,
      durationSeconds: report.interview.duration_seconds,
      engineProvider: report.interview.engine_provider,
    },
    report: report.report,
    learningPlan: report.learningPlan,
    transcript: report.transcript,
  });
});

/** Generate the report. Idempotent — a second call returns the saved one. */
export const POST = authedRoute({ rateLimit: 'reportGenerate' }, async ({ params, user }) => {
  const id = params['id'];
  if (!id) throw notFound('interview');

  // Ownership is established before any AI spend.
  await loadInterview(user.id, id);

  const result = await evaluateInterview(user.id, id);
  await track({
    userId: user.id,
    event: 'report_generated',
    entityId: id,
    props: { score: result.report.overallScore, verdict: result.report.verdict },
  });

  return ok({
    evaluationId: result.evaluationId,
    report: result.report,
    learningPlan: result.learningPlan,
  });
});
