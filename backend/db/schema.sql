-- ═══════════════════════════════════════════════════════
--  SanaNeke — PostgreSQL Schema
--  Run this once after creating the Render DB
-- ═══════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users (with psychologist verification) ─────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(120) NOT NULL,
  email           VARCHAR(200) NOT NULL UNIQUE,
  password_hash   TEXT         NOT NULL,
  role            VARCHAR(20)  NOT NULL CHECK (role IN ('user','psychologist')),
  specialization  VARCHAR(200),
  bio             TEXT,
  price           INTEGER      DEFAULT 0,
  is_verified     BOOLEAN      DEFAULT FALSE,  -- admin verifies certs before publishing
  certificates    TEXT,                        -- one per line, URL allowed
  achievements    TEXT,
  education       TEXT,
  experience_years INTEGER     DEFAULT 0,
  created_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Test Results (transparent finance calculator) ────────
CREATE TABLE IF NOT EXISTS test_results (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scores      JSONB       NOT NULL,          -- {comm,emot,vals,fin}
  total       INTEGER     NOT NULL,
  calc_bonus  INTEGER,
  income      BIGINT,
  expense     BIGINT,
  region           TEXT,                     -- e.g. 'Алматы қ.'
  pm_value         INTEGER,                  -- regional living wage used
  children_planned INTEGER DEFAULT 0,        -- kids planned in 5 years
  housing          TEXT,                     -- 'own' | 'rent'
  rent_amount      BIGINT  DEFAULT 0,
  debt_monthly     BIGINT  DEFAULT 0,        -- credit/mortgage per month
  fin_detail       JSONB,                    -- full breakdown {need,net,coverage,...}
  case_answers     JSONB,                    -- open case answers {0:"...",...}
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

-- ── Reviews (user → psychologist rating & feedback) ──────
CREATE TABLE IF NOT EXISTS reviews (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  psych_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      INTEGER     NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (psych_id, user_id)
);

-- ── Messages (in-platform chat user ↔ psychologist) ────
CREATE TABLE IF NOT EXISTS messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID        NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  sender_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_results_user   ON test_results(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_user  ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_psych ON requests(psych_id);
CREATE INDEX IF NOT EXISTS idx_responses_user ON responses(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_psych  ON reviews(psych_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user   ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_request ON messages(request_id);

