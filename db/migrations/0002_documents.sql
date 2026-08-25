-- ═══════════════════════════════════════════════════════════════════════════
-- 0002_documents — resumes, extracted candidate facts, jobs and skill matrix
-- ═══════════════════════════════════════════════════════════════════════════

-- ── resumes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resumes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name      text        NOT NULL,
  mime_type      text        NOT NULL CHECK (mime_type IN (
                   'application/pdf',
                   'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                   'text/plain'
                 )),
  byte_size      integer     NOT NULL CHECK (byte_size > 0),
  -- SHA-256 of the uploaded bytes; lets us skip re-analysing identical uploads.
  content_hash   text        NOT NULL,
  -- Extracted plain text. The original binary is not retained: everything the
  -- product needs lives in raw_text + the structured analysis below.
  raw_text       text        NOT NULL,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'analyzing', 'ready', 'failed')),
  failure_reason text,
  -- Full CandidateAnalysis document as validated by the Zod schema.
  analysis       jsonb,
  analyzed_at    timestamptz,
  is_primary     boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resumes_user_id_created_idx ON resumes (user_id, created_at DESC);
-- At most one primary resume per user.
CREATE UNIQUE INDEX IF NOT EXISTS resumes_one_primary_per_user
  ON resumes (user_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS resumes_user_hash_idx ON resumes (user_id, content_hash);

DROP TRIGGER IF EXISTS resumes_set_updated_at ON resumes;
CREATE TRIGGER resumes_set_updated_at BEFORE UPDATE ON resumes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── candidate_skills ───────────────────────────────────────────────────────
-- Normalised skills claimed by a resume. Kept relational (rather than only in
-- resumes.analysis) so skill coverage and gap analytics can be queried in SQL.
CREATE TABLE IF NOT EXISTS candidate_skills (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id         uuid        REFERENCES resumes(id) ON DELETE CASCADE,
  -- Lowercase canonical form used for joins against job_skills.
  skill_key         text        NOT NULL,
  skill_label       text        NOT NULL,
  category          text        NOT NULL DEFAULT 'technical'
                                CHECK (category IN ('technical', 'tool', 'domain', 'soft', 'language', 'certification')),
  -- What the CV claims, before any interview evidence.
  claimed_level     text        CHECK (claimed_level IS NULL OR claimed_level IN
                                  ('beginner', 'intermediate', 'advanced', 'expert')),
  years_used        numeric(4,1) CHECK (years_used IS NULL OR years_used >= 0),
  evidence          text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resume_id, skill_key)
);

CREATE INDEX IF NOT EXISTS candidate_skills_user_idx ON candidate_skills (user_id, skill_key);

-- ── candidate_experiences / projects / education ───────────────────────────
CREATE TABLE IF NOT EXISTS candidate_experiences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id    uuid        REFERENCES resumes(id) ON DELETE CASCADE,
  company      text,
  title        text,
  start_date   text,
  end_date     text,
  is_current   boolean     NOT NULL DEFAULT false,
  summary      text,
  achievements jsonb       NOT NULL DEFAULT '[]'::jsonb,
  technologies jsonb       NOT NULL DEFAULT '[]'::jsonb,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_experiences_user_idx ON candidate_experiences (user_id, resume_id);

CREATE TABLE IF NOT EXISTS candidate_projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id    uuid        REFERENCES resumes(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  description  text,
  technologies jsonb       NOT NULL DEFAULT '[]'::jsonb,
  outcomes     text,
  url          text,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_projects_user_idx ON candidate_projects (user_id, resume_id);

CREATE TABLE IF NOT EXISTS candidate_education (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id   uuid        REFERENCES resumes(id) ON DELETE CASCADE,
  institution text,
  degree      text,
  field       text,
  start_date  text,
  end_date    text,
  grade       text,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_education_user_idx ON candidate_education (user_id, resume_id);

CREATE TABLE IF NOT EXISTS candidate_certifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id  uuid        REFERENCES resumes(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  issuer     text,
  issued_at  text,
  sort_order integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_certifications_user_idx ON candidate_certifications (user_id, resume_id);

-- ── jobs ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             text        NOT NULL,
  company           text,
  location          text,
  employment_type   text,
  seniority         text        CHECK (seniority IS NULL OR seniority IN
                                  ('intern', 'junior', 'mid', 'senior', 'lead', 'principal')),
  description       text        NOT NULL,
  source_url        text,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'analyzing', 'ready', 'failed')),
  failure_reason    text,
  -- Full JobAnalysis document as validated by the Zod schema.
  analysis          jsonb,
  analyzed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_user_id_created_idx ON jobs (user_id, created_at DESC);

DROP TRIGGER IF EXISTS jobs_set_updated_at ON jobs;
CREATE TRIGGER jobs_set_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── job_skills — the Job Skill Matrix ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_skills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_key   text        NOT NULL,
  skill_label text        NOT NULL,
  category    text        NOT NULL DEFAULT 'technical'
                          CHECK (category IN ('technical', 'tool', 'domain', 'soft', 'language', 'certification')),
  requirement text        NOT NULL DEFAULT 'required'
                          CHECK (requirement IN ('required', 'preferred', 'nice_to_have')),
  importance  text        NOT NULL DEFAULT 'medium'
                          CHECK (importance IN ('low', 'medium', 'high', 'critical')),
  -- Derived weight (0..1) used by the interview planner to allocate question
  -- budget across skills. Stored so planning is reproducible and auditable.
  weight      numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (weight >= 0 AND weight <= 1),
  evidence    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, skill_key)
);

CREATE INDEX IF NOT EXISTS job_skills_job_idx ON job_skills (job_id);
CREATE INDEX IF NOT EXISTS job_skills_user_skill_idx ON job_skills (user_id, skill_key);
