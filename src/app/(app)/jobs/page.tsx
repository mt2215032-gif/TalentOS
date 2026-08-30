import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { listJobs } from '@/lib/job/service';
import { JobsManager } from '@/components/app/jobs-manager';

export const metadata: Metadata = { title: 'Jobs' };
export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const jobs = await listJobs(session.user.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[var(--text)]">Jobs</h1>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Paste a job description and it becomes a weighted skill matrix the interview plans from.
        </p>
      </div>
      <JobsManager
        initialJobs={jobs.map((job) => ({
          id: job.id,
          title: job.title,
          company: job.company,
          seniority: job.seniority,
          status: job.status,
          createdAt: job.created_at.toISOString(),
          skillCount: job.analysis?.skills.length ?? 0,
        }))}
      />
    </div>
  );
}
