-- ═══════════════════════════════════════════════════════════════════════════
-- 0001_core — identity, sessions and candidate profiles
-- ═══════════════════════════════════════════════════════════════════════════

-- gen_random_uuid() is built into PostgreSQL 13+. pgcrypto is requested anyway
-- so the schema also applies cleanly to older managed instances.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Keeps updated_at honest without relying on application code.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text        NOT NULL,
  -- NULL for accounts that only ever authenticated through an OAuth identity.
  password_hash     text,
  role              text        NOT NULL DEFAULT 'user'
                                CHECK (role IN ('user', 'admin')),
  plan              text        NOT NULL DEFAULT 'free'
                                CHECK (plan IN ('free', 'pro', 'premium', 'enterprise')),
  status            text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'suspended', 'deleted')),
  email_verified_at timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

-- Email is treated case-insensitively; the application always stores lowercase
-- but the index guarantees it even if a future writer forgets.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at DESC);
CREATE INDEX IF NOT EXISTS users_plan_idx ON users (plan) WHERE status = 'active';

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── auth_identities ────────────────────────────────────────────────────────
-- Federated logins. Email/password lives on users.password_hash; this table is
-- what makes Google/GitHub a configuration change rather than a migration.
CREATE TABLE IF NOT EXISTS auth_identities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            text        NOT NULL CHECK (provider IN ('google', 'github')),
  provider_account_id text        NOT NULL,
  email               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS auth_identities_user_id_idx ON auth_identities (user_id);

-- ── sessions ───────────────────────────────────────────────────────────────
-- Opaque session tokens. Only the SHA-256 of the token is stored, so a database
-- leak does not hand over live sessions.
CREATE TABLE IF NOT EXISTS sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      text        NOT NULL UNIQUE,
  user_agent      text,
  ip_hash         text,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

-- ── profiles ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name          text,
  headline           text,
  location           text,
  phone              text,
  links              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  years_experience   numeric(4,1) CHECK (years_experience IS NULL OR years_experience >= 0),
  seniority          text        CHECK (seniority IS NULL OR seniority IN
                                  ('intern', 'junior', 'mid', 'senior', 'lead', 'principal')),
  target_role        text,
  target_industry    text,
  onboarding_done_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS profiles_set_updated_at ON profiles;
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
