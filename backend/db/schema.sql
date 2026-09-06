-- ═══════════════════════════════════════════════════════
--  SanaNeke — PostgreSQL Schema
--  Run this once after creating the Render DB
-- ═══════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(120) NOT NULL,
  email           VARCHAR(200) NOT NULL UNIQUE,
  password_hash   TEXT         NOT NULL,
  role            VARCHAR(20)  NOT NULL CHECK (role IN ('user','psychologist')),
  specialization  VARCHAR(200),
  bio             TEXT,
  price           INTEGER      DEFAULT 0,
  created_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Test Results ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_results (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scores      JSONB       NOT NULL,          -- {comm,emot,vals,fin}
  total       INTEGER     NOT NULL,
  calc_bonus  INTEGER,
  income      BIGINT,
  expense     BIGINT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Requests (user → psychologist) ───────────────────────
CREATE TABLE IF NOT EXISTS requests (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  psych_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result_id   UUID        REFERENCES test_results(id) ON DELETE SET NULL,
  responded   BOOLEAN     DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, psych_id)
);

-- ── Responses (psychologist → user) ──────────────────────
CREATE TABLE IF NOT EXISTS responses (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID        NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  psych_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feedback    TEXT        NOT NULL,
  price       INTEGER     DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_results_user  ON test_results(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_psych ON requests(psych_id);
CREATE INDEX IF NOT EXISTS idx_responses_user ON responses(user_id);
