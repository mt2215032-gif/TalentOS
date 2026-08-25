import { authedRoute, ok } from '@/lib/security/api';
import { StartInterviewSchema } from '@/lib/schemas/api';
import { startInterview } from '@/lib/interview/engine';
import { listInterviews } from '@/lib/interview/history';
import { consumeQuota } from '@/lib/billing/entitlements';
import { track } from '@/lib/analytics/events';

export const runtime = 'nodejs';
/** Interview turns call an LLM; the default 15s serverless budget is not enough. */
export const maxDuration = 120;

export const GET = authedRoute({ rateLimit: 'readApi' }, async ({ user }) => {
  const interviews = await listInterviews(user.id, 50, 0);
  return ok({ interviews });
});

export const POST = authedRoute(
  { schema: StartInterviewSchema, rateLimit: 'interviewStart' },
  async ({ body, user }) => {
    await consumeQuota(user.id, user.plan, 'interviews');

    const turn = await startInterview({
      userId: user.id,
      roleTitle: body.roleTitle,
      interviewType: body.interviewType,
      difficulty: body.difficulty,
      plannedQuestions: body.questionCount,
      jobId: body.jobId ?? null,
      resumeId: body.resumeId ?? null,
    });

    await track({
      userId: user.id,
      event: 'interview_started',
      entityId: turn.interviewId,
      props: { type: body.interviewType, difficulty: body.difficulty, questions: body.questionCount },
    });

    return ok({ turn }, { status: 201 });
  },
);
