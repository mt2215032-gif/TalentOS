import { z } from 'zod';
import {
  DifficultySchema,
  QuestionCategorySchema,
  type Difficulty,
  type QuestionCategory,
} from '@/lib/schemas/domain';

/**
 * The interview's working memory.
 *
 * This lives in interviews.state as JSON and is never sent to the client — it
 * contains running scores and the interviewer's intentions, which would give
 * away the evaluation mid-interview.
 *
 * It is validated on read: a state document written by an older build must
 * either parse or be rebuilt, never be trusted blindly.
 */

export const SkillCoverageSchema = z.object({
  skillLabel: z.string(),
  /** Questions the plan allocated to this skill. */
  budget: z.number().int().min(0),
  /** Questions actually spent on it. */
  used: z.number().int().min(0),
  /** Scores from answers on this skill, in order. */
  scores: z.array(z.number().int().min(0).max(100)),
});
export type SkillCoverage = z.infer<typeof SkillCoverageSchema>;

export const PendingFollowUpSchema = z.object({
  kind: z.enum(['clarify', 'example', 'deepen', 'test_concept']),
  parentQuestionId: z.string(),
  parentQuestion: z.string(),
  parentAnswer: z.string(),
  parentSkillLabel: z.string().nullable(),
  reason: z.string(),
});
export type PendingFollowUp = z.infer<typeof PendingFollowUpSchema>;

export const InterviewStateSchema = z.object({
  version: z.literal(1),
  /** Per-skill budget and outcomes. */
  coverage: z.array(SkillCoverageSchema),
  /** Question categories already used, to keep the interview varied. */
  coveredCategories: z.array(QuestionCategorySchema),
  /** Rolling record of the difficulty each question was asked at. */
  difficultyHistory: z.array(DifficultySchema),
  /** Set when the last answer warranted a follow-up rather than a new topic. */
  pendingFollowUp: PendingFollowUpSchema.nullable(),
  /** Consecutive follow-ups on the same thread; capped so it cannot spiral. */
  followUpDepth: z.number().int().min(0),
  /** Scores of every graded answer, oldest first. */
  answerScores: z.array(z.number().int().min(0).max(100)),
  /** Questions asked verbatim, to guarantee no repeats. */
  askedQuestions: z.array(z.string()),
  /** Set when cost or provider failure forced the interview to wind down early. */
  degradedReason: z.string().nullable(),
});
export type InterviewState = z.infer<typeof InterviewStateSchema>;

export function createInitialState(
  coverage: Array<{ skillLabel: string; budget: number }>,
): InterviewState {
  return {
    version: 1,
    coverage: coverage.map((entry) => ({
      skillLabel: entry.skillLabel,
      budget: entry.budget,
      used: 0,
      scores: [],
    })),
    coveredCategories: [],
    difficultyHistory: [],
    pendingFollowUp: null,
    followUpDepth: 0,
    answerScores: [],
    askedQuestions: [],
    degradedReason: null,
  };
}

/**
 * Read a state document from the database.
 *
 * Anything that does not parse is replaced with a fresh state rather than
 * crashing the interview — losing adaptive context is recoverable, a 500 in the
 * middle of an interview is not.
 */
export function parseState(
  raw: unknown,
  fallbackCoverage: Array<{ skillLabel: string; budget: number }> = [],
): InterviewState {
  const result = InterviewStateSchema.safeParse(raw);
  return result.success ? result.data : createInitialState(fallbackCoverage);
}

/** Skills with budget left, most under-served first. */
export function remainingSkills(
  state: InterviewState,
): Array<{ label: string; remaining: number }> {
  return state.coverage
    .map((entry) => ({ label: entry.skillLabel, remaining: entry.budget - entry.used }))
    .filter((entry) => entry.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);
}

/** Record that a question was asked, updating coverage and history. */
export function recordQuestion(
  state: InterviewState,
  input: {
    question: string;
    category: QuestionCategory;
    difficulty: Difficulty;
    skillLabel: string | null;
    wasFollowUp: boolean;
  },
): InterviewState {
  const coverage = state.coverage.map((entry) =>
    // A follow-up digs into a skill already paid for, so it does not consume
    // another unit of that skill's budget.
    entry.skillLabel === input.skillLabel && !input.wasFollowUp
      ? { ...entry, used: entry.used + 1 }
      : entry,
  );

  return {
    ...state,
    coverage,
    coveredCategories: state.coveredCategories.includes(input.category)
      ? state.coveredCategories
      : [...state.coveredCategories, input.category],
    difficultyHistory: [...state.difficultyHistory, input.difficulty],
    askedQuestions: [...state.askedQuestions, input.question],
    followUpDepth: input.wasFollowUp ? state.followUpDepth + 1 : 0,
    pendingFollowUp: null,
  };
}

/** Record a graded answer against the interview and its skill. */
export function recordAnswer(
  state: InterviewState,
  input: { skillLabel: string | null; score: number },
): InterviewState {
  return {
    ...state,
    answerScores: [...state.answerScores, input.score],
    coverage: state.coverage.map((entry) =>
      entry.skillLabel === input.skillLabel
        ? { ...entry, scores: [...entry.scores, input.score] }
        : entry,
    ),
  };
}

/** Mean of the last `count` answers, or null when there are none. */
export function recentAverage(state: InterviewState, count: number): number | null {
  const recent = state.answerScores.slice(-count);
  if (recent.length === 0) return null;
  return Math.round(recent.reduce((sum, value) => sum + value, 0) / recent.length);
}
