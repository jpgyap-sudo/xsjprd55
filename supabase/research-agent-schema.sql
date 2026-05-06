-- ============================================================
-- Research Agent Supabase Schema Migration
-- Moves Research Agent tables from SQLite to Supabase.
-- ============================================================

-- ── research_sources ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS research_sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_name   TEXT NOT NULL,
  source_url    TEXT,
  content       TEXT NOT NULL,
  extracted_hints_json JSONB NOT NULL DEFAULT '[]',
  used          BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_research_sources_created_at ON research_sources(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_sources_used ON research_sources(used) WHERE used = FALSE;

-- ── strategy_proposals ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_proposals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  rules_json    JSONB NOT NULL DEFAULT '[]',
  confidence    NUMERIC NOT NULL DEFAULT 0,
  tested        BOOLEAN NOT NULL DEFAULT FALSE,
  promoted      BOOLEAN NOT NULL DEFAULT FALSE,
  rejected      BOOLEAN NOT NULL DEFAULT FALSE,
  rules_hash    TEXT,
  source_name   TEXT,
  source_credibility NUMERIC NOT NULL DEFAULT 0.5,
  is_synthetic  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_strategy_proposals_created_at ON strategy_proposals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_proposals_tested ON strategy_proposals(tested) WHERE tested = FALSE;
CREATE INDEX IF NOT EXISTS idx_strategy_proposals_rules_hash ON strategy_proposals(rules_hash);

-- ── backtest_results ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backtest_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  strategy_name     TEXT NOT NULL,
  symbol            TEXT NOT NULL,
  total_return_pct  NUMERIC NOT NULL DEFAULT 0,
  total_trades      INTEGER NOT NULL DEFAULT 0,
  win_rate          NUMERIC NOT NULL DEFAULT 0,
  sharpe_ratio      NUMERIC NOT NULL DEFAULT 0,
  max_drawdown_pct  NUMERIC NOT NULL DEFAULT 0,
  profit_factor     NUMERIC NOT NULL DEFAULT 0,
  expectancy         NUMERIC NOT NULL DEFAULT 0,
  is_synthetic       BOOLEAN NOT NULL DEFAULT FALSE,
  has_random_features BOOLEAN NOT NULL DEFAULT FALSE,
  trade_log_json    JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_backtest_results_run_at ON backtest_results(run_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy ON backtest_results(strategy_name, run_at DESC);

-- ── strategy_lifecycle ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_lifecycle (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id           UUID REFERENCES strategy_proposals(id) ON DELETE SET NULL,
  strategy_name         TEXT NOT NULL UNIQUE,
  status                TEXT NOT NULL DEFAULT 'researched',
  historical_backtest_score NUMERIC NOT NULL DEFAULT 0,
  mock_trading_score    NUMERIC NOT NULL DEFAULT 0,
  approved_for_mock     BOOLEAN NOT NULL DEFAULT FALSE,
  rejected_reason       TEXT,
  promotion_gate_score  NUMERIC NOT NULL DEFAULT 0,
  promotion_gate_failures TEXT,
  quarantine_position_size_mult NUMERIC NOT NULL DEFAULT 1.0,
  quarantine_trades_needed INTEGER NOT NULL DEFAULT 0,
  quarantine_passed BOOLEAN NOT NULL DEFAULT FALSE,
  source_credibility NUMERIC NOT NULL DEFAULT 0.5,
  source_name TEXT,
  rules_hash TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_lifecycle_updated_at ON strategy_lifecycle(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_lifecycle_status ON strategy_lifecycle(status);

-- ── mock_strategy_feedback ─────────────────────────────────
CREATE TABLE IF NOT EXISTS mock_strategy_feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name     TEXT NOT NULL UNIQUE,
  trades            INTEGER NOT NULL DEFAULT 0,
  wins              INTEGER NOT NULL DEFAULT 0,
  losses            INTEGER NOT NULL DEFAULT 0,
  total_pnl_usd     NUMERIC NOT NULL DEFAULT 0,
  max_drawdown_pct  NUMERIC NOT NULL DEFAULT 0,
  feedback_score    NUMERIC NOT NULL DEFAULT 0,
  promoted          BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mock_strategy_feedback_promoted ON mock_strategy_feedback(promoted) WHERE promoted = TRUE;

-- Promotion Gate v2 memory and quarantine tables
CREATE TABLE IF NOT EXISTS strategy_failure_memory (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rules_hash        TEXT NOT NULL UNIQUE,
  strategy_name     TEXT NOT NULL,
  failure_reason    TEXT NOT NULL,
  failure_category  TEXT NOT NULL,
  total_trades      INTEGER NOT NULL DEFAULT 0,
  win_rate          NUMERIC NOT NULL DEFAULT 0,
  profit_factor     NUMERIC NOT NULL DEFAULT 0,
  max_drawdown_pct  NUMERIC NOT NULL DEFAULT 0,
  expectancy        NUMERIC NOT NULL DEFAULT 0,
  symbols_tested    TEXT,
  failure_count     INTEGER NOT NULL DEFAULT 1,
  failed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quarantine_trades (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name TEXT NOT NULL,
  pnl_pct       NUMERIC NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_regime_performance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name TEXT NOT NULL,
  regime        TEXT NOT NULL,
  total_trades  INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  total_pnl_pct NUMERIC NOT NULL DEFAULT 0,
  win_rate      NUMERIC NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(strategy_name, regime)
);

CREATE INDEX IF NOT EXISTS idx_failure_rules_hash ON strategy_failure_memory(rules_hash);
CREATE INDEX IF NOT EXISTS idx_failure_category ON strategy_failure_memory(failure_category);
CREATE INDEX IF NOT EXISTS idx_quarantine_strategy ON quarantine_trades(strategy_name);
CREATE INDEX IF NOT EXISTS idx_regime_strategy ON strategy_regime_performance(strategy_name, regime);

ALTER TABLE strategy_proposals ADD COLUMN IF NOT EXISTS rules_hash TEXT;
ALTER TABLE strategy_proposals ADD COLUMN IF NOT EXISTS source_name TEXT;
ALTER TABLE strategy_proposals ADD COLUMN IF NOT EXISTS source_credibility NUMERIC NOT NULL DEFAULT 0.5;
ALTER TABLE strategy_proposals ADD COLUMN IF NOT EXISTS is_synthetic BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS expectancy NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS is_synthetic BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS has_random_features BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE strategy_lifecycle ADD COLUMN IF NOT EXISTS promotion_gate_score NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE strategy_lifecycle ADD COLUMN IF NOT EXISTS promotion_gate_failures TEXT;
ALTER TABLE strategy_lifecycle ADD COLUMN IF NOT EXISTS quarantine_position_size_mult NUMERIC NOT NULL DEFAULT 1.0;
ALTER TABLE strategy_lifecycle ADD COLUMN IF NOT EXISTS quarantine_trades_needed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE strategy_lifecycle ADD COLUMN IF NOT EXISTS quarantine_passed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE strategy_lifecycle ADD COLUMN IF NOT EXISTS source_credibility NUMERIC NOT NULL DEFAULT 0.5;
ALTER TABLE strategy_lifecycle ADD COLUMN IF NOT EXISTS source_name TEXT;
ALTER TABLE strategy_lifecycle ADD COLUMN IF NOT EXISTS rules_hash TEXT;

-- ── signal_snapshots (for ML training) ─────────────────────
CREATE TABLE IF NOT EXISTS signal_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbol              TEXT NOT NULL,
  timeframe           TEXT NOT NULL,
  price               NUMERIC NOT NULL,
  signal_side         TEXT NOT NULL,
  rule_probability    NUMERIC NOT NULL,
  ml_probability      NUMERIC,
  final_probability   NUMERIC,
  features_json       JSONB NOT NULL DEFAULT '{}',
  rationale_json      JSONB NOT NULL DEFAULT '{}',
  outcome_label       INTEGER,
  outcome_return_pct  NUMERIC,
  outcome_checked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_signal_snapshots_symbol_time ON signal_snapshots(symbol, created_at);
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_outcome ON signal_snapshots(outcome_label) WHERE outcome_label IS NOT NULL;

-- ── ml_models ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ml_models (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  model_name        TEXT NOT NULL,
  version           TEXT NOT NULL,
  feature_names_json JSONB NOT NULL DEFAULT '[]',
  model_json        JSONB NOT NULL DEFAULT '{}',
  metrics_json      JSONB NOT NULL DEFAULT '{}',
  is_active         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_ml_models_active ON ml_models(is_active) WHERE is_active = TRUE;

-- Enable RLS for safety (service role bypasses this)
ALTER TABLE research_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_strategy_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_failure_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarantine_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_regime_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_models ENABLE ROW LEVEL SECURITY;

-- Create permissive policy for service role (full access)
CREATE POLICY IF NOT EXISTS service_all_research_sources ON research_sources FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_strategy_proposals ON strategy_proposals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_backtest_results ON backtest_results FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_strategy_lifecycle ON strategy_lifecycle FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_mock_strategy_feedback ON mock_strategy_feedback FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_strategy_failure_memory ON strategy_failure_memory FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_quarantine_trades ON quarantine_trades FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_strategy_regime_performance ON strategy_regime_performance FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_signal_snapshots ON signal_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_ml_models ON ml_models FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Create read-only policy for anon key (dashboard reads)
CREATE POLICY IF NOT EXISTS anon_read_research_sources ON research_sources FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_strategy_proposals ON strategy_proposals FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_backtest_results ON backtest_results FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_strategy_lifecycle ON strategy_lifecycle FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_mock_strategy_feedback ON mock_strategy_feedback FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_strategy_failure_memory ON strategy_failure_memory FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_quarantine_trades ON quarantine_trades FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_strategy_regime_performance ON strategy_regime_performance FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_signal_snapshots ON signal_snapshots FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_ml_models ON ml_models FOR SELECT TO anon USING (true);
