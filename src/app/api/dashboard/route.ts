import { authedRoute, ok } from '@/lib/security/api';
import { getDashboard } from '@/lib/interview/history';
import { getUsage } from '@/lib/billing/entitlements';

export const runtime = 'nodejs';

export const GET = authedRoute({ rateLimit: 'readApi' }, async ({ user }) => {
  const [dashboard, usage] = await Promise.all([
    getDashboard(user.id),
    getUsage(user.id, user.plan),
  ]);
  return ok({ ...dashboard, usage, plan: user.plan });
});
