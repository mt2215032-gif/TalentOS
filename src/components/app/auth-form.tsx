'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { Button, Card, ErrorNote, Field, inputClass } from '@/components/ui/primitives';

/**
 * Sign in and registration.
 *
 * One component for both because the flows differ only in fields and endpoint.
 * Field-level errors from the server are rendered next to their input; anything
 * without a field lands in the form-level note.
 */
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const isRegister = mode === 'register';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});

    try {
      await api.post(isRegister ? '/api/auth/register' : '/api/auth/login', {
        email,
        password,
        ...(isRegister && fullName.trim() ? { fullName: fullName.trim() } : {}),
      });
      // A full navigation, so the server components re-read the new session.
      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fields);
        // A message already shown beside a field would otherwise appear twice.
        if (Object.keys(error.fields).length === 0) setFormError(error.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
      setPending(false);
    }
  }

  return (
    <Card raised className="w-full max-w-md">
      <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">
        {isRegister ? 'Create your account' : 'Sign in'}
      </h1>
      <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
        {isRegister
          ? 'Three interviews free every month. No card required.'
          : 'Pick up where you left off.'}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        {formError ? <ErrorNote>{formError}</ErrorNote> : null}

        {isRegister ? (
          <Field label="Full name" htmlFor="fullName" hint="Optional — used on your reports.">
            <input
              id="fullName"
              name="name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className={inputClass}
              placeholder="Maria Torres"
              maxLength={160}
            />
          </Field>
        ) : null}

        <Field label="Email" htmlFor="email" error={fieldErrors['email']}>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            placeholder="you@example.com"
            aria-invalid={Boolean(fieldErrors['email'])}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={fieldErrors['password']}
          {...(isRegister ? { hint: 'At least 10 characters, mixing letters with a number or symbol.' } : {})}
        >
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
            placeholder="••••••••••"
            aria-invalid={Boolean(fieldErrors['password'])}
          />
        </Field>

        <Button type="submit" loading={pending} className="w-full">
          {isRegister ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-[var(--text-muted)]">
        {isRegister ? 'Already have an account? ' : 'New to TalentOS? '}
        <Link
          href={isRegister ? '/login' : '/register'}
          className="font-medium text-[var(--accent-text)] hover:underline"
        >
          {isRegister ? 'Sign in' : 'Create one'}
        </Link>
      </p>
    </Card>
  );
}
