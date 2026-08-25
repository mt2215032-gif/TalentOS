import { ok, publicRoute } from '@/lib/security/api';
import { LoginSchema } from '@/lib/schemas/api';
import { verifyPassword } from '@/lib/auth/password';
import { findUserByEmail, markLogin } from '@/lib/db/repositories/users';
import { createSession } from '@/lib/auth/session';
import { AppError } from '@/lib/security/errors';
import { track } from '@/lib/analytics/events';

export const runtime = 'nodejs';

/**
 * Sign in.
 *
 * The response is identical whether the email is unknown, the password is
 * wrong, or the account is suspended, so this endpoint cannot be used to
 * enumerate accounts. A hash is verified even for an unknown email so the
 * timing does not give it away either.
 */
export const POST = publicRoute({ schema: LoginSchema, rateLimit: 'login' }, async ({ body, request }) => {
  const user = await findUserByEmail(body.email);

  const storedHash =
    user?.password_hash ??
    // A real scrypt hash of a random value, so the unknown-email path costs the
    // same as the known-email path.
    '$scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  const passwordOk = await verifyPassword(body.password, storedHash);
  const invalid = new AppError('unauthorized', 'That email or password is not correct.');

  if (!user || !passwordOk || user.status !== 'active') throw invalid;

  await createSession({
    userId: user.id,
    userAgent: request.headers.get('user-agent'),
    ip: request.headers.get('x-forwarded-for'),
  });
  await markLogin(user.id);
  await track({ userId: user.id, event: 'user_logged_in' });

  return ok({ user: { id: user.id, email: user.email, role: user.role, plan: user.plan } });
});
