import { authedRoute, ok } from '@/lib/security/api';
import { getDailyUsage, getPlatformOverview } from '@/lib/analytics/metrics';

export const runtime = 'nodejs';

/** Admin-only. `adminOnly` returns the same 403 a stranger gets. */
export const GET = authedRoute({ adminOnly: true, rateLimit: 'readApi' }, async () => {
  const [overview, daily] = await Promise.all([getPlatformOverview(), getDailyUsage(30)]);
  return ok({ overview, daily });
});
