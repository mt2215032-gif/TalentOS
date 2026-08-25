import { z } from 'zod';

/**
 * Shared vocabulary of the product.
 *
 * These enums are the single source of truth for values that appear in the
 * database CHECK constraints, the AI schemas and the UI. Changing one means
 * changing the matching constraint in db/migrations.
 */

export const InterviewTypeSchema = z.enum([
  'behavioral',
  'technical',
  'hr',
  'case_study',
  'system_design',
  'mixed',
]);
export type InterviewType = z.infer<typeof InterviewTypeSchema>;

export const DifficultySchema = z.enum(['easy', 'medium', 'hard', 'expert']);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const SkillCategorySchema = z.enum([
  'technical',
  'tool',
  'domain',
  'soft',
  'language',
  'certification',
]);
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

export const QuestionCategorySchema = z.enum([
  'knowledge',
  'conceptual',
  'practical',
  'scenario',
  'behavioral',
  'problem_solving',
  'experience',
  'technical_deep_dive',
  'closing',
]);
export type QuestionCategory = z.infer<typeof QuestionCategorySchema>;

export const SenioritySchema = z.enum(['intern', 'junior', 'mid', 'senior', 'lead', 'principal']);
export type Seniority = z.infer<typeof SenioritySchema>;

export const SkillLevelSchema = z.enum(['none', 'beginner', 'intermediate', 'advanced', 'expert']);
export type SkillLevel = z.infer<typeof SkillLevelSchema>;

export const ClaimedLevelSchema = z.enum(['beginner', 'intermediate', 'advanced', 'expert']);
export type ClaimedLevel = z.infer<typeof ClaimedLevelSchema>;

export const RequirementSchema = z.enum(['required', 'preferred', 'nice_to_have']);
export type Requirement = z.infer<typeof RequirementSchema>;

export const ImportanceSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type Importance = z.infer<typeof ImportanceSchema>;

export const VerdictSchema = z.enum([
  'strong_hire',
  'hire',
  'borderline',
  'not_yet',
  'insufficient_evidence',
]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const ConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const CvConsistencySchema = z.enum([
  'supports',
  'neutral',
  'contradicts',
  'not_applicable',
]);
export type CvConsistency = z.infer<typeof CvConsistencySchema>;

export const RecommendationKindSchema = z.enum([
  'topic',
  'project',
  'practice_question',
  'resource',
  'habit',
]);
export type RecommendationKind = z.infer<typeof RecommendationKindSchema>;

export const InterviewStatusSchema = z.enum([
  'created',
  'in_progress',
  'paused',
  'completed',
  'evaluating',
  'abandoned',
  'failed',
]);
export type InterviewStatus = z.infer<typeof InterviewStatusSchema>;

/** A 0–100 score. Every rubric dimension in the product uses this scale. */
export const ScoreSchema = z.number().int().min(0).max(100);

/**
 * Canonical form of a skill name, used to join CV skills against job skills.
 *
 * Normalisation is deliberately conservative: it lowercases, collapses
 * whitespace and strips punctuation that varies between writers ("Node.js" and
 * "nodejs" must meet), but does not attempt synonym resolution — that would
 * silently merge genuinely different skills.
 */
export function toSkillKey(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize('NFKD')
      // Strip combining accents so "Café" and "Cafe" agree.
      .replace(/[\u0300-\u036f]/g, '')
      // Symbols that carry meaning in a skill name must survive as letters,
      // otherwise "C++" and "C#" both collapse onto "c".
      .replace(/\+\+/g, 'pp')
      .replace(/#/g, 'sharp')
      // Dots are pure formatting: "Node.js" and "nodejs" are the same skill.
      .replace(/\./g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/ /g, '-')
  );
}

/** Ordered difficulty ladder used by the difficulty controller. */
export const DIFFICULTY_LADDER: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

export function difficultyIndex(value: Difficulty): number {
  return DIFFICULTY_LADDER.indexOf(value);
}

export function stepDifficulty(current: Difficulty, delta: number): Difficulty {
  const next = Math.min(
    DIFFICULTY_LADDER.length - 1,
    Math.max(0, difficultyIndex(current) + delta),
  );
  return DIFFICULTY_LADDER[next] as Difficulty;
}

/** Maps a 0–100 score onto the qualitative level shown in reports. */
export function scoreToLevel(score: number): SkillLevel {
  if (score >= 85) return 'expert';
  if (score >= 70) return 'advanced';
  if (score >= 50) return 'intermediate';
  if (score >= 30) return 'beginner';
  return 'none';
}

/** Human-facing labels. Kept beside the enums so they cannot drift apart. */
export const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  behavioral: 'Behavioral',
  technical: 'Technical',
  hr: 'HR Screening',
  case_study: 'Case Study',
  system_design: 'System Design',
  mixed: 'Mixed Panel',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
};

export const QUESTION_CATEGORY_LABELS: Record<QuestionCategory, string> = {
  knowledge: 'Knowledge',
  conceptual: 'Conceptual',
  practical: 'Practical',
  scenario: 'Scenario',
  behavioral: 'Behavioral',
  problem_solving: 'Problem Solving',
  experience: 'Experience',
  technical_deep_dive: 'Technical Deep Dive',
  closing: 'Closing',
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  strong_hire: 'Strong Hire',
  hire: 'Hire',
  borderline: 'Borderline',
  not_yet: 'Not Yet',
  insufficient_evidence: 'Insufficient Evidence',
};
