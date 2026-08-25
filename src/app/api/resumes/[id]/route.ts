import { authedRoute, ok } from '@/lib/security/api';
import { deleteResume, getResume, setPrimaryResume } from '@/lib/resume/service';
import { notFound } from '@/lib/security/errors';

export const runtime = 'nodejs';

export const GET = authedRoute({ rateLimit: 'readApi' }, async ({ params, user }) => {
  const id = params['id'];
  if (!id) throw notFound('resume');
  const resume = await getResume(user.id, id);
  return ok({
    resume: {
      id: resume.id,
      fileName: resume.file_name,
      status: resume.status,
      failureReason: resume.failure_reason,
      isPrimary: resume.is_primary,
      createdAt: resume.created_at,
      analysis: resume.analysis,
    },
  });
});

/** Promote a CV to primary — the one interviews default to. */
export const PATCH = authedRoute({ rateLimit: 'readApi' }, async ({ params, user }) => {
  const id = params['id'];
  if (!id) throw notFound('resume');
  await setPrimaryResume(user.id, id);
  return ok({ isPrimary: true });
});

export const DELETE = authedRoute({ rateLimit: 'readApi' }, async ({ params, user }) => {
  const id = params['id'];
  if (!id) throw notFound('resume');
  await deleteResume(user.id, id);
  return ok({ deleted: true });
});
