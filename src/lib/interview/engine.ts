import { generate } from '@/lib/ai';
import { isOverBudget } from '@/lib/ai/usage';
import {
  AnswerEvaluationSchema,
  GeneratedQuestionSchema,
  InterviewPlanSchema,
  type AnswerEvaluation,
  type CandidateAnalysis,
  type GeneratedQuestion,
  type InterviewPlan,
  type JobAnalysis,
} from '@/lib/schemas/ai';
import {
  SYSTEM_PROMPTS,
  answerAnalysisPrompt,
  interviewPlanPrompt,
  questionGenerationPrompt,
} from '@/lib/ai/prompts';
import { getProvider } from '@/lib/ai';
import { query, queryOne, transaction } from '@/lib/db/client';
import { AppError, conflict, notFound } from '@/lib/security/errors';
import { resolveSkill } from '@/lib/ai/taxonomy';
import type { Difficulty, InterviewType } from '@/lib/schemas/domain';
import {
  createInitialState,
  parseState,
  recordAnswer,
  recordQuestion,
  remainingSkills,
  type InterviewState,
} from '@/lib/interview/state';
import { difficultyBounds, nextDifficulty } from '@/lib/interview/difficulty';
import type {
  InterviewRecord,
  QuestionRecord,
} from '@/lib/interview/types';

/**
 * The adaptive interview engine.
 *
 * Flow per turn:
 *   answer arrives → Answer Analyzer → State Manager → Follow-up Decision
 *   → Difficulty Controller → Question Generator → next question
 *
 * Two invariants hold throughout:
 *   1. Scores and interviewer intent stay server-side. The client receives the
 *      question and progress only, never the grading.
 *   2. Nothing the client sends decides anything. Position, difficulty and
 *      skill targeting are all derived from persisted state.
 */

/** Follow-ups on one thread before the interview must change subject. */
const MAX_FOLLOW_UP_DEPTH = 2;

export interface StartInterviewInput {
  userId: string;
  roleTitle: string;
  interviewType: InterviewType;
  difficulty: Difficulty;
  plannedQuestions: number;
  jobId?: string | null;
  resumeId?: string | null;
}

export interface InterviewTurn {
  interviewId: string;
  questionId: string;
  position: number;
  question: string;
  category: string;
  skillLabel: string | null;
  difficulty: Difficulty;
  plannedQuestions: number;
  /** Present only when the interview has finished. */
  isComplete: boolean;
}

/**
 * Create an interview, plan it, and produce the first question.
 *
 * Planning and the opening question happen together so the candidate never
 * lands in a room with nothing to answer.
 */
export async function startInterview(input: StartInterviewInput): Promise<InterviewTurn> {
  const { candidate, job } = await loadContext(input.userId, input.resumeId, input.jobId);

  const provider = getProvider();
  const interview = await queryOne<InterviewRecord>(
    `INSERT INTO interviews
       (user_id, job_id, resume_id, role_title, interview_type, difficulty,
        current_difficulty, planned_questions, status, engine_provider, engine_model, started_at, state)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 'in_progress', $8, $9, now(), '{}'::jsonb)
     RETURNING *`,
    [
      input.userId,
      input.jobId ?? null,
      input.resumeId ?? null,
      input.roleTitle.slice(0, 160),
      input.interviewType,
      input.difficulty,
      input.plannedQuestions,
      provider.name,
      provider.modelFor('standard'),
    ],
  );
  if (!interview) throw new Error('Interview insert returned no row.');

  const { data: plan } = await generate({
    task: 'interview_plan',
    system: SYSTEM_PROMPTS.interviewPlan,
    prompt: interviewPlanPrompt({
      roleTitle: input.roleTitle,
      interviewType: input.interviewType,
      difficulty: input.difficulty,
      plannedQuestions: input.plannedQuestions,
      candidate,
      job,
    }),
    schema: InterviewPlanSchema,
    schemaName: 'InterviewPlan',
    context: {
      roleTitle: input.roleTitle,
      interviewType: input.interviewType,
      difficulty: input.difficulty,
      plannedQuestions: input.plannedQuestions,
      candidate,
      job,
    },
    userId: input.userId,
    interviewId: interview.id,
    maxOutputTokens: 4000,
  });

  const state = createInitialState(
    plan.skillTargets.map((target) => ({
      skillLabel: target.skillLabel,
      budget: target.questionBudget,
    })),
  );

  await query('UPDATE interviews SET plan = $2, state = $3 WHERE id = $1', [
    interview.id,
    JSON.stringify(plan),
    JSON.stringify(state),
  ]);

  return askNextQuestion({
    interview: { ...interview, plan, state },
    state,
    candidate,
    job,
    plan,
  });
}

export interface SubmitAnswerInput {
  userId: string;
  interviewId: string;
  questionId: string;
  answerText: string;
  responseSeconds?: number | null;
  transcriptSource?: 'text' | 'speech';
}

export interface SubmitAnswerResult {
  /** The next question, or null when the interview has finished. */
  next: InterviewTurn | null;
  isComplete: boolean;
  answeredCount: number;
  plannedQuestions: number;
}

/**
 * Grade an answer and advance the interview.
 *
 * The returned value deliberately excludes the grade: revealing it mid-interview
 * would change how the candidate answers the rest.
 */
export async function submitAnswer(input: SubmitAnswerInput): Promise<SubmitAnswerResult> {
  const interview = await loadInterview(input.userId, input.interviewId);

  if (interview.status === 'completed' || interview.status === 'evaluating') {
    throw conflict('This interview has already finished.');
  }
  if (interview.status === 'paused') {
    throw conflict('This interview is paused. Resume it before answering.');
  }
  if (interview.status !== 'in_progress') {
    throw conflict('This interview is not accepting answers.');
  }

  const question = await queryOne<QuestionRecord>(
    'SELECT * FROM interview_questions WHERE id = $1 AND interview_id = $2 AND user_id = $3',
    [input.questionId, input.interviewId, input.userId],
  );
  if (!question) throw notFound('question');

  const alreadyAnswered = await queryOne<{ id: string }>(
    'SELECT id FROM interview_answers WHERE question_id = $1',
    [question.id],
  );
  if (alreadyAnswered) throw conflict('That question has already been answered.');

  const { candidate, job } = await loadContext(
    input.userId,
    interview.resume_id,
    interview.job_id,
  );

  const answerText = input.answerText.trim();
  const cvClaim = findCvClaim(candidate, question.skill_label);

  const { data: evaluation } = await generate({
    task: 'answer_analysis',
    system: SYSTEM_PROMPTS.answerAnalysis,
    prompt: answerAnalysisPrompt({
      question: question.question,
      category: question.category,
      difficulty: question.difficulty,
      skillLabel: question.skill_label,
      expectedCompetency: question.expected_competency ?? '',
      evaluationCriteria: question.evaluation_criteria,
      answerText,
      cvClaim,
    }),
    schema: AnswerEvaluationSchema,
    schemaName: 'AnswerEvaluation',
    context: {
      question: question.question,
      category: question.category,
      difficulty: question.difficulty,
      skillLabel: question.skill_label,
      expectedCompetency: question.expected_competency ?? '',
      evaluationCriteria: question.evaluation_criteria,
      answerText,
      cvClaimsSkill: cvClaim !== null,
    },
    userId: input.userId,
    interviewId: interview.id,
    maxOutputTokens: 3000,
  });

  await persistAnswer({
    question,
    interviewId: interview.id,
    userId: input.userId,
    answerText,
    evaluation,
    responseSeconds: input.responseSeconds ?? null,
    transcriptSource: input.transcriptSource ?? 'text',
  });

  // ── State: record the answer, then decide the next move ──────────────────
  let state = parseState(interview.state);
  state = recordAnswer(state, {
    skillLabel: question.skill_label,
    score: evaluation.answerScore,
  });

  const wantsFollowUp =
    evaluation.followUpRecommendation !== 'move_on' &&
    state.followUpDepth < MAX_FOLLOW_UP_DEPTH &&
    !evaluation.insufficientEvidence;

  state = {
    ...state,
    pendingFollowUp: wantsFollowUp
      ? {
          kind: evaluation.followUpRecommendation as 'clarify' | 'example' | 'deepen' | 'test_concept',
          parentQuestionId: question.id,
          parentQuestion: question.question,
          parentAnswer: answerText,
          parentSkillLabel: question.skill_label,
          reason: evaluation.followUpReason,
        }
      : null,
  };

  const bounds = difficultyBounds(interview.difficulty);
  const decision = nextDifficulty(interview.current_difficulty, state, bounds);

  const answeredCount = interview.answered_count + 1;

  // ── Should the interview continue? ───────────────────────────────────────
  const reachedPlanned = interview.asked_count >= interview.planned_questions;
  const overBudget = await isOverBudget(interview.id);

  if (overBudget && !reachedPlanned) {
    state = { ...state, degradedReason: 'Processing budget for this interview was reached.' };
  }

  const shouldFinish = reachedPlanned || overBudget;

  await query(
    `UPDATE interviews
        SET state = $2, current_difficulty = $3, answered_count = $4
      WHERE id = $1`,
    [interview.id, JSON.stringify(state), decision.next, answeredCount],
  );

  if (shouldFinish) {
    await query(`UPDATE interviews SET status = 'evaluating' WHERE id = $1`, [interview.id]);
    return {
      next: null,
      isComplete: true,
      answeredCount,
      plannedQuestions: interview.planned_questions,
    };
  }

  const turn = await askNextQuestion({
    interview: { ...interview, current_difficulty: decision.next, answered_count: answeredCount },
    state,
    candidate,
    job,
    plan: (interview.plan as InterviewPlan | null) ?? null,
  });

  return {
    next: turn,
    isComplete: false,
    answeredCount,
    plannedQuestions: interview.planned_questions,
  };
}

interface AskNextInput {
  interview: InterviewRecord;
  state: InterviewState;
  candidate: CandidateAnalysis | null;
  job: JobAnalysis | null;
  plan: InterviewPlan | null;
}

/** Generate, persist and return the next question. */
async function askNextQuestion(input: AskNextInput): Promise<InterviewTurn> {
  const { interview, state } = input;
  const position = interview.asked_count + 1;
  const followUp = state.pendingFollowUp;

  const transcript = await query<{ position: number; question: string; answer_text: string | null }>(
    `SELECT q.position, q.question, a.answer_text
       FROM interview_questions q
       LEFT JOIN interview_answers a ON a.question_id = q.id
      WHERE q.interview_id = $1
      ORDER BY q.position ASC`,
    [interview.id],
  );

  const targetSkills = remainingSkills(state);

  const { data: generated } = await generate({
    task: 'question_generation',
    system: SYSTEM_PROMPTS.questionGeneration,
    prompt: questionGenerationPrompt({
      roleTitle: interview.role_title,
      interviewType: interview.interview_type,
      difficulty: interview.current_difficulty,
      position,
      plannedQuestions: interview.planned_questions,
      candidate: input.candidate,
      job: input.job,
      planObjective: input.plan?.objective ?? null,
      targetSkills,
      transcript: transcript.map((turn) => ({
        position: turn.position,
        question: turn.question,
        answer: turn.answer_text,
      })),
      followUp: followUp
        ? {
            parentQuestion: followUp.parentQuestion,
            parentAnswer: followUp.parentAnswer,
            parentSkillLabel: followUp.parentSkillLabel,
            kind: followUp.kind,
          }
        : null,
      coveredCategories: state.coveredCategories,
    }),
    schema: GeneratedQuestionSchema,
    schemaName: 'InterviewQuestion',
    context: {
      roleTitle: interview.role_title,
      interviewType: interview.interview_type,
      difficulty: interview.current_difficulty,
      position,
      plannedQuestions: interview.planned_questions,
      candidate: input.candidate,
      job: input.job,
      targetSkills,
      asked: transcript.map((turn) => ({
        position: turn.position,
        question: turn.question,
        category: 'knowledge',
        skillLabel: null,
        difficulty: interview.current_difficulty,
        answerText: turn.answer_text,
        answerScore: null,
      })),
      followUp: followUp
        ? {
            parentQuestion: followUp.parentQuestion,
            parentAnswer: followUp.parentAnswer,
            parentSkillLabel: followUp.parentSkillLabel,
            kind: followUp.kind,
          }
        : null,
    },
    userId: interview.user_id,
    interviewId: interview.id,
    maxOutputTokens: 2500,
  });

  const question = ensureNotRepeated(generated, state, position);
  const skill = question.skillLabel ? resolveSkill(question.skillLabel) : null;

  const stored = await queryOne<QuestionRecord>(
    `INSERT INTO interview_questions
       (interview_id, user_id, position, question, category, skill_key, skill_label, difficulty,
        expected_competency, evaluation_criteria, followup_options, parent_question_id,
        followup_depth, selection_rationale)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      interview.id,
      interview.user_id,
      position,
      question.question,
      question.category,
      skill?.key ?? null,
      skill?.label ?? null,
      question.difficulty,
      question.expectedCompetency,
      JSON.stringify(question.evaluationCriteria),
      JSON.stringify(question.followUpOptions),
      followUp?.parentQuestionId ?? null,
      followUp ? state.followUpDepth + 1 : 0,
      question.selectionRationale,
    ],
  );
  if (!stored) throw new Error('Question insert returned no row.');

  const updatedState = recordQuestion(state, {
    question: question.question,
    category: question.category,
    difficulty: question.difficulty,
    skillLabel: skill?.label ?? null,
    wasFollowUp: followUp !== null,
  });

  await query(
    `UPDATE interviews SET state = $2, asked_count = $3 WHERE id = $1`,
    [interview.id, JSON.stringify(updatedState), position],
  );

  return {
    interviewId: interview.id,
    questionId: stored.id,
    position,
    question: question.question,
    category: question.category,
    skillLabel: skill?.label ?? null,
    difficulty: question.difficulty,
    plannedQuestions: interview.planned_questions,
    isComplete: false,
  };
}

/**
 * Guarantee the interview never asks the same question twice.
 *
 * The models are instructed not to repeat, but "instructed not to" is not a
 * guarantee, and a repeated question is the single most obvious way an AI
 * interviewer breaks the illusion of being present.
 */
function ensureNotRepeated(
  generated: GeneratedQuestion,
  state: InterviewState,
  position: number,
): GeneratedQuestion {
  const normalize = (text: string): string => text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const asked = new Set(state.askedQuestions.map(normalize));

  if (!asked.has(normalize(generated.question))) return generated;

  return {
    ...generated,
    question: `Let me come at this from another angle. ${generated.question}`,
    selectionRationale: `${generated.selectionRationale} (rephrased at position ${position} to avoid repeating an earlier question)`,
  };
}

interface PersistAnswerInput {
  question: QuestionRecord;
  interviewId: string;
  userId: string;
  answerText: string;
  evaluation: AnswerEvaluation;
  responseSeconds: number | null;
  transcriptSource: 'text' | 'speech';
}

async function persistAnswer(input: PersistAnswerInput): Promise<void> {
  const wordCount = input.answerText.split(/\s+/).filter(Boolean).length;

  await query(
    `INSERT INTO interview_answers
       (question_id, interview_id, user_id, answer_text, transcript_source, word_count,
        response_seconds, skipped, relevance, correctness, completeness, clarity, confidence,
        technical_depth, communication, reasoning, evidence_quality, cv_consistency,
        answer_score, analysis, analyzed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now())`,
    [
      input.question.id,
      input.interviewId,
      input.userId,
      input.answerText,
      input.transcriptSource,
      wordCount,
      input.responseSeconds,
      input.evaluation.insufficientEvidence && wordCount === 0,
      input.evaluation.relevance,
      input.evaluation.correctness,
      input.evaluation.completeness,
      input.evaluation.clarity,
      input.evaluation.confidence,
      input.evaluation.technicalDepth,
      input.evaluation.communication,
      input.evaluation.reasoning,
      input.evaluation.evidenceQuality,
      input.evaluation.cvConsistency,
      input.evaluation.answerScore,
      JSON.stringify(input.evaluation),
    ],
  );
}

/** The CV claim relevant to a skill, used for consistency checking. */
function findCvClaim(candidate: CandidateAnalysis | null, skillLabel: string | null): string | null {
  if (!candidate || !skillLabel) return null;
  const key = resolveSkill(skillLabel).key;

  const probe = candidate.probeTargets.find(
    (target) => resolveSkill(target.skillLabel).key === key,
  );
  if (probe) return probe.claim;

  const skill = candidate.skills.find((entry) => resolveSkill(entry.label).key === key);
  return skill?.evidence ?? (skill ? `Lists ${skill.label} as a skill.` : null);
}

export async function loadInterview(
  userId: string,
  interviewId: string,
): Promise<InterviewRecord> {
  const row = await queryOne<InterviewRecord>(
    'SELECT * FROM interviews WHERE id = $1 AND user_id = $2',
    [interviewId, userId],
  );
  if (!row) throw notFound('interview');
  return row;
}

/** Load the candidate and job analyses an interview is grounded in. */
async function loadContext(
  userId: string,
  resumeId: string | null | undefined,
  jobId: string | null | undefined,
): Promise<{ candidate: CandidateAnalysis | null; job: JobAnalysis | null }> {
  const [resumeRow, jobRow] = await Promise.all([
    resumeId
      ? queryOne<{ analysis: CandidateAnalysis | null }>(
          `SELECT analysis FROM resumes WHERE id = $1 AND user_id = $2 AND status = 'ready'`,
          [resumeId, userId],
        )
      : Promise.resolve(null),
    jobId
      ? queryOne<{ analysis: JobAnalysis | null }>(
          `SELECT analysis FROM jobs WHERE id = $1 AND user_id = $2 AND status = 'ready'`,
          [jobId, userId],
        )
      : Promise.resolve(null),
  ]);

  return {
    candidate: resumeRow?.analysis ?? null,
    job: jobRow?.analysis ?? null,
  };
}

// ── Session control ────────────────────────────────────────────────────────

export async function pauseInterview(userId: string, interviewId: string): Promise<void> {
  const updated = await query(
    `UPDATE interviews
        SET status = 'paused', paused_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'in_progress'
      RETURNING id`,
    [interviewId, userId],
  );
  if (updated.length === 0) {
    throw new AppError('conflict', 'Only an interview in progress can be paused.');
  }
}

export async function resumeInterview(userId: string, interviewId: string): Promise<void> {
  const updated = await transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; paused_at: Date | null }>(
      `SELECT id, paused_at FROM interviews
        WHERE id = $1 AND user_id = $2 AND status = 'paused'
        FOR UPDATE`,
      [interviewId, userId],
    );
    const row = rows[0];
    if (!row) return [];

    // Paused time is excluded from duration, so a break does not look like a
    // slow candidate in the analytics.
    const pausedSeconds = row.paused_at
      ? Math.round((Date.now() - row.paused_at.getTime()) / 1000)
      : 0;

    const { rows: updatedRows } = await tx.query<{ id: string }>(
      `UPDATE interviews
          SET status = 'in_progress',
              paused_at = NULL,
              paused_seconds = paused_seconds + $3
        WHERE id = $1 AND user_id = $2
        RETURNING id`,
      [interviewId, userId, pausedSeconds],
    );
    return updatedRows;
  });

  if (updated.length === 0) {
    throw new AppError('conflict', 'Only a paused interview can be resumed.');
  }
}

/** End an interview early. It still produces a report from what was gathered. */
export async function endInterview(userId: string, interviewId: string): Promise<void> {
  const updated = await query(
    `UPDATE interviews
        SET status = 'evaluating'
      WHERE id = $1 AND user_id = $2 AND status IN ('in_progress', 'paused')
      RETURNING id`,
    [interviewId, userId],
  );
  if (updated.length === 0) {
    throw new AppError('conflict', 'This interview cannot be ended from its current state.');
  }
}
