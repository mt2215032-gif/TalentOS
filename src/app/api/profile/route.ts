import { authedRoute, ok } from '@/lib/security/api';
import { ProfileUpdateSchema } from '@/lib/schemas/api';
import { getProfile, updateProfile } from '@/lib/db/repositories/users';
import { getUsage } from '@/lib/billing/entitlements';
import { getUserCostSummary } from '@/lib/analytics/metrics';

export const runtime = 'nodejs';

export const GET = authedRoute({ rateLimit: 'readApi' }, async ({ user }) => {
  const [profile, usage, cost] = await Promise.all([
    getProfile(user.id),
    getUsage(user.id, user.plan),
    getUserCostSummary(user.id),
  ]);

  return ok({
    user: { id: user.id, email: user.email, role: user.role, plan: user.plan },
    profile: profile
      ? {
          fullName: profile.full_name,
          headline: profile.headline,
          location: profile.location,
          phone: profile.phone,
          links: profile.links,
          yearsExperience: profile.years_experience
            ? Number.parseFloat(profile.years_experience)
            : null,
          seniority: profile.seniority,
          targetRole: profile.target_role,
          targetIndustry: profile.target_industry,
          onboardingDone: profile.onboarding_done_at !== null,
        }
      : null,
    usage,
    cost,
  });
});

export const PATCH = authedRoute(
  { schema: ProfileUpdateSchema, rateLimit: 'readApi' },
  async ({ body, user }) => {
    const profile = await updateProfile(user.id, body);
    return ok({
      profile: {
        fullName: profile.full_name,
        headline: profile.headline,
        location: profile.location,
        phone: profile.phone,
        links: profile.links,
        yearsExperience: profile.years_experience
          ? Number.parseFloat(profile.years_experience)
          : null,
        seniority: profile.seniority,
        targetRole: profile.target_role,
        targetIndustry: profile.target_industry,
        onboardingDone: profile.onboarding_done_at !== null,
      },
    });
  },
);
