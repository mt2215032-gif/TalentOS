-- ═══════════════════════════════════════════════════════════════════════════
-- 0005_rls — row level security
--
-- TalentOS enforces authorization in the repository layer: every query is
-- scoped by user_id and no route trusts a client-supplied owner. These policies
-- are defence in depth for deployments that ALSO expose the tables through
-- PostgREST/Supabase client libraries, where a leaked anon key would otherwise
-- reach candidate data directly.
--
-- The application connects with the table owner role, which bypasses RLS by
-- design, so enabling this does not change server-side behaviour.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- Tables that carry a direct user_id column.
  t text;
  owned_tables text[] := ARRAY[
    'profiles', 'resumes', 'candidate_skills', 'candidate_experiences',
    'candidate_projects', 'candidate_education', 'candidate_certifications',
    'jobs', 'job_skills', 'interviews', 'interview_questions',
    'interview_answers', 'evaluations', 'skill_scores', 'recommendations',
    'learning_plans', 'learning_plan_items', 'usage_counters'
  ];
BEGIN
  FOREACH t IN ARRAY owned_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_rw', t);
    -- auth.uid() exists on Supabase. On a plain PostgreSQL instance the
    -- function is absent, so the policy is created only when it resolves.
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'auth' AND p.proname = 'uid'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())',
        t || '_owner_rw', t
      );
    END IF;
  END LOOP;
END $$;

-- users: a row is readable only by its owner.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    DROP POLICY IF EXISTS users_self_rw ON users;
    CREATE POLICY users_self_rw ON users USING (id = auth.uid()) WITH CHECK (id = auth.uid());
  END IF;
END $$;

-- Tables with no candidate-owned rows stay locked down entirely: they are only
-- ever touched by the server, which connects as the owner role.
ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits     ENABLE ROW LEVEL SECURITY;
