import { authedRoute, ok } from '@/lib/security/api';
import { getInterviewView } from '@/lib/interview/history';
import { notFound } from '@/lib/security/errors';

export const runtime = 'nodejs';

/**
 * The interview room's view of a session.
 *
 * Deliberately excludes engine state, grading criteria and per-answer scores —
 * everything a candidate must not see while the interview is running.
 */
export const GET = authedRoute({ rateLimit: 'readApi' }, async ({ params, user }) => {
  const id = params['id'];
  if (!id) throw notFound('interview');

  const view = await getInterviewView(user.id, id);
  if (!view) throw notFound('interview');
  return ok(view);
});
