-- ============================================================
-- Perpetual Trader — Complete Trade History Schema
-- Stores every trade with full context for dashboard display
-- and research agent learning.
-- ============================================================

-- 1. PERP_TRADE_HISTORY — immutable log of every trade event
CREATE TABLE IF NOT EXISTS perp_trade_history (
  id              BIGSERIAL PRIMARY KEY,
  trade_id        UUID REFERENCES perpetual_mock_trades(id) ON DELETE CASCADE,
  account_id      UUID REFERENCES perpetual_mock_accounts(id) ON DELETE CASCADE,
  
  -- Trade identifiers
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('LONG','SHORT')),
  strategy        TEXT,
  timeframe       TEXT,
  
  -- Entry snapshot
  entry_price     NUMERIC NOT NULL,
  entry_at        TIMESTAMPTZ NOT NULL,
  entry_reason    TEXT,
  
  -- Exit snapshot
  exit_price      NUMERIC,
  exit_at         TIMESTAMPTZ,
  exit_reason     TEXT CHECK (exit_reason IN ('sl','tp','manual','expired','adaptive_close')),
  exit_reason_detail TEXT,
  
  -- Position details
  position_size_usd NUMERIC NOT NULL,
  margin_used     NUMERIC NOT NULL,
  leverage        NUMERIC NOT NULL,
  stop_loss       NUMERIC,
  take_profit     NUMERIC,
  risk_reward     NUMERIC,
  
  -- P&L
  pnl_usd         NUMERIC,
  pnl_pct         NUMERIC,
  
  -- Signal source
  confidence      NUMERIC,
  signal_id       UUID,
  
  -- Analysis fields (populated on close)
  hold_duration_minutes INTEGER,         -- how long the trade was held
  exit_quality    TEXT,                   -- 'excellent', 'good', 'fair', 'poor'
  what_went_right TEXT,                   -- analysis of what worked
  what_went_wrong TEXT,                   -- analysis of what went wrong
  strategy_notes  TEXT,                   -- strategy-specific observations
  market_condition TEXT,                  -- market context at exit
  
  -- ML features snapshot (for research agent)
  entry_features  JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perp_trade_history_account ON perp_trade_history(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_perp_trade_history_symbol ON perp_trade_history(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_perp_trade_history_strategy ON perp_trade_history(strategy, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_perp_trade_history_exit ON perp_trade_history(exit_at DESC) WHERE exit_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_perp_trade_history_pnl ON perp_trade_history(pnl_usd DESC) WHERE pnl_usd IS NOT NULL;

-- 2. PERP_RESEARCH_INSIGHTS — aggregated insights for research agent
CREATE TABLE IF NOT EXISTS perp_research_insights (
  id              BIGSERIAL PRIMARY KEY,
  strategy        TEXT NOT NULL,
  symbol          TEXT,
  timeframe       TEXT,
  
  -- Performance metrics
  total_trades    INTEGER NOT NULL DEFAULT 0,
  wins            INTEGER NOT NULL DEFAULT 0,
  losses          INTEGER NOT NULL DEFAULT 0,
  win_rate        NUMERIC,
  total_pnl       NUMERIC NOT NULL DEFAULT 0,
  avg_pnl         NUMERIC,
  best_pnl        NUMERIC,
  worst_pnl       NUMERIC,
  avg_hold_minutes NUMERIC,
  
  -- Risk metrics
  max_drawdown    NUMERIC DEFAULT 0,
  profit_factor   NUMERIC,               -- gross profit / gross loss
  sharpe_approx   NUMERIC,               -- approximate sharpe
  
  -- Strategy-specific
  avg_confidence  NUMERIC,
  common_exit_reasons JSONB DEFAULT '[]',
  what_worked     TEXT,                   -- aggregated learnings
  what_failed     TEXT,                   -- aggregated failures
  
  -- Time range
  first_trade_at  TIMESTAMPTZ,
  last_trade_at   TIMESTAMPTZ,
  
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(strategy, COALESCE(symbol, ''), COALESCE(timeframe, ''))
);

CREATE INDEX IF NOT EXISTS idx_perp_research_insights_strategy ON perp_research_insights(strategy, win_rate DESC);
CREATE INDEX IF NOT EXISTS idx_perp_research_insights_pnl ON perp_research_insights(total_pnl DESC);

-- 3. PERP_DAILY_SUMMARY — daily P&L snapshots for the dashboard
CREATE TABLE IF NOT EXISTS perp_daily_summary (
  id              BIGSERIAL PRIMARY KEY,
  account_id      UUID REFERENCES perpetual_mock_accounts(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  
  trades          INTEGER NOT NULL DEFAULT 0,
  wins            INTEGER NOT NULL DEFAULT 0,
  losses          INTEGER NOT NULL DEFAULT 0,
  pnl_usd         NUMERIC NOT NULL DEFAULT 0,
  volume_usd      NUMERIC NOT NULL DEFAULT 0,
  
  best_trade_pnl  NUMERIC,
  worst_trade_pnl NUMERIC,
  
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(account_id, date)
);

CREATE INDEX IF NOT EXISTS idx_perp_daily_summary_date ON perp_daily_summary(date DESC);
