import { authedRoute, ok } from '@/lib/security/api';
import { listUsersForAdmin } from '@/lib/db/repositories/users';

export const runtime = 'nodejs';

/**
 * User listing for admins.
 *
 * Returns account metadata and aggregate scores only — no resumes, no
 * transcripts, no answers. An admin has no business reading a candidate's
 * interview content.
 */
export const GET = authedRoute({ adminOnly: true, rateLimit: 'readApi' }, async ({ request }) => {
  const url = new URL(request.url);
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);
  const offset = Math.max(Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

  const users = await listUsersForAdmin(limit, offset);
  return ok({
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
      status: user.status,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      interviewCount: Number.parseInt(user.interview_count, 10),
      averageScore: user.avg_score ? Number.parseFloat(user.avg_score) : null,
    })),
  });
});
