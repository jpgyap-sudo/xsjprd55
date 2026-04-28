
-- ============================================================
-- Schema Additions v2 — Execution Engine + Mock Trading v3
-- ============================================================

-- 1. Execution Profiles — per-symbol learned execution parameters
CREATE TABLE IF NOT EXISTS execution_profiles (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  base_leverage NUMERIC DEFAULT 3,
  optimal_sl_pct NUMERIC DEFAULT 0.6,
  optimal_tp_pct NUMERIC DEFAULT 1.8,
  avg_fill_slippage_bps NUMERIC DEFAULT 5,
  win_rate NUMERIC DEFAULT 0.5,
  avg_rr NUMERIC DEFAULT 1.5,
  best_timeframe TEXT DEFAULT '15m',
  regime TEXT DEFAULT 'unknown',
  confidence NUMERIC DEFAULT 0.5,
  total_trades INTEGER DEFAULT 0,
  total_pnl NUMERIC DEFAULT 0,
  consecutive_losses INTEGER DEFAULT 0,
  consecutive_wins INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exec_profiles_symbol ON execution_profiles(symbol);
CREATE INDEX IF NOT EXISTS idx_exec_profiles_winrate ON execution_profiles(win_rate DESC);

-- 2. Update mock_accounts defaults to 1M and add missing columns
ALTER TABLE mock_accounts
  ALTER COLUMN starting_balance SET DEFAULT 1000000,
  ALTER COLUMN current_balance SET DEFAULT 1000000;

ALTER TABLE mock_accounts
  ADD COLUMN IF NOT EXISTS peak_balance NUMERIC DEFAULT 1000000,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- 3. Update existing accounts to 1M if they are at default 1000 or 10000
UPDATE mock_accounts
  SET starting_balance = 1000000,
      current_balance = 1000000,
      peak_balance = GREATEST(peak_balance, 1000000)
  WHERE starting_balance <= 10000;

-- 4. Ensure mock_trades has columns needed by execution engine
ALTER TABLE mock_trades
  ADD COLUMN IF NOT EXISTS trailing_stop_pct NUMERIC DEFAULT 0.35,
  ADD COLUMN IF NOT EXISTS highest_price NUMERIC,
  ADD COLUMN IF NOT EXISTS lowest_price NUMERIC,
  ADD COLUMN IF NOT EXISTS signal_id UUID REFERENCES signals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES mock_accounts(id);
