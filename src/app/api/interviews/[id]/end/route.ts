import { authedRoute, ok } from '@/lib/security/api';
import { endInterview } from '@/lib/interview/engine';
import { notFound } from '@/lib/security/errors';

export const runtime = 'nodejs';

export const POST = authedRoute({ rateLimit: 'readApi' }, async ({ params, user }) => {
  const id = params['id'];
  if (!id) throw notFound('interview');
  await endInterview(user.id, id);
  return ok({ status: 'evaluating' });
});
