import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getProfile } from '@/lib/db/repositories/users';
import { listResumes } from '@/lib/resume/service';
import { getUsage } from '@/lib/billing/entitlements';
import { getUserCostSummary } from '@/lib/analytics/metrics';
import { getPlan, METRIC_LABELS } from '@/lib/billing/plans';
import { Card, CardHeader, ProgressBar } from '@/components/ui/primitives';
import { ResumeManager } from '@/components/app/resume-manager';
import { ProfileForm } from '@/components/app/profile-form';

export const metadata: Metadata = { title: 'CV & profile' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [profile, resumes, usage, cost] = await Promise.all([
    getProfile(session.user.id),
    listResumes(session.user.id),
    getUsage(session.user.id, session.user.plan),
    getUserCostSummary(session.user.id),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[var(--text)]">CV & profile</h1>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Your CV is what lets the interviewer test what you claim rather than ask generic questions.
        </p>
      </div>

      <ResumeManager
        initialResumes={resumes.map((resume) => ({
          id: resume.id,
          fileName: resume.file_name,
          status: resume.status,
          failureReason: resume.failure_reason,
          isPrimary: resume.is_primary,
          createdAt: resume.created_at.toISOString(),
          headline: resume.analysis?.headline ?? null,
          skillCount: resume.analysis?.skills.length ?? 0,
          skills: resume.analysis?.skills.slice(0, 24).map((skill) => skill.label) ?? [],
          probeCount: resume.analysis?.probeTargets.length ?? 0,
          yearsExperience: resume.analysis?.totalYearsExperience ?? null,
        }))}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProfileForm
            initial={{
              fullName: profile?.full_name ?? '',
              headline: profile?.headline ?? '',
              location: profile?.location ?? '',
              targetRole: profile?.target_role ?? '',
              targetIndustry: profile?.target_industry ?? '',
              seniority: profile?.seniority ?? '',
              yearsExperience: profile?.years_experience
                ? Number.parseFloat(profile.years_experience)
                : null,
            }}
            email={session.user.email}
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Usage this month" description={`${getPlan(session.user.plan).name} plan`} />
            <ul className="space-y-3">
              {usage.map((entry) => (
                <li key={entry.metric}>
                  <div className="mb-1 flex items-baseline justify-between text-[12px]">
                    <span className="text-[var(--text-muted)]">{METRIC_LABELS[entry.metric]}</span>
                    <span className="font-medium tabular-nums text-[var(--text)]">
                      {entry.used}
                      {entry.limit === null ? ' / ∞' : ` / ${entry.limit}`}
                    </span>
                  </div>
                  <ProgressBar
                    value={entry.limit === null ? 0 : entry.used}
                    max={entry.limit ?? 1}
                    color={
                      entry.limit !== null && entry.used >= entry.limit
                        ? 'var(--viz-bad)'
                        : 'var(--viz-accent)'
                    }
                  />
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="AI processing"
              description="What your interviews have cost to run."
            />
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-[var(--text-muted)]">Total</dt>
                <dd className="font-medium tabular-nums text-[var(--text)]">
                  ${cost.totalUsd.toFixed(4)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--text-muted)]">Per interview</dt>
                <dd className="font-medium tabular-nums text-[var(--text)]">
                  {cost.averagePerInterviewUsd === null
                    ? '—'
                    : `$${cost.averagePerInterviewUsd.toFixed(4)}`}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-subtle)]">
              Shown for transparency. Interviews run on the offline engine cost nothing.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
