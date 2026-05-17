-- ============================================================
-- Trading Learning Layer (TLL) Schema — xsjprd55
-- Inspired by SuperRoo's neural coding + autonomous improvement
--
-- Tables:
--   tll_patterns       — Discovered feature-based win/loss patterns
--   tll_regime_log     — Market regime detection history
--   tll_skills         — Generated trading skills from patterns
--   tll_healing_log    — Strategy healing/quarantine records
-- ============================================================

-- ── TLL Patterns ───────────────────────────────────────────
-- Stores discovered feature-based patterns from signal outcomes
CREATE TABLE IF NOT EXISTS tll_patterns (
  id BIGSERIAL PRIMARY KEY,
  feature TEXT NOT NULL,
  value TEXT NOT NULL,
  samples INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  avg_pnl NUMERIC DEFAULT 0,
  signal TEXT CHECK (signal IN ('favorable', 'unfavorable')),
  confidence NUMERIC DEFAULT 0,
  compound BOOLEAN DEFAULT FALSE,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (feature, value)
);

CREATE INDEX IF NOT EXISTS idx_tll_patterns_win_rate ON tll_patterns (win_rate DESC);
CREATE INDEX IF NOT EXISTS idx_tll_patterns_discovered_at ON tll_patterns (discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_tll_patterns_signal ON tll_patterns (signal);

-- ── TLL Regime Log ─────────────────────────────────────────
-- Records detected market regimes over time
CREATE TABLE IF NOT EXISTS tll_regime_log (
  id BIGSERIAL PRIMARY KEY,
  regime TEXT NOT NULL,
  volatility NUMERIC DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  score NUMERIC DEFAULT 0,
  description TEXT,
  samples INTEGER DEFAULT 0,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tll_regime_log_detected_at ON tll_regime_log (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_tll_regime_log_regime ON tll_regime_log (regime);

-- ── TLL Skills ─────────────────────────────────────────────
-- Generated trading skills derived from discovered patterns
CREATE TABLE IF NOT EXISTS tll_skills (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  pattern_feature TEXT,
  pattern_value TEXT,
  win_rate NUMERIC DEFAULT 0,
  avg_pnl NUMERIC DEFAULT 0,
  confidence NUMERIC DEFAULT 0,
  samples INTEGER DEFAULT 0,
  signal TEXT CHECK (signal IN ('favorable', 'unfavorable')),
  compound BOOLEAN DEFAULT FALSE,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_tll_skills_active ON tll_skills (active);
CREATE INDEX IF NOT EXISTS idx_tll_skills_confidence ON tll_skills (confidence DESC);
CREATE INDEX IF NOT EXISTS idx_tll_skills_name ON tll_skills (name);

-- ── TLL Healing Log ────────────────────────────────────────
-- Records of strategy healing/quarantine events
CREATE TABLE IF NOT EXISTS tll_healing_log (
  id BIGSERIAL PRIMARY KEY,
  strategy TEXT NOT NULL,
  total_signals INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  avg_pnl NUMERIC DEFAULT 0,
  total_pnl NUMERIC DEFAULT 0,
  action TEXT CHECK (action IN ('review', 'quarantine')),
  reason TEXT,
  suggestion TEXT,
  healed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tll_healing_log_strategy ON tll_healing_log (strategy);
CREATE INDEX IF NOT EXISTS idx_tll_healing_log_healed_at ON tll_healing_log (healed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tll_healing_log_action ON tll_healing_log (action);

-- ── RLS Policies ───────────────────────────────────────────
-- Uses DO blocks to check existence first (avoids "CREATE POLICY IF NOT EXISTS"
-- syntax error on some Supabase PostgreSQL versions)
ALTER TABLE tll_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE tll_regime_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tll_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE tll_healing_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tll_patterns' AND policyname = 'service_role_all_tll_patterns') THEN
    CREATE POLICY "service_role_all_tll_patterns" ON tll_patterns FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tll_regime_log' AND policyname = 'service_role_all_tll_regime_log') THEN
    CREATE POLICY "service_role_all_tll_regime_log" ON tll_regime_log FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tll_skills' AND policyname = 'service_role_all_tll_skills') THEN
    CREATE POLICY "service_role_all_tll_skills" ON tll_skills FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tll_healing_log' AND policyname = 'service_role_all_tll_healing_log') THEN
    CREATE POLICY "service_role_all_tll_healing_log" ON tll_healing_log FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END;
$$;
