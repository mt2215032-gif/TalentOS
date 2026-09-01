import type {
  Difficulty,
  InterviewType,
  QuestionCategory,
} from '@/lib/schemas/domain';
import type { CandidateAnalysis, JobAnalysis } from '@/lib/schemas/ai';

/**
 * Structured inputs the offline heuristic engine works from.
 *
 * These mirror the facts the prompt templates render for an LLM. Keeping them
 * typed is what lets the offline engine perform genuine analysis instead of
 * scraping its own prompt.
 */

export interface HeuristicResumeContext {
  rawText: string;
}

export interface HeuristicJobContext {
  description: string;
  titleHint?: string;
}

export interface HeuristicPlanContext {
  roleTitle: string;
  interviewType: InterviewType;
  difficulty: Difficulty;
  plannedQuestions: number;
  candidate: CandidateAnalysis | null;
  job: JobAnalysis | null;
}

/** One already-asked question and how it was answered. */
export interface AskedSummary {
  position: number;
  question: string;
  category: QuestionCategory;
  skillLabel: string | null;
  difficulty: Difficulty;
  answerText: string | null;
  answerScore: number | null;
}

export interface HeuristicQuestionContext {
  roleTitle: string;
  interviewType: InterviewType;
  difficulty: Difficulty;
  position: number;
  plannedQuestions: number;
  candidate: CandidateAnalysis | null;
  job: JobAnalysis | null;
  /** Skills the plan wants covered, highest priority first. */
  targetSkills: Array<{ label: string; remaining: number }>;
  asked: AskedSummary[];
  /** Set when the engine decided to follow up rather than change topic. */
  followUp: {
    parentQuestion: string;
    parentAnswer: string;
    parentSkillLabel: string | null;
    kind: 'clarify' | 'example' | 'deepen' | 'test_concept';
  } | null;
}

export interface HeuristicAnswerContext {
  question: string;
  category: QuestionCategory;
  difficulty: Difficulty;
  skillLabel: string | null;
  expectedCompetency: string;
  evaluationCriteria: string[];
  answerText: string;
  /** Whether the CV claims experience in this skill, for consistency checks. */
  cvClaimsSkill: boolean;
}

export interface HeuristicEvaluationContext {
  roleTitle: string;
  interviewType: InterviewType;
  difficulty: Difficulty;
  candidate: CandidateAnalysis | null;
  job: JobAnalysis | null;
  answers: Array<
    AskedSummary & {
      dimensions: {
        relevance: number;
        correctness: number;
        completeness: number;
        clarity: number;
        confidence: number;
        technicalDepth: number;
        communication: number;
        reasoning: number;
        evidenceQuality: number;
      } | null;
      strengths: string[];
      gaps: string[];
      insufficientEvidence: boolean;
      expectedCompetency: string;
    }
  >;
}

export interface HeuristicLearningPlanContext {
  roleTitle: string;
  gaps: Array<{ skillLabel: string; score: number; severity: string }>;
  strengths: string[];
  overallScore: number;
}
