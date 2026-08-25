import { ok, publicRoute } from '@/lib/security/api';
import { getSession } from '@/lib/auth/session';
import { getProfile } from '@/lib/db/repositories/users';
import { getUsage } from '@/lib/billing/entitlements';

export const runtime = 'nodejs';

/** Current session, for client bootstrapping. Returns null when signed out. */
export const GET = publicRoute({}, async () => {
  const session = await getSession();
  if (!session) return ok({ user: null });

  const [profile, usage] = await Promise.all([
    getProfile(session.user.id),
    getUsage(session.user.id, session.user.plan),
  ]);

  return ok({
    user: session.user,
    profile: profile
      ? { fullName: profile.full_name, headline: profile.headline, targetRole: profile.target_role }
      : null,
    usage,
  });
});
