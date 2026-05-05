-- ============================================================
-- MASTER MIGRATION: Run ALL pending schema changes
-- Copy and paste this entire file into Supabase SQL Editor
-- ============================================================

-- 1. Research Agent Schema (missing tables)
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
  rejected      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_strategy_proposals_created_at ON strategy_proposals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_proposals_tested ON strategy_proposals(tested) WHERE tested = FALSE;

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
ALTER TABLE signal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_models ENABLE ROW LEVEL SECURITY;

-- Create permissive policy for service role (full access)
CREATE POLICY IF NOT EXISTS service_all_research_sources ON research_sources FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_strategy_proposals ON strategy_proposals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_backtest_results ON backtest_results FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_strategy_lifecycle ON strategy_lifecycle FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_mock_strategy_feedback ON mock_strategy_feedback FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_signal_snapshots ON signal_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS service_all_ml_models ON ml_models FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Create read-only policy for anon key (dashboard reads)
CREATE POLICY IF NOT EXISTS anon_read_research_sources ON research_sources FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_strategy_proposals ON strategy_proposals FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_backtest_results ON backtest_results FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_strategy_lifecycle ON strategy_lifecycle FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_mock_strategy_feedback ON mock_strategy_feedback FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_signal_snapshots ON signal_snapshots FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS anon_read_ml_models ON ml_models FOR SELECT TO anon USING (true);

-- 2. Execution Worker Fix (execution_profiles table + mock_trades fixes)
-- ============================================================
-- 2a. Ensure execution_profiles table exists
CREATE TABLE IF NOT EXISTS execution_profiles (
  id              BIGSERIAL PRIMARY KEY,
  symbol          TEXT NOT NULL UNIQUE,
  base_leverage   NUMERIC DEFAULT 3,
  optimal_sl_pct  NUMERIC DEFAULT 0.6,
  optimal_tp_pct  NUMERIC DEFAULT 1.8,
  avg_fill_slippage_bps NUMERIC DEFAULT 5,
  win_rate        NUMERIC DEFAULT 0.5,
  avg_rr          NUMERIC DEFAULT 1.5,
  best_timeframe  TEXT DEFAULT '15m',
  regime          TEXT DEFAULT 'unknown',
  confidence      NUMERIC DEFAULT 0.5,
  total_trades    INTEGER DEFAULT 0,
  total_pnl       NUMERIC DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exec_profiles_symbol ON execution_profiles(symbol);

-- 2b. Seed execution profiles for top symbols
INSERT INTO execution_profiles (symbol, base_leverage, win_rate, avg_rr, optimal_sl_pct, optimal_tp_pct)
VALUES
  ('BTCUSDT', 5, 0.52, 1.8, 0.5, 1.5),
  ('ETHUSDT', 4, 0.50, 1.6, 0.6, 1.8),
  ('SOLUSDT', 3, 0.48, 1.5, 0.8, 2.0),
  ('BNBUSDT', 3, 0.48, 1.5, 0.8, 2.0),
  ('XRPUSDT', 3, 0.47, 1.4, 0.9, 2.1),
  ('DOGEUSDT', 2, 0.45, 1.3, 1.0, 2.2),
  ('ADAUSDT', 3, 0.48, 1.5, 0.8, 2.0),
  ('AVAXUSDT', 3, 0.47, 1.5, 0.9, 2.1),
  ('LINKUSDT', 3, 0.49, 1.6, 0.7, 1.9),
  ('LTCUSDT', 3, 0.48, 1.5, 0.8, 2.0)
ON CONFLICT (symbol) DO NOTHING;

-- 2c. Fix mock_trades side constraint to accept both cases
DO $$
BEGIN
  ALTER TABLE mock_trades DROP CONSTRAINT IF EXISTS mock_trades_side_check;
  ALTER TABLE mock_trades ADD CONSTRAINT mock_trades_side_check 
    CHECK (side IN ('long', 'short', 'LONG', 'SHORT'));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Constraint update issue: %', SQLERRM;
END $$;

-- 2d. Ensure all required columns exist in mock_trades
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES mock_accounts(id);
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS signal_id UUID REFERENCES signals(id) ON DELETE SET NULL;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS symbol TEXT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS side TEXT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS strategy_name TEXT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS entry_price NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS exit_price NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS leverage NUMERIC DEFAULT 1;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS position_size_usd NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS margin_used NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS stop_loss NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS take_profit NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS pnl_pct NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS pnl_usd NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open';
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS entry_reason TEXT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS exit_reason TEXT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS probability_at_entry NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS score_breakdown JSONB DEFAULT '{}';
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS trailing_stop_pct NUMERIC DEFAULT 0.35;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS highest_price NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS lowest_price NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS exit_at TIMESTAMPTZ;

-- 2e. Create trigger to sync exit_at with closed_at
CREATE OR REPLACE FUNCTION sync_exit_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.closed_at IS NOT NULL AND NEW.exit_at IS NULL THEN
    NEW.exit_at = NEW.closed_at;
  ELSIF NEW.exit_at IS NOT NULL AND NEW.closed_at IS NULL THEN
    NEW.closed_at = NEW.exit_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_exit_at_trigger ON mock_trades;
CREATE TRIGGER sync_exit_at_trigger
  BEFORE INSERT OR UPDATE ON mock_trades
  FOR EACH ROW EXECUTE FUNCTION sync_exit_at();

-- 2f. Ensure mock_accounts has current_balance column
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS current_balance NUMERIC DEFAULT 10000;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS starting_balance NUMERIC DEFAULT 10000;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS total_pnl NUMERIC DEFAULT 0;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS total_trades INTEGER DEFAULT 0;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS win_rate NUMERIC DEFAULT 0;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2g. Seed mock_accounts if empty
INSERT INTO mock_accounts (starting_balance, current_balance, total_pnl, total_trades, win_rate)
SELECT 10000, 10000, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM mock_accounts LIMIT 1);

-- 3. Fix signals status check constraint (add 'skipped' and 'executed')
-- ============================================================
-- The execution-worker marks signals as 'skipped' or 'executed' after processing
-- to prevent infinite reprocessing loops. The original constraint only allowed
-- 'active','confirmed','dismissed','expired'.
DO $$
BEGIN
  ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_status_check;
  ALTER TABLE signals ADD CONSTRAINT signals_status_check
    CHECK (status IN ('active','confirmed','dismissed','expired','skipped','executed'));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Signals status constraint update issue: %', SQLERRM;
END $$;

-- 4. Fix api_debugger_results provider check constraint
-- ============================================================
DO $$
BEGIN
  ALTER TABLE api_debugger_results DROP CONSTRAINT IF EXISTS api_debugger_results_provider_check;
  ALTER TABLE api_debugger_results ADD CONSTRAINT api_debugger_results_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'kimi', 'gemini', 'deepseek', 'claude', 'gpt4', 'gpt-4', 'gpt-3.5-turbo', 'custom'));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Provider constraint update issue: %', SQLERRM;
END $$;

-- ============================================================
-- VERIFICATION QUERIES (run these to confirm)
-- ============================================================
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
-- SELECT COUNT(*) as research_sources FROM research_sources;
-- SELECT COUNT(*) as strategy_proposals FROM strategy_proposals;
-- SELECT COUNT(*) as backtest_results FROM backtest_results;
-- SELECT COUNT(*) as strategy_lifecycle FROM strategy_lifecycle;
-- SELECT COUNT(*) as mock_strategy_feedback FROM mock_strategy_feedback;
-- SELECT COUNT(*) as execution_profiles FROM execution_profiles;
-- SELECT COUNT(*) as mock_accounts FROM mock_accounts;
-- SELECT COUNT(*) FROM signals WHERE status = 'active';
-- SELECT COUNT(*) FROM signals WHERE status IN ('skipped','executed');
