import { NextResponse } from 'next/server';
import { ok, publicRoute } from '@/lib/security/api';
import { RegisterSchema } from '@/lib/schemas/api';
import { checkPasswordStrength } from '@/lib/auth/password';
import { createUser, findUserByEmail, markLogin } from '@/lib/db/repositories/users';
import { createSession } from '@/lib/auth/session';
import { AppError } from '@/lib/security/errors';
import { track } from '@/lib/analytics/events';

export const runtime = 'nodejs';

export const POST = publicRoute(
  { schema: RegisterSchema, rateLimit: 'register' },
  async ({ body, request }) => {
    const strength = checkPasswordStrength(body.password);
    if (!strength.ok) {
      throw new AppError('validation_failed', 'That password is not strong enough.', {
        fields: { password: strength.problems.join(' ') },
      });
    }

    // Checked here for a clean field-level message; createUser re-checks inside
    // its transaction, which is what actually prevents the race.
    const existing = await findUserByEmail(body.email);
    if (existing) {
      throw new AppError('conflict', 'An account with that email already exists.', {
        fields: { email: 'An account with that email already exists.' },
      });
    }

    const user = await createUser({
      email: body.email,
      password: body.password,
      fullName: body.fullName ?? null,
    });

    await createSession({
      userId: user.id,
      userAgent: request.headers.get('user-agent'),
      ip: request.headers.get('x-forwarded-for'),
    });
    await markLogin(user.id);
    await track({ userId: user.id, event: 'user_registered' });

    return ok({
      user: { id: user.id, email: user.email, role: user.role, plan: user.plan },
    }, { status: 201 }) as NextResponse;
  },
);
