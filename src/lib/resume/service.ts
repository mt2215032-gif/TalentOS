import { generate } from '@/lib/ai';
import { CandidateAnalysisSchema, type CandidateAnalysis } from '@/lib/schemas/ai';
import { SYSTEM_PROMPTS, resumeAnalysisPrompt } from '@/lib/ai/prompts';
import { resolveSkill } from '@/lib/ai/taxonomy';
import { query, queryOne, transaction } from '@/lib/db/client';
import { extractDocumentText } from '@/lib/resume/extract';
import { notFound } from '@/lib/security/errors';

/**
 * Resume ingestion: extract, analyse, normalise, persist.
 *
 * The structured analysis is stored twice on purpose — as a JSON document on
 * the resume row (the exact object the engine consumes) and as normalised rows
 * in candidate_skills and friends (so skill coverage is queryable in SQL for
 * analytics and gap reporting).
 */

export interface ResumeRecord {
  id: string;
  user_id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  content_hash: string;
  raw_text: string;
  status: 'pending' | 'analyzing' | 'ready' | 'failed';
  failure_reason: string | null;
  analysis: CandidateAnalysis | null;
  analyzed_at: Date | null;
  is_primary: boolean;
  created_at: Date;
}

export interface IngestResumeInput {
  userId: string;
  fileName: string;
  bytes: Uint8Array;
  makePrimary?: boolean;
}

export async function ingestResume(input: IngestResumeInput): Promise<ResumeRecord> {
  const extracted = await extractDocumentText({ bytes: input.bytes, fileName: input.fileName });

  // Re-uploading the same file returns the existing analysis rather than
  // spending tokens on work already done.
  const existing = await queryOne<ResumeRecord>(
    `SELECT * FROM resumes
      WHERE user_id = $1 AND content_hash = $2 AND status = 'ready'
      ORDER BY created_at DESC LIMIT 1`,
    [input.userId, extracted.contentHash],
  );
  if (existing) {
    if (input.makePrimary !== false) await setPrimaryResume(input.userId, existing.id);
    return existing;
  }

  const inserted = await queryOne<ResumeRecord>(
    `INSERT INTO resumes (user_id, file_name, mime_type, byte_size, content_hash, raw_text, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'analyzing')
     RETURNING *`,
    [
      input.userId,
      input.fileName.slice(0, 255),
      extracted.mimeType,
      extracted.byteSize,
      extracted.contentHash,
      extracted.text,
    ],
  );
  if (!inserted) throw new Error('Resume insert returned no row.');

  try {
    const { data: analysis, meta } = await generate({
      task: 'resume_analysis',
      system: SYSTEM_PROMPTS.resumeAnalysis,
      prompt: resumeAnalysisPrompt(extracted.text),
      schema: CandidateAnalysisSchema,
      schemaName: 'CandidateAnalysis',
      context: { rawText: extracted.text },
      userId: input.userId,
      maxOutputTokens: 8000,
    });

    await persistCandidateFacts(input.userId, inserted.id, analysis);

    const updated = await queryOne<ResumeRecord>(
      `UPDATE resumes
          SET status = 'ready', analysis = $2, analyzed_at = now(), failure_reason = NULL
        WHERE id = $1
        RETURNING *`,
      [inserted.id, JSON.stringify(analysis)],
    );
    if (!updated) throw new Error('Resume update returned no row.');

    if (input.makePrimary !== false) await setPrimaryResume(input.userId, updated.id);
    void meta;
    return updated;
  } catch (error) {
    // The upload is kept in a failed state so the user can see what happened
    // and retry, rather than the row vanishing.
    await query(
      `UPDATE resumes SET status = 'failed', failure_reason = $2 WHERE id = $1`,
      [inserted.id, error instanceof Error ? error.message.slice(0, 500) : 'Analysis failed.'],
    );
    throw error;
  }
}

/** Write the normalised projection of a CandidateAnalysis. */
async function persistCandidateFacts(
  userId: string,
  resumeId: string,
  analysis: CandidateAnalysis,
): Promise<void> {
  await transaction(async (tx) => {
    // Re-analysis replaces the previous projection for this resume.
    for (const table of [
      'candidate_skills',
      'candidate_experiences',
      'candidate_projects',
      'candidate_education',
      'candidate_certifications',
    ]) {
      await tx.query(`DELETE FROM ${table} WHERE resume_id = $1`, [resumeId]);
    }

    const seenSkills = new Set<string>();
    for (const skill of analysis.skills) {
      const resolved = resolveSkill(skill.label, skill.category);
      // The taxonomy can map two CV spellings onto one skill; the unique index
      // on (resume_id, skill_key) would otherwise reject the second.
      if (seenSkills.has(resolved.key)) continue;
      seenSkills.add(resolved.key);

      await tx.query(
        `INSERT INTO candidate_skills
           (user_id, resume_id, skill_key, skill_label, category, claimed_level, years_used, evidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          resumeId,
          resolved.key,
          resolved.label,
          resolved.category,
          skill.claimedLevel,
          skill.yearsUsed,
          skill.evidence,
        ],
      );
    }

    for (const [index, role] of analysis.experiences.entries()) {
      await tx.query(
        `INSERT INTO candidate_experiences
           (user_id, resume_id, company, title, start_date, end_date, is_current, summary,
            achievements, technologies, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          userId, resumeId, role.company, role.title, role.startDate, role.endDate,
          role.isCurrent, role.summary, JSON.stringify(role.achievements),
          JSON.stringify(role.technologies), index,
        ],
      );
    }

    for (const [index, project] of analysis.projects.entries()) {
      await tx.query(
        `INSERT INTO candidate_projects
           (user_id, resume_id, name, description, technologies, outcomes, url, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId, resumeId, project.name, project.description,
          JSON.stringify(project.technologies), project.outcomes, project.url, index,
        ],
      );
    }

    for (const [index, education] of analysis.education.entries()) {
      await tx.query(
        `INSERT INTO candidate_education
           (user_id, resume_id, institution, degree, field, start_date, end_date, grade, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          userId, resumeId, education.institution, education.degree, education.field,
          education.startDate, education.endDate, education.grade, index,
        ],
      );
    }

    for (const [index, certification] of analysis.certifications.entries()) {
      await tx.query(
        `INSERT INTO candidate_certifications
           (user_id, resume_id, name, issuer, issued_at, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, resumeId, certification.name, certification.issuer, certification.issuedAt, index],
      );
    }
  });
}

export async function setPrimaryResume(userId: string, resumeId: string): Promise<void> {
  await transaction(async (tx) => {
    // Scoping by user_id is what stops one user promoting another's resume.
    const owned = await tx.query('SELECT 1 FROM resumes WHERE id = $1 AND user_id = $2', [
      resumeId,
      userId,
    ]);
    if (!owned.rowCount) throw notFound('resume');

    await tx.query('UPDATE resumes SET is_primary = false WHERE user_id = $1 AND is_primary', [userId]);
    await tx.query('UPDATE resumes SET is_primary = true WHERE id = $1 AND user_id = $2', [
      resumeId,
      userId,
    ]);
  });
}

export async function listResumes(userId: string): Promise<ResumeRecord[]> {
  return query<ResumeRecord>(
    `SELECT * FROM resumes WHERE user_id = $1 ORDER BY is_primary DESC, created_at DESC`,
    [userId],
  );
}

export async function getResume(userId: string, resumeId: string): Promise<ResumeRecord> {
  const row = await queryOne<ResumeRecord>(
    'SELECT * FROM resumes WHERE id = $1 AND user_id = $2',
    [resumeId, userId],
  );
  if (!row) throw notFound('resume');
  return row;
}

export async function getPrimaryResume(userId: string): Promise<ResumeRecord | null> {
  return queryOne<ResumeRecord>(
    `SELECT * FROM resumes
      WHERE user_id = $1 AND status = 'ready'
      ORDER BY is_primary DESC, created_at DESC
      LIMIT 1`,
    [userId],
  );
}

export async function deleteResume(userId: string, resumeId: string): Promise<void> {
  const result = await query('DELETE FROM resumes WHERE id = $1 AND user_id = $2 RETURNING id', [
    resumeId,
    userId,
  ]);
  if (result.length === 0) throw notFound('resume');
}
