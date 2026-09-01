import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { listJobs } from '@/lib/job/service';
import { listResumes } from '@/lib/resume/service';
import { getUsage } from '@/lib/billing/entitlements';
import { NewInterviewForm } from '@/components/interview/new-form';

export const metadata: Metadata = { title: 'New interview' };
export const dynamic = 'force-dynamic';

export default async function NewInterviewPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [jobs, resumes, usage] = await Promise.all([
    listJobs(session.user.id),
    listResumes(session.user.id),
    getUsage(session.user.id, session.user.plan),
  ]);

  const interviewQuota = usage.find((entry) => entry.metric === 'interviews');

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-[24px] font-semibold tracking-tight text-[var(--text)]">
        Set up your interview
      </h1>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">
        The more context you give, the more specific the questions will be.
      </p>

      <div className="mt-6">
        <NewInterviewForm
          jobs={jobs
            .filter((job) => job.status === 'ready')
            .map((job) => ({ id: job.id, title: job.title, company: job.company }))}
          resumes={resumes
            .filter((resume) => resume.status === 'ready')
            .map((resume) => ({
              id: resume.id,
              fileName: resume.file_name,
              isPrimary: resume.is_primary,
            }))}
          remaining={interviewQuota?.remaining ?? null}
        />
      </div>
    </div>
  );
}
