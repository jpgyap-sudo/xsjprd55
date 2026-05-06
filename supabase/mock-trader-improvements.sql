-- ============================================================
-- Mock Trader Quality Improvements — Schema
-- Phase 1: Strategy Scorecard + Post-Trade Learning
-- ============================================================

-- ── 1. Strategy Scorecard Table ─────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_scorecard (
  id BIGSERIAL PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  market_regime TEXT DEFAULT 'any',
  total_trades INT DEFAULT 0,
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  profit_factor NUMERIC DEFAULT 0,
  avg_pnl_usd NUMERIC DEFAULT 0,
  avg_pnl_pct NUMERIC DEFAULT 0,
  avg_r NUMERIC DEFAULT 0,
  max_drawdown_pct NUMERIC DEFAULT 0,
  max_favorable_excursion NUMERIC DEFAULT 0,
  max_adverse_excursion NUMERIC DEFAULT 0,
  avg_time_in_trade_minutes INT DEFAULT 0,
  dynamic_threshold NUMERIC DEFAULT 0.65,
  consecutive_losses INT DEFAULT 0,
  consecutive_wins INT DEFAULT 0,
  last_trade_at TIMESTAMPTZ,
  is_throttled BOOLEAN DEFAULT FALSE,
  throttle_reason TEXT,
  throttle_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(strategy_name, symbol, timeframe, market_regime)
);

CREATE INDEX IF NOT EXISTS idx_scorecard_strategy ON strategy_scorecard(strategy_name, symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_scorecard_throttled ON strategy_scorecard(is_throttled) WHERE is_throttled = TRUE;
CREATE INDEX IF NOT EXISTS idx_scorecard_regime ON strategy_scorecard(market_regime);

-- ── 2. Additional Columns for mock_trades ───────────────────
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS partial_exit_price NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS partial_exit_pct NUMERIC DEFAULT 0;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS r_multiple_at_close NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS initial_risk_usd NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS market_regime_at_entry TEXT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS signal_quality_score NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS quality_gate_reason TEXT;

-- ── 3. Learning Feedback Log ────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_feedback_log (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,  -- 'config_updated', 'throttle_applied', 'throttle_released', 'lesson_generated'
  strategy_name TEXT,
  symbol TEXT,
  timeframe TEXT,
  market_regime TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_feedback_type ON learning_feedback_log(event_type);
CREATE INDEX IF NOT EXISTS idx_learning_feedback_strategy ON learning_feedback_log(strategy_name, symbol);

-- ── 4. Market Regime Snapshots ──────────────────────────────
CREATE TABLE IF NOT EXISTS market_regime_snapshots (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  regime TEXT NOT NULL,
  adx NUMERIC,
  atr_pct NUMERIC,
  volatility_label TEXT,
  news_risk_score NUMERIC DEFAULT 0,
  snapshot_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regime_snapshots_latest ON market_regime_snapshots(symbol, timeframe, snapshot_at DESC);
