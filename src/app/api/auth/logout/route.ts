import { ok, publicRoute } from '@/lib/security/api';
import { destroySession } from '@/lib/auth/session';

export const runtime = 'nodejs';

export const POST = publicRoute({}, async () => {
  await destroySession();
  return ok({ signedOut: true });
});
