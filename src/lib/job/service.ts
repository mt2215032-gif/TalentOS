import { generate } from '@/lib/ai';
import { JobAnalysisSchema, type JobAnalysis } from '@/lib/schemas/ai';
import { SYSTEM_PROMPTS, jobAnalysisPrompt } from '@/lib/ai/prompts';
import { resolveSkill } from '@/lib/ai/taxonomy';
import { query, queryOne, transaction } from '@/lib/db/client';
import { notFound } from '@/lib/security/errors';
import type { Importance, Requirement } from '@/lib/schemas/domain';

/**
 * Job description ingestion and the Job Skill Matrix.
 *
 * The matrix is the contract between job analysis and interview planning: each
 * skill carries a requirement level, an importance, and a derived weight the
 * planner uses to allocate question budget.
 */

export interface JobRecord {
  id: string;
  user_id: string;
  title: string;
  company: string | null;
  location: string | null;
  employment_type: string | null;
  seniority: string | null;
  description: string;
  source_url: string | null;
  status: 'pending' | 'analyzing' | 'ready' | 'failed';
  failure_reason: string | null;
  analysis: JobAnalysis | null;
  analyzed_at: Date | null;
  created_at: Date;
}

export interface JobSkillRecord {
  id: string;
  job_id: string;
  skill_key: string;
  skill_label: string;
  category: string;
  requirement: Requirement;
  importance: Importance;
  weight: string;
  evidence: string | null;
}

/**
 * Weight used by the planner.
 *
 * A required-critical skill is worth ten times a nice-to-have, which is what
 * makes the question budget follow what the job actually needs.
 */
export function skillWeight(requirement: Requirement, importance: Importance): number {
  const requirementFactor = { required: 1, preferred: 0.6, nice_to_have: 0.3 }[requirement];
  const importanceFactor = { critical: 1, high: 0.8, medium: 0.5, low: 0.25 }[importance];
  return Math.round(requirementFactor * importanceFactor * 1000) / 1000;
}

export interface CreateJobInput {
  userId: string;
  title?: string;
  description: string;
  company?: string | null;
  sourceUrl?: string | null;
}

export async function createJob(input: CreateJobInput): Promise<JobRecord> {
  const inserted = await queryOne<JobRecord>(
    `INSERT INTO jobs (user_id, title, company, description, source_url, status)
     VALUES ($1, $2, $3, $4, $5, 'analyzing')
     RETURNING *`,
    [
      input.userId,
      (input.title?.trim() || 'Untitled role').slice(0, 160),
      input.company?.trim() || null,
      input.description,
      input.sourceUrl?.trim() || null,
    ],
  );
  if (!inserted) throw new Error('Job insert returned no row.');

  try {
    const { data: analysis } = await generate({
      task: 'job_analysis',
      system: SYSTEM_PROMPTS.jobAnalysis,
      prompt: jobAnalysisPrompt(input.description, input.title),
      schema: JobAnalysisSchema,
      schemaName: 'JobAnalysis',
      context: { description: input.description, titleHint: input.title },
      userId: input.userId,
      maxOutputTokens: 6000,
    });

    await persistJobSkills(input.userId, inserted.id, analysis);

    const updated = await queryOne<JobRecord>(
      `UPDATE jobs
          SET status = 'ready',
              analysis = $2,
              analyzed_at = now(),
              failure_reason = NULL,
              -- The user's own title wins; the extracted one fills a blank.
              title = COALESCE(NULLIF($3, ''), title),
              company = COALESCE(company, $4),
              location = COALESCE(location, $5),
              employment_type = COALESCE(employment_type, $6),
              seniority = COALESCE(seniority, $7)
        WHERE id = $1
        RETURNING *`,
      [
        inserted.id,
        JSON.stringify(analysis),
        input.title?.trim() ?? '',
        analysis.company,
        analysis.location,
        analysis.employmentType,
        analysis.seniority,
      ],
    );
    if (!updated) throw new Error('Job update returned no row.');
    return updated;
  } catch (error) {
    await query('UPDATE jobs SET status = $2, failure_reason = $3 WHERE id = $1', [
      inserted.id,
      'failed',
      error instanceof Error ? error.message.slice(0, 500) : 'Analysis failed.',
    ]);
    throw error;
  }
}

async function persistJobSkills(
  userId: string,
  jobId: string,
  analysis: JobAnalysis,
): Promise<void> {
  await transaction(async (tx) => {
    await tx.query('DELETE FROM job_skills WHERE job_id = $1', [jobId]);

    const seen = new Set<string>();
    for (const skill of analysis.skills) {
      const resolved = resolveSkill(skill.label, skill.category);
      if (seen.has(resolved.key)) continue;
      seen.add(resolved.key);

      await tx.query(
        `INSERT INTO job_skills
           (job_id, user_id, skill_key, skill_label, category, requirement, importance, weight, evidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          jobId,
          userId,
          resolved.key,
          resolved.label,
          resolved.category,
          skill.requirement,
          skill.importance,
          skillWeight(skill.requirement, skill.importance),
          skill.evidence,
        ],
      );
    }
  });
}

export async function listJobs(userId: string): Promise<JobRecord[]> {
  return query<JobRecord>('SELECT * FROM jobs WHERE user_id = $1 ORDER BY created_at DESC', [
    userId,
  ]);
}

export async function getJob(userId: string, jobId: string): Promise<JobRecord> {
  const row = await queryOne<JobRecord>('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [
    jobId,
    userId,
  ]);
  if (!row) throw notFound('job');
  return row;
}

export async function getJobSkills(userId: string, jobId: string): Promise<JobSkillRecord[]> {
  return query<JobSkillRecord>(
    `SELECT * FROM job_skills
      WHERE job_id = $1 AND user_id = $2
      ORDER BY weight DESC, skill_label ASC`,
    [jobId, userId],
  );
}

export async function deleteJob(userId: string, jobId: string): Promise<void> {
  const result = await query('DELETE FROM jobs WHERE id = $1 AND user_id = $2 RETURNING id', [
    jobId,
    userId,
  ]);
  if (result.length === 0) throw notFound('job');
}

/**
 * Skill-level fit between a CV and a job.
 *
 * Drives the "you are missing X" panel before an interview starts. It compares
 * claims to requirements — it says nothing about whether the candidate can
 * actually do the work, which is what the interview is for.
 */
export interface SkillGapRow {
  skill_key: string;
  skill_label: string;
  requirement: Requirement;
  importance: Importance;
  claimed: boolean;
}

export async function compareResumeToJob(
  userId: string,
  jobId: string,
  resumeId: string | null,
): Promise<SkillGapRow[]> {
  return query<SkillGapRow>(
    `SELECT js.skill_key,
            js.skill_label,
            js.requirement,
            js.importance,
            (cs.id IS NOT NULL) AS claimed
       FROM job_skills js
       LEFT JOIN candidate_skills cs
              ON cs.skill_key = js.skill_key
             AND cs.user_id = js.user_id
             AND ($3::uuid IS NULL OR cs.resume_id = $3)
      WHERE js.job_id = $1 AND js.user_id = $2
      ORDER BY js.weight DESC`,
    [jobId, userId, resumeId],
  );
}
