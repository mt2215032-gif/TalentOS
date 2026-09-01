import { generate, getProvider } from '@/lib/ai';
import {
  FinalReportSchema,
  LearningPlanSchema,
  type CandidateAnalysis,
  type FinalReport,
  type JobAnalysis,
  type LearningPlan,
} from '@/lib/schemas/ai';
import { SYSTEM_PROMPTS, finalEvaluationPrompt, learningPlanPrompt } from '@/lib/ai/prompts';
import { resolveSkill } from '@/lib/ai/taxonomy';
import { query, queryOne, transaction } from '@/lib/db/client';
import { conflict, notFound } from '@/lib/security/errors';
import { loadInterview } from '@/lib/interview/engine';
import type { AnswerRecord, InterviewRecord, QuestionRecord } from '@/lib/interview/types';

/**
 * Final evaluation.
 *
 * The report is built from evidence already gathered turn by turn, not from a
 * fresh read of the transcript alone — the per-answer analysis is passed in, so
 * the final score is consistent with how the interview actually went.
 *
 * The whole report, its skill scores, recommendations and learning plan are
 * written in one transaction: a half-saved report would show a candidate a
 * score with no explanation behind it.
 */

export interface EvaluationResult {
  evaluationId: string;
  report: FinalReport;
  learningPlan: LearningPlan;
}

export async function evaluateInterview(
  userId: string,
  interviewId: string,
): Promise<EvaluationResult> {
  const interview = await loadInterview(userId, interviewId);

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM evaluations WHERE interview_id = $1',
    [interviewId],
  );
  if (existing) {
    const loaded = await getReport(userId, interviewId);
    if (!loaded) throw notFound('report');
    return {
      evaluationId: existing.id,
      report: loaded.report,
      learningPlan: loaded.learningPlan,
    };
  }

  if (interview.status === 'created') {
    throw conflict('This interview has not started yet.');
  }

  const turns = await loadTurns(interviewId);
  if (turns.length === 0) {
    throw conflict('This interview has no answered questions to evaluate.');
  }

  const { candidate, job } = await loadAnalyses(userId, interview);

  const { data: report } = await generate({
    task: 'final_evaluation',
    system: SYSTEM_PROMPTS.finalEvaluation,
    prompt: finalEvaluationPrompt({
      roleTitle: interview.role_title,
      interviewType: interview.interview_type,
      difficulty: interview.difficulty,
      candidate,
      job,
      turns: turns.map((turn) => ({
        position: turn.question.position,
        question: turn.question.question,
        skillLabel: turn.question.skill_label,
        expectedCompetency: turn.question.expected_competency ?? '',
        answer: turn.answer?.answer_text ?? null,
        answerScore: turn.answer?.answer_score ?? null,
        strengths: turn.strengths,
        gaps: turn.gaps,
      })),
    }),
    schema: FinalReportSchema,
    schemaName: 'FinalReport',
    context: {
      roleTitle: interview.role_title,
      interviewType: interview.interview_type,
      difficulty: interview.difficulty,
      candidate,
      job,
      answers: turns.map((turn) => ({
        position: turn.question.position,
        question: turn.question.question,
        category: turn.question.category,
        skillLabel: turn.question.skill_label,
        difficulty: turn.question.difficulty,
        answerText: turn.answer?.answer_text ?? null,
        answerScore: turn.answer?.answer_score ?? null,
        expectedCompetency: turn.question.expected_competency ?? '',
        dimensions: turn.answer
          ? {
              relevance: turn.answer.relevance ?? 0,
              correctness: turn.answer.correctness ?? 0,
              completeness: turn.answer.completeness ?? 0,
              clarity: turn.answer.clarity ?? 0,
              confidence: turn.answer.confidence ?? 0,
              technicalDepth: turn.answer.technical_depth ?? 0,
              communication: turn.answer.communication ?? 0,
              reasoning: turn.answer.reasoning ?? 0,
              evidenceQuality: turn.answer.evidence_quality ?? 0,
            }
          : null,
        strengths: turn.strengths,
        gaps: turn.gaps,
        insufficientEvidence: turn.answer === null || turn.insufficientEvidence,
      })),
    },
    userId,
    interviewId,
    maxOutputTokens: 12000,
  });

  const { data: learningPlan } = await generate({
    task: 'learning_plan',
    system: SYSTEM_PROMPTS.learningPlan,
    prompt: learningPlanPrompt({
      roleTitle: interview.role_title,
      overallScore: report.overallScore,
      gaps: report.skillGaps.map((gap) => ({
        skillLabel: gap.skillLabel,
        score: report.skillScores.find((skill) => skill.skillLabel === gap.skillLabel)?.score ?? 0,
        severity: gap.severity,
      })),
      strengths: report.strengths.map((strength) => strength.title),
    }),
    schema: LearningPlanSchema,
    schemaName: 'LearningPlan',
    context: {
      roleTitle: interview.role_title,
      overallScore: report.overallScore,
      gaps: report.skillGaps.map((gap) => ({
        skillLabel: gap.skillLabel,
        score: report.skillScores.find((skill) => skill.skillLabel === gap.skillLabel)?.score ?? 0,
        severity: gap.severity,
      })),
      strengths: report.strengths.map((strength) => strength.title),
    },
    userId,
    interviewId,
    maxOutputTokens: 6000,
  });

  const evaluationId = await persistEvaluation({
    userId,
    interview,
    report,
    learningPlan,
  });

  return { evaluationId, report, learningPlan };
}

interface PersistEvaluationInput {
  userId: string;
  interview: InterviewRecord;
  report: FinalReport;
  learningPlan: LearningPlan;
}

async function persistEvaluation(input: PersistEvaluationInput): Promise<string> {
  const provider = getProvider();

  return transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO evaluations
         (interview_id, user_id, overall_score, technical_knowledge, problem_solving,
          communication, practical_experience, critical_thinking, role_fit, verdict,
          evidence_confidence, summary, strengths, weaknesses, skill_gaps, question_analysis,
          engine_provider, engine_model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        input.interview.id,
        input.userId,
        input.report.overallScore,
        input.report.dimensions.technicalKnowledge,
        input.report.dimensions.problemSolving,
        input.report.dimensions.communication,
        input.report.dimensions.practicalExperience,
        input.report.dimensions.criticalThinking,
        input.report.dimensions.roleFit,
        input.report.verdict,
        input.report.evidenceConfidence,
        input.report.summary,
        JSON.stringify(input.report.strengths),
        JSON.stringify(input.report.weaknesses),
        JSON.stringify(input.report.skillGaps),
        JSON.stringify(input.report.questionAnalysis),
        provider.name,
        provider.modelFor('reasoning'),
      ],
    );

    const evaluationId = rows[0]?.id;
    if (!evaluationId) throw new Error('Evaluation insert returned no row.');

    const seenSkills = new Set<string>();
    for (const skill of input.report.skillScores) {
      const resolved = resolveSkill(skill.skillLabel, skill.category);
      if (seenSkills.has(resolved.key)) continue;
      seenSkills.add(resolved.key);

      await tx.query(
        `INSERT INTO skill_scores
           (evaluation_id, interview_id, user_id, skill_key, skill_label, category,
            score, level, evidence_count, evidence, feedback, is_gap)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          evaluationId, input.interview.id, input.userId, resolved.key, resolved.label,
          resolved.category, skill.score, skill.level, skill.evidenceCount,
          skill.evidence, skill.feedback, skill.isGap,
        ],
      );
    }

    for (const [index, recommendation] of input.learningPlan.recommendations.entries()) {
      await tx.query(
        `INSERT INTO recommendations
           (evaluation_id, user_id, kind, title, detail, skill_key, priority, effort_hours, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          evaluationId, input.userId, recommendation.kind, recommendation.title,
          recommendation.detail,
          recommendation.skillLabel ? resolveSkill(recommendation.skillLabel).key : null,
          recommendation.priority, recommendation.effortHours, index,
        ],
      );
    }

    const { rows: planRows } = await tx.query<{ id: string }>(
      `INSERT INTO learning_plans (evaluation_id, user_id, title, objective, total_weeks)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [
        evaluationId, input.userId, input.learningPlan.title,
        input.learningPlan.objective, input.learningPlan.totalWeeks,
      ],
    );
    const planId = planRows[0]?.id;
    if (!planId) throw new Error('Learning plan insert returned no row.');

    const seenWeeks = new Set<number>();
    for (const week of input.learningPlan.weeks) {
      // The unique index on (plan, week) would reject a duplicated week number.
      if (seenWeeks.has(week.weekNumber)) continue;
      seenWeeks.add(week.weekNumber);

      await tx.query(
        `INSERT INTO learning_plan_items
           (learning_plan_id, user_id, week_number, focus, skill_key, activities, success_criteria)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          planId, input.userId, week.weekNumber, week.focus,
          week.skillLabel ? resolveSkill(week.skillLabel).key : null,
          JSON.stringify(week.activities), week.successCriteria,
        ],
      );
    }

    // Duration excludes paused time, so a coffee break is not scored as hesitation.
    await tx.query(
      `UPDATE interviews
          SET status = 'completed',
              completed_at = now(),
              duration_seconds = GREATEST(
                0,
                EXTRACT(EPOCH FROM (now() - COALESCE(started_at, created_at)))::integer - paused_seconds
              )
        WHERE id = $1`,
      [input.interview.id],
    );

    return evaluationId;
  });
}

interface Turn {
  question: QuestionRecord;
  answer: AnswerRecord | null;
  strengths: string[];
  gaps: string[];
  insufficientEvidence: boolean;
}

async function loadTurns(interviewId: string): Promise<Turn[]> {
  const questions = await query<QuestionRecord>(
    'SELECT * FROM interview_questions WHERE interview_id = $1 ORDER BY position ASC',
    [interviewId],
  );
  const answers = await query<AnswerRecord>(
    'SELECT * FROM interview_answers WHERE interview_id = $1',
    [interviewId],
  );
  const byQuestion = new Map(answers.map((answer) => [answer.question_id, answer]));

  return questions.map((question) => {
    const answer = byQuestion.get(question.id) ?? null;
    const analysis = (answer?.analysis ?? null) as {
      strengths?: string[];
      gaps?: string[];
      insufficientEvidence?: boolean;
    } | null;

    return {
      question,
      answer,
      strengths: analysis?.strengths ?? [],
      gaps: analysis?.gaps ?? [],
      insufficientEvidence: analysis?.insufficientEvidence ?? answer === null,
    };
  });
}

async function loadAnalyses(
  userId: string,
  interview: InterviewRecord,
): Promise<{ candidate: CandidateAnalysis | null; job: JobAnalysis | null }> {
  const [resume, job] = await Promise.all([
    interview.resume_id
      ? queryOne<{ analysis: CandidateAnalysis | null }>(
          'SELECT analysis FROM resumes WHERE id = $1 AND user_id = $2',
          [interview.resume_id, userId],
        )
      : Promise.resolve(null),
    interview.job_id
      ? queryOne<{ analysis: JobAnalysis | null }>(
          'SELECT analysis FROM jobs WHERE id = $1 AND user_id = $2',
          [interview.job_id, userId],
        )
      : Promise.resolve(null),
  ]);
  return { candidate: resume?.analysis ?? null, job: job?.analysis ?? null };
}

// ── Report reading ─────────────────────────────────────────────────────────

export interface StoredReport {
  evaluationId: string;
  interview: InterviewRecord;
  report: FinalReport;
  learningPlan: LearningPlan;
  transcript: Array<{
    position: number;
    question: string;
    category: string;
    skillLabel: string | null;
    difficulty: string;
    answer: string | null;
    score: number | null;
  }>;
  costUsd: number;
}

/** Load a saved report. Scoped by user id — a report id alone grants nothing. */
export async function getReport(
  userId: string,
  interviewId: string,
): Promise<StoredReport | null> {
  const interview = await queryOne<InterviewRecord>(
    'SELECT * FROM interviews WHERE id = $1 AND user_id = $2',
    [interviewId, userId],
  );
  if (!interview) return null;

  const evaluation = await queryOne<{
    id: string;
    overall_score: number;
    technical_knowledge: number;
    problem_solving: number;
    communication: number;
    practical_experience: number;
    critical_thinking: number;
    role_fit: number;
    verdict: FinalReport['verdict'];
    evidence_confidence: FinalReport['evidenceConfidence'];
    summary: string;
    strengths: FinalReport['strengths'];
    weaknesses: FinalReport['weaknesses'];
    skill_gaps: FinalReport['skillGaps'];
    question_analysis: FinalReport['questionAnalysis'];
  }>('SELECT * FROM evaluations WHERE interview_id = $1 AND user_id = $2', [interviewId, userId]);
  if (!evaluation) return null;

  const [skillScores, planRow, transcript, costRow] = await Promise.all([
    query<{
      skill_label: string;
      category: string;
      score: number;
      level: string;
      evidence_count: number;
      evidence: string | null;
      feedback: string | null;
      is_gap: boolean;
    }>(
      'SELECT * FROM skill_scores WHERE evaluation_id = $1 ORDER BY score ASC',
      [evaluation.id],
    ),
    queryOne<{ id: string; title: string; objective: string | null; total_weeks: number }>(
      'SELECT * FROM learning_plans WHERE evaluation_id = $1',
      [evaluation.id],
    ),
    query<{
      position: number;
      question: string;
      category: string;
      skill_label: string | null;
      difficulty: string;
      answer_text: string | null;
      answer_score: number | null;
    }>(
      `SELECT q.position, q.question, q.category, q.skill_label, q.difficulty,
              a.answer_text, a.answer_score
         FROM interview_questions q
         LEFT JOIN interview_answers a ON a.question_id = q.id
        WHERE q.interview_id = $1
        ORDER BY q.position ASC`,
      [interviewId],
    ),
    queryOne<{ total: string | null }>(
      'SELECT sum(cost_usd)::text AS total FROM ai_usage_events WHERE interview_id = $1',
      [interviewId],
    ),
  ]);

  const weeks = planRow
    ? await query<{
        week_number: number;
        focus: string;
        skill_key: string | null;
        activities: string[];
        success_criteria: string | null;
      }>(
        'SELECT * FROM learning_plan_items WHERE learning_plan_id = $1 ORDER BY week_number ASC',
        [planRow.id],
      )
    : [];

  const recommendations = await query<{
    kind: LearningPlan['recommendations'][number]['kind'];
    title: string;
    detail: string | null;
    skill_key: string | null;
    priority: number;
    effort_hours: number | null;
  }>(
    'SELECT * FROM recommendations WHERE evaluation_id = $1 ORDER BY priority ASC, sort_order ASC',
    [evaluation.id],
  );

  return {
    evaluationId: evaluation.id,
    interview,
    report: {
      overallScore: evaluation.overall_score,
      dimensions: {
        technicalKnowledge: evaluation.technical_knowledge,
        problemSolving: evaluation.problem_solving,
        communication: evaluation.communication,
        practicalExperience: evaluation.practical_experience,
        criticalThinking: evaluation.critical_thinking,
        roleFit: evaluation.role_fit,
      },
      verdict: evaluation.verdict,
      evidenceConfidence: evaluation.evidence_confidence,
      summary: evaluation.summary,
      strengths: evaluation.strengths,
      weaknesses: evaluation.weaknesses,
      skillScores: skillScores.map((skill) => ({
        skillLabel: skill.skill_label,
        category: skill.category as never,
        score: skill.score,
        level: skill.level as never,
        evidenceCount: skill.evidence_count,
        evidence: skill.evidence ?? '',
        feedback: skill.feedback ?? '',
        isGap: skill.is_gap,
      })),
      skillGaps: evaluation.skill_gaps,
      questionAnalysis: evaluation.question_analysis,
    },
    learningPlan: {
      title: planRow?.title ?? 'Improvement plan',
      objective: planRow?.objective ?? '',
      totalWeeks: planRow?.total_weeks ?? weeks.length,
      weeks: weeks.map((week) => ({
        weekNumber: week.week_number,
        focus: week.focus,
        skillLabel: week.skill_key,
        activities: week.activities,
        successCriteria: week.success_criteria ?? '',
      })),
      recommendations: recommendations.map((recommendation) => ({
        kind: recommendation.kind,
        title: recommendation.title,
        detail: recommendation.detail,
        skillLabel: recommendation.skill_key,
        priority: recommendation.priority,
        effortHours: recommendation.effort_hours,
      })),
    },
    transcript: transcript.map((turn) => ({
      position: turn.position,
      question: turn.question,
      category: turn.category,
      skillLabel: turn.skill_label,
      difficulty: turn.difficulty,
      answer: turn.answer_text,
      score: turn.answer_score,
    })),
    costUsd: costRow?.total ? Number.parseFloat(costRow.total) : 0,
  };
}
