import { authedRoute, ok } from '@/lib/security/api';
import { ChangePasswordSchema } from '@/lib/schemas/api';
import { checkPasswordStrength, verifyPassword } from '@/lib/auth/password';
import { findUserById, updatePassword } from '@/lib/db/repositories/users';
import { createSession, revokeAllSessions } from '@/lib/auth/session';
import { AppError } from '@/lib/security/errors';

export const runtime = 'nodejs';

export const POST = authedRoute(
  { schema: ChangePasswordSchema, rateLimit: 'passwordChange' },
  async ({ body, user, request }) => {
    const record = await findUserById(user.id);
    if (!record?.password_hash) {
      throw new AppError('bad_request', 'This account does not use a password.');
    }

    const currentOk = await verifyPassword(body.currentPassword, record.password_hash);
    if (!currentOk) {
      throw new AppError('unauthorized', 'Your current password is not correct.', {
        fields: { currentPassword: 'That is not your current password.' },
      });
    }

    const strength = checkPasswordStrength(body.newPassword);
    if (!strength.ok) {
      throw new AppError('validation_failed', 'That password is not strong enough.', {
        fields: { newPassword: strength.problems.join(' ') },
      });
    }

    await updatePassword(user.id, body.newPassword);

    // Every existing session dies, including any an attacker holds. The current
    // browser is then re-issued one so the user is not signed out of the tab
    // they just used.
    await revokeAllSessions(user.id);
    await createSession({
      userId: user.id,
      userAgent: request.headers.get('user-agent'),
      ip: request.headers.get('x-forwarded-for'),
    });

    return ok({ updated: true });
  },
);
