import type {
  Difficulty,
  InterviewStatus,
  InterviewType,
  QuestionCategory,
} from '@/lib/schemas/domain';
import type { InterviewPlan } from '@/lib/schemas/ai';

/** Row shapes, mirroring the database exactly. */

export interface InterviewRecord {
  id: string;
  user_id: string;
  job_id: string | null;
  resume_id: string | null;
  role_title: string;
  interview_type: InterviewType;
  difficulty: Difficulty;
  current_difficulty: Difficulty;
  mode: 'text' | 'voice';
  status: InterviewStatus;
  planned_questions: number;
  asked_count: number;
  answered_count: number;
  plan: InterviewPlan | null;
  state: unknown;
  engine_provider: string;
  engine_model: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  duration_seconds: number | null;
  paused_at: Date | null;
  paused_seconds: number;
  failure_reason: string | null;
  created_at: Date;
}

export interface QuestionRecord {
  id: string;
  interview_id: string;
  user_id: string;
  position: number;
  question: string;
  category: QuestionCategory;
  skill_key: string | null;
  skill_label: string | null;
  difficulty: Difficulty;
  expected_competency: string | null;
  evaluation_criteria: string[];
  followup_options: string[];
  parent_question_id: string | null;
  followup_depth: number;
  selection_rationale: string | null;
  asked_at: Date;
}

export interface AnswerRecord {
  id: string;
  question_id: string;
  interview_id: string;
  user_id: string;
  answer_text: string;
  transcript_source: 'text' | 'speech';
  word_count: number;
  response_seconds: number | null;
  skipped: boolean;
  relevance: number | null;
  correctness: number | null;
  completeness: number | null;
  clarity: number | null;
  confidence: number | null;
  technical_depth: number | null;
  communication: number | null;
  reasoning: number | null;
  evidence_quality: number | null;
  cv_consistency: string | null;
  answer_score: number | null;
  analysis: unknown;
  created_at: Date;
}
