'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { Button, Card, CardHeader, ErrorNote, Field, inputClass } from '@/components/ui/primitives';
import { useHydrated } from '@/components/ui/use-hydrated';

interface Initial {
  fullName: string;
  headline: string;
  location: string;
  targetRole: string;
  targetIndustry: string;
  seniority: string;
  yearsExperience: number | null;
}

const SENIORITY_OPTIONS = ['', 'intern', 'junior', 'mid', 'senior', 'lead', 'principal'] as const;

export function ProfileForm({ initial, email }: { initial: Initial; email: string }) {
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();

  function set<K extends keyof Initial>(key: K, value: Initial[K]): void {
    setValues((previous) => ({ ...previous, [key]: value }));
    setSaved(false);
  }

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await api.patch('/api/profile', {
        fullName: values.fullName.trim() || null,
        headline: values.headline.trim() || null,
        location: values.location.trim() || null,
        targetRole: values.targetRole.trim() || null,
        targetIndustry: values.targetIndustry.trim() || null,
        seniority: values.seniority || null,
        yearsExperience: values.yearsExperience,
      });
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Your profile could not be saved.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Profile" description="Used to frame interviews when no CV is attached." />
      <form onSubmit={save} className="space-y-4" noValidate>
        {error ? <ErrorNote>{error}</ErrorNote> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="fullName">
            <input
              id="fullName"
              value={values.fullName}
              onChange={(event) => set('fullName', event.target.value)}
              className={inputClass}
              maxLength={160}
            />
          </Field>
          <Field label="Email" htmlFor="email" hint="Contact support to change this.">
            <input id="email" value={email} className={inputClass} disabled readOnly />
          </Field>
        </div>

        <Field label="Headline" htmlFor="headline" hint="e.g. Senior Data Engineer, fintech.">
          <input
            id="headline"
            value={values.headline}
            onChange={(event) => set('headline', event.target.value)}
            className={inputClass}
            maxLength={200}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Target role" htmlFor="targetRole">
            <input
              id="targetRole"
              value={values.targetRole}
              onChange={(event) => set('targetRole', event.target.value)}
              className={inputClass}
              maxLength={160}
            />
          </Field>
          <Field label="Target industry" htmlFor="targetIndustry">
            <input
              id="targetIndustry"
              value={values.targetIndustry}
              onChange={(event) => set('targetIndustry', event.target.value)}
              className={inputClass}
              maxLength={160}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Seniority" htmlFor="seniority">
            <select
              id="seniority"
              value={values.seniority}
              onChange={(event) => set('seniority', event.target.value)}
              className={inputClass}
            >
              {SENIORITY_OPTIONS.map((option) => (
                <option key={option || 'none'} value={option}>
                  {option === '' ? 'Not set' : option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Years of experience" htmlFor="yearsExperience">
            <input
              id="yearsExperience"
              type="number"
              min={0}
              max={60}
              step={0.5}
              value={values.yearsExperience ?? ''}
              onChange={(event) =>
                set('yearsExperience', event.target.value === '' ? null : Number(event.target.value))
              }
              className={inputClass}
            />
          </Field>
          <Field label="Location" htmlFor="location">
            <input
              id="location"
              value={values.location}
              onChange={(event) => set('location', event.target.value)}
              className={inputClass}
              maxLength={160}
            />
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" loading={pending} disabled={!hydrated}>
            Save profile
          </Button>
          {saved ? (
            <span className="animate-fade-in text-[13px] text-[var(--success)]">Saved.</span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
