import { authedRoute, ok } from '@/lib/security/api';
import { CreateJobSchema } from '@/lib/schemas/api';
import { createJob, listJobs } from '@/lib/job/service';
import { track } from '@/lib/analytics/events';

export const runtime = 'nodejs';

export const GET = authedRoute({ rateLimit: 'readApi' }, async ({ user }) => {
  const jobs = await listJobs(user.id);
  return ok({
    jobs: jobs.map((job) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      seniority: job.seniority,
      status: job.status,
      createdAt: job.created_at,
      skillCount: job.analysis?.skills.length ?? 0,
    })),
  });
});

export const POST = authedRoute(
  { schema: CreateJobSchema, rateLimit: 'jobCreate' },
  async ({ body, user }) => {
    const job = await createJob({
      userId: user.id,
      title: body.title,
      company: body.company ?? null,
      sourceUrl: body.sourceUrl ?? null,
      description: body.description,
    });

    await track({
      userId: user.id,
      event: 'job_analyzed',
      entityId: job.id,
      props: { skills: job.analysis?.skills.length ?? 0 },
    });

    return ok({ job: { id: job.id, title: job.title, status: job.status, analysis: job.analysis } }, { status: 201 });
  },
);
