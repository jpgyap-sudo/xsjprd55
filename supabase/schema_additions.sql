
-- ============================================================
-- Execution Profiles — per-symbol learned execution parameters
-- Populated by execution-engine.js via Bayesian updates
-- ============================================================

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
