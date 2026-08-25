-- ═══════════════════════════════════════════════════════════════════════════
-- 0004_platform — AI cost ledger, usage quotas, rate limits, product analytics
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ai_usage_events — one row per AI call, the cost ledger ─────────────────
CREATE TABLE IF NOT EXISTS ai_usage_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        REFERENCES users(id) ON DELETE SET NULL,
  interview_id      uuid        REFERENCES interviews(id) ON DELETE SET NULL,
  -- Which engine step spent the tokens.
  task              text        NOT NULL CHECK (task IN
                      ('resume_analysis', 'job_analysis', 'interview_plan', 'question_generation',
                       'answer_analysis', 'followup_decision', 'final_evaluation', 'learning_plan')),
  provider          text        NOT NULL,
  model             text        NOT NULL,
  input_tokens      integer     NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens     integer     NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cached_read_tokens  integer   NOT NULL DEFAULT 0 CHECK (cached_read_tokens >= 0),
  cached_write_tokens integer   NOT NULL DEFAULT 0 CHECK (cached_write_tokens >= 0),
  -- USD, six decimal places — single calls are fractions of a cent.
  cost_usd          numeric(12,6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  latency_ms        integer     CHECK (latency_ms IS NULL OR latency_ms >= 0),
  ok                boolean     NOT NULL DEFAULT true,
  error_kind        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_interview_idx ON ai_usage_events (interview_id);
CREATE INDEX IF NOT EXISTS ai_usage_user_created_idx ON ai_usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage_events (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_task_idx ON ai_usage_events (task, created_at DESC);

-- ── usage_counters — plan quota enforcement ───────────────────────────────
-- One row per user per metric per calendar month. Incremented atomically at the
-- point of use so quota checks never race.
CREATE TABLE IF NOT EXISTS usage_counters (
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- First day of the billing month, e.g. 2026-08-01.
  period_start date       NOT NULL,
  metric      text        NOT NULL CHECK (metric IN
                ('interviews', 'resume_analyses', 'ai_questions', 'voice_interviews')),
  used        integer     NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_start, metric)
);

CREATE INDEX IF NOT EXISTS usage_counters_period_idx ON usage_counters (period_start, metric);

-- ── rate_limits — shared limiter for multi-instance deployments ───────────
-- Fixed-window counters. `bucket` encodes the identity + route + window start.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket      text        PRIMARY KEY,
  hits        integer     NOT NULL DEFAULT 0 CHECK (hits >= 0),
  expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON rate_limits (expires_at);

-- ── analytics_events — product telemetry ──────────────────────────────────
-- Deliberately free of answer text and other candidate content: this table is
-- what an analyst or a BI tool connects to, so it carries only event shape.
CREATE TABLE IF NOT EXISTS analytics_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid        REFERENCES users(id) ON DELETE SET NULL,
  event      text        NOT NULL,
  entity_id  uuid,
  props      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_events_event_idx ON analytics_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_user_idx ON analytics_events (user_id, created_at DESC);

-- ── error_log — operational errors surfaced in the admin dashboard ────────
CREATE TABLE IF NOT EXISTS error_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid        REFERENCES users(id) ON DELETE SET NULL,
  scope       text        NOT NULL,
  code        text        NOT NULL,
  message     text        NOT NULL,
  context     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS error_log_created_idx ON error_log (created_at DESC);
CREATE INDEX IF NOT EXISTS error_log_scope_idx ON error_log (scope, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Reporting views — stable contracts for the admin dashboard and any external
-- BI tool (Power BI, Metabase). Views keep the aggregation logic in one place
-- and expose no candidate answer text.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW analytics_interview_funnel AS
SELECT
  date_trunc('day', i.created_at)::date            AS day,
  i.interview_type,
  i.difficulty,
  count(*)                                          AS started,
  count(*) FILTER (WHERE i.status = 'completed')    AS completed,
  count(*) FILTER (WHERE i.status = 'abandoned')    AS abandoned,
  round(avg(e.overall_score) FILTER (WHERE e.overall_score IS NOT NULL), 1) AS avg_score,
  round(avg(i.duration_seconds) FILTER (WHERE i.duration_seconds IS NOT NULL)) AS avg_duration_seconds
FROM interviews i
LEFT JOIN evaluations e ON e.interview_id = i.id
GROUP BY 1, 2, 3;

CREATE OR REPLACE VIEW analytics_skill_gaps AS
SELECT
  s.skill_key,
  max(s.skill_label)                              AS skill_label,
  s.category,
  count(*)                                        AS observations,
  count(*) FILTER (WHERE s.is_gap)                AS gap_count,
  round(avg(s.score), 1)                          AS avg_score
FROM skill_scores s
GROUP BY s.skill_key, s.category;

CREATE OR REPLACE VIEW analytics_ai_cost AS
SELECT
  date_trunc('day', a.created_at)::date AS day,
  a.provider,
  a.model,
  a.task,
  count(*)                              AS calls,
  count(*) FILTER (WHERE NOT a.ok)      AS failures,
  sum(a.input_tokens)                   AS input_tokens,
  sum(a.output_tokens)                  AS output_tokens,
  round(sum(a.cost_usd), 4)             AS cost_usd,
  round(avg(a.latency_ms))              AS avg_latency_ms
FROM ai_usage_events a
GROUP BY 1, 2, 3, 4;

-- Cost attributed to each completed interview — the unit economics view.
CREATE OR REPLACE VIEW analytics_cost_per_interview AS
SELECT
  i.id                                   AS interview_id,
  i.user_id,
  i.interview_type,
  i.status,
  i.created_at,
  coalesce(sum(a.cost_usd), 0)           AS cost_usd,
  coalesce(sum(a.input_tokens), 0)       AS input_tokens,
  coalesce(sum(a.output_tokens), 0)      AS output_tokens,
  count(a.id)                            AS ai_calls
FROM interviews i
LEFT JOIN ai_usage_events a ON a.interview_id = i.id
GROUP BY i.id;
