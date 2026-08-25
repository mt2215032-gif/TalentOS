-- ═══════════════════════════════════════════════════════════════════════════
-- 0003_interviews — sessions, questions, answers, evaluation and coaching
-- ═══════════════════════════════════════════════════════════════════════════

-- ── interviews ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Jobs and resumes are optional: a user can run a generic practice interview.
  job_id            uuid        REFERENCES jobs(id) ON DELETE SET NULL,
  resume_id         uuid        REFERENCES resumes(id) ON DELETE SET NULL,

  role_title        text        NOT NULL,
  interview_type    text        NOT NULL CHECK (interview_type IN
                      ('behavioral', 'technical', 'hr', 'case_study', 'system_design', 'mixed')),
  difficulty        text        NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'expert')),
  -- Difficulty actually reached — the controller moves this as the candidate
  -- performs, so reports can show "started medium, finished hard".
  current_difficulty text       NOT NULL DEFAULT 'medium'
                                CHECK (current_difficulty IN ('easy', 'medium', 'hard', 'expert')),
  mode              text        NOT NULL DEFAULT 'text' CHECK (mode IN ('text', 'voice')),

  status            text        NOT NULL DEFAULT 'created' CHECK (status IN
                      ('created', 'in_progress', 'paused', 'completed', 'evaluating', 'abandoned', 'failed')),

  planned_questions integer     NOT NULL DEFAULT 10 CHECK (planned_questions BETWEEN 3 AND 40),
  asked_count       integer     NOT NULL DEFAULT 0 CHECK (asked_count >= 0),
  answered_count    integer     NOT NULL DEFAULT 0 CHECK (answered_count >= 0),

  -- InterviewPlan document (skill budget, focus areas, opening strategy).
  plan              jsonb,
  -- InterviewState document owned by the engine: covered skills, running
  -- signals, difficulty history, follow-up depth. Never sent to the client.
  state             jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Which engine produced this interview, recorded for report provenance.
  engine_provider   text        NOT NULL DEFAULT 'heuristic',
  engine_model      text,

  started_at        timestamptz,
  completed_at      timestamptz,
  -- Wall-clock seconds the candidate spent, excluding paused time.
  duration_seconds  integer     CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  paused_at         timestamptz,
  paused_seconds    integer     NOT NULL DEFAULT 0 CHECK (paused_seconds >= 0),

  failure_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT interviews_answered_lte_asked CHECK (answered_count <= asked_count)
);

CREATE INDEX IF NOT EXISTS interviews_user_created_idx ON interviews (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS interviews_user_status_idx ON interviews (user_id, status);
CREATE INDEX IF NOT EXISTS interviews_job_idx ON interviews (job_id) WHERE job_id IS NOT NULL;
-- Analytics: completion funnel and type popularity across the whole product.
CREATE INDEX IF NOT EXISTS interviews_status_type_idx ON interviews (status, interview_type, created_at DESC);

DROP TRIGGER IF EXISTS interviews_set_updated_at ON interviews;
CREATE TRIGGER interviews_set_updated_at BEFORE UPDATE ON interviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── interview_questions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interview_questions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id        uuid        NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 1-based position in the interview.
  position            integer     NOT NULL CHECK (position > 0),
  question            text        NOT NULL,
  category            text        NOT NULL CHECK (category IN
                        ('knowledge', 'conceptual', 'practical', 'scenario', 'behavioral',
                         'problem_solving', 'experience', 'technical_deep_dive', 'closing')),
  skill_key           text,
  skill_label         text,
  difficulty          text        NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'expert')),
  expected_competency text,
  -- Rubric the analyzer grades against. Hidden from the candidate.
  evaluation_criteria jsonb       NOT NULL DEFAULT '[]'::jsonb,
  followup_options    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Set when this question was generated as a follow-up to an earlier answer.
  parent_question_id  uuid        REFERENCES interview_questions(id) ON DELETE SET NULL,
  followup_depth      integer     NOT NULL DEFAULT 0 CHECK (followup_depth >= 0),
  -- Why the engine chose this question — surfaced in the report and used to
  -- debug the adaptive logic.
  selection_rationale text,
  asked_at            timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_id, position)
);

CREATE INDEX IF NOT EXISTS interview_questions_interview_idx
  ON interview_questions (interview_id, position);
CREATE INDEX IF NOT EXISTS interview_questions_skill_idx
  ON interview_questions (skill_key) WHERE skill_key IS NOT NULL;

-- ── interview_answers ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interview_answers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id       uuid        NOT NULL UNIQUE REFERENCES interview_questions(id) ON DELETE CASCADE,
  interview_id      uuid        NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer_text       text        NOT NULL,
  -- Populated when the answer arrived through the voice pipeline.
  transcript_source text        NOT NULL DEFAULT 'text'
                                CHECK (transcript_source IN ('text', 'speech')),
  word_count        integer     NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  -- Seconds between the question being served and the answer being submitted.
  response_seconds  integer     CHECK (response_seconds IS NULL OR response_seconds >= 0),
  skipped           boolean     NOT NULL DEFAULT false,

  -- ── Hidden per-answer analysis (never returned to the interview UI) ──────
  relevance         smallint CHECK (relevance         BETWEEN 0 AND 100),
  correctness       smallint CHECK (correctness       BETWEEN 0 AND 100),
  completeness      smallint CHECK (completeness      BETWEEN 0 AND 100),
  clarity           smallint CHECK (clarity           BETWEEN 0 AND 100),
  confidence        smallint CHECK (confidence        BETWEEN 0 AND 100),
  technical_depth   smallint CHECK (technical_depth   BETWEEN 0 AND 100),
  communication     smallint CHECK (communication     BETWEEN 0 AND 100),
  reasoning         smallint CHECK (reasoning         BETWEEN 0 AND 100),
  evidence_quality  smallint CHECK (evidence_quality  BETWEEN 0 AND 100),
  -- Does the demonstrated ability match what the CV claims?
  cv_consistency    text CHECK (cv_consistency IS NULL OR cv_consistency IN
                      ('supports', 'neutral', 'contradicts', 'not_applicable')),
  answer_score      smallint CHECK (answer_score BETWEEN 0 AND 100),
  -- Full AnswerEvaluation document (strengths, gaps, quoted evidence).
  analysis          jsonb,
  analyzed_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interview_answers_interview_idx ON interview_answers (interview_id);
CREATE INDEX IF NOT EXISTS interview_answers_user_idx ON interview_answers (user_id, created_at DESC);

-- ── evaluations — one final report per interview ───────────────────────────
CREATE TABLE IF NOT EXISTS evaluations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id           uuid        NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
  user_id                uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  overall_score          smallint    NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  technical_knowledge    smallint    NOT NULL CHECK (technical_knowledge BETWEEN 0 AND 100),
  problem_solving        smallint    NOT NULL CHECK (problem_solving BETWEEN 0 AND 100),
  communication          smallint    NOT NULL CHECK (communication BETWEEN 0 AND 100),
  practical_experience   smallint    NOT NULL CHECK (practical_experience BETWEEN 0 AND 100),
  critical_thinking      smallint    NOT NULL CHECK (critical_thinking BETWEEN 0 AND 100),
  role_fit               smallint    NOT NULL CHECK (role_fit BETWEEN 0 AND 100),

  verdict                text        NOT NULL CHECK (verdict IN
                           ('strong_hire', 'hire', 'borderline', 'not_yet', 'insufficient_evidence')),
  -- How much the interview actually demonstrated. Guards against confident
  -- scoring off two-word answers.
  evidence_confidence    text        NOT NULL DEFAULT 'medium'
                           CHECK (evidence_confidence IN ('low', 'medium', 'high')),
  summary                text        NOT NULL,
  strengths              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  weaknesses             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  skill_gaps             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Per-question breakdown: what was good, what was missing, ideal answer.
  question_analysis      jsonb       NOT NULL DEFAULT '[]'::jsonb,

  engine_provider        text        NOT NULL DEFAULT 'heuristic',
  engine_model           text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evaluations_user_created_idx ON evaluations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS evaluations_score_idx ON evaluations (user_id, overall_score);

-- ── skill_scores — per-skill outcome, the backbone of progress tracking ────
CREATE TABLE IF NOT EXISTS skill_scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id  uuid        NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  interview_id   uuid        NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_key      text        NOT NULL,
  skill_label    text        NOT NULL,
  category       text        NOT NULL DEFAULT 'technical',
  score          smallint    NOT NULL CHECK (score BETWEEN 0 AND 100),
  level          text        NOT NULL CHECK (level IN
                   ('none', 'beginner', 'intermediate', 'advanced', 'expert')),
  -- How many answers actually informed this score.
  evidence_count integer     NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  evidence       text,
  feedback       text,
  is_gap         boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evaluation_id, skill_key)
);

CREATE INDEX IF NOT EXISTS skill_scores_user_skill_idx ON skill_scores (user_id, skill_key, created_at DESC);
CREATE INDEX IF NOT EXISTS skill_scores_gap_idx ON skill_scores (user_id) WHERE is_gap;

-- ── recommendations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid        NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          text        NOT NULL CHECK (kind IN
                  ('topic', 'project', 'practice_question', 'resource', 'habit')),
  title         text        NOT NULL,
  detail        text,
  skill_key     text,
  priority      smallint    NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  effort_hours  smallint    CHECK (effort_hours IS NULL OR effort_hours > 0),
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recommendations_evaluation_idx ON recommendations (evaluation_id, priority);
CREATE INDEX IF NOT EXISTS recommendations_user_idx ON recommendations (user_id, created_at DESC);

-- ── learning_plans ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid        NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         text        NOT NULL,
  objective     text,
  total_weeks   smallint    NOT NULL DEFAULT 4 CHECK (total_weeks BETWEEN 1 AND 26),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_plans_user_idx ON learning_plans (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS learning_plan_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_plan_id uuid        NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_number      smallint    NOT NULL CHECK (week_number BETWEEN 1 AND 26),
  focus            text        NOT NULL,
  skill_key        text,
  activities       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  success_criteria text,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learning_plan_id, week_number)
);

CREATE INDEX IF NOT EXISTS learning_plan_items_plan_idx ON learning_plan_items (learning_plan_id, week_number);
