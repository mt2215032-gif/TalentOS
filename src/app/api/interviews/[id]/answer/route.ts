import { authedRoute, ok } from '@/lib/security/api';
import { SubmitAnswerSchema } from '@/lib/schemas/api';
import { submitAnswer } from '@/lib/interview/engine';
import { consumeQuota } from '@/lib/billing/entitlements';
import { notFound } from '@/lib/security/errors';
import { track } from '@/lib/analytics/events';

export const runtime = 'nodejs';
export const maxDuration = 120;

export const POST = authedRoute(
  { schema: SubmitAnswerSchema, rateLimit: 'answerSubmit' },
  async ({ body, params, user }) => {
    const interviewId = params['id'];
    if (!interviewId) throw notFound('interview');

    // Each turn costs an analysis plus a generation, so it counts against the
    // AI question quota rather than being unlimited inside a started interview.
    await consumeQuota(user.id, user.plan, 'ai_questions');

    const result = await submitAnswer({
      userId: user.id,
      interviewId,
      questionId: body.questionId,
      answerText: body.answerText,
      responseSeconds: body.responseSeconds ?? null,
      transcriptSource: body.transcriptSource,
    });

    if (result.isComplete) {
      await track({
        userId: user.id,
        event: 'interview_finished',
        entityId: interviewId,
        props: { answered: result.answeredCount },
      });
    }

    return ok(result);
  },
);
