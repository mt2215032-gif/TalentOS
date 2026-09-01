import { authedRoute, ok } from '@/lib/security/api';
import { compareResumeToJob, deleteJob, getJob, getJobSkills } from '@/lib/job/service';
import { getPrimaryResume } from '@/lib/resume/service';
import { notFound } from '@/lib/security/errors';

export const runtime = 'nodejs';

export const GET = authedRoute({ rateLimit: 'readApi' }, async ({ params, user }) => {
  const id = params['id'];
  if (!id) throw notFound('job');

  const job = await getJob(user.id, id);
  const [skills, primaryResume] = await Promise.all([
    getJobSkills(user.id, id),
    getPrimaryResume(user.id),
  ]);
  const fit = await compareResumeToJob(user.id, id, primaryResume?.id ?? null);

  return ok({
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      seniority: job.seniority,
      status: job.status,
      description: job.description,
      createdAt: job.created_at,
      analysis: job.analysis,
    },
    skills: skills.map((skill) => ({
      key: skill.skill_key,
      label: skill.skill_label,
      category: skill.category,
      requirement: skill.requirement,
      importance: skill.importance,
      weight: Number.parseFloat(skill.weight),
      evidence: skill.evidence,
    })),
    // A claim on the CV, not a demonstrated ability — the interview decides that.
    fit: fit.map((row) => ({
      label: row.skill_label,
      requirement: row.requirement,
      importance: row.importance,
      claimedOnCv: row.claimed,
    })),
  });
});

export const DELETE = authedRoute({ rateLimit: 'readApi' }, async ({ params, user }) => {
  const id = params['id'];
  if (!id) throw notFound('job');
  await deleteJob(user.id, id);
  return ok({ deleted: true });
});
