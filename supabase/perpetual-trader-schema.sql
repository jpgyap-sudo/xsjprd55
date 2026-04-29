-- ============================================================
-- Mock Perpetual Signal Trader + Signal Memory Schema
-- ============================================================

-- 1. SIGNAL_MEMORY — persisted signal history with rich context for research agent
CREATE TABLE IF NOT EXISTS signal_memory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id     UUID REFERENCES signals(id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('LONG','SHORT','CLOSE')),
  entry_price   NUMERIC,
  stop_loss     NUMERIC,
  take_profit   NUMERIC[],
  confidence    NUMERIC,
  strategy      TEXT NOT NULL,
  timeframe     TEXT NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL,
  source        TEXT NOT NULL DEFAULT 'auto',
  mode          TEXT NOT NULL DEFAULT 'paper',
  
  -- Rich description & explanation
  description   TEXT,           -- human-readable signal explanation
  entry_reason  TEXT,           -- why this entry was chosen
  risk_reward   NUMERIC,        -- calculated R:R ratio
  
  -- Market context at signal time
  market_ctx    JSONB DEFAULT '{}',
  -- e.g. {"rsi": 62, "ema9": 42300, "ema21": 41800, "vol_spike": 1.4, "change24h": 2.3}
  
  -- Outcome tracking (filled later by mock trader)
  outcome       TEXT CHECK (outcome IN ('pending','win','loss','expired','cancelled')),
  outcome_pnl   NUMERIC,
  outcome_note  TEXT,
  
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signal_memory_symbol ON signal_memory(symbol, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_memory_strategy ON signal_memory(strategy, outcome);
CREATE INDEX IF NOT EXISTS idx_signal_memory_outcome ON signal_memory(outcome) WHERE outcome IS NOT NULL;

-- 2. PERPETUAL_MOCK_ACCOUNTS — paper perpetual futures accounts
CREATE TABLE IF NOT EXISTS perpetual_mock_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE DEFAULT 'Perpetual Signal Trader',
  starting_balance NUMERIC NOT NULL DEFAULT 100000,
  current_balance  NUMERIC NOT NULL DEFAULT 100000,
  available_balance NUMERIC NOT NULL DEFAULT 100000,
  peak_balance     NUMERIC NOT NULL DEFAULT 100000,
  equity           NUMERIC NOT NULL DEFAULT 100000,
  margin_used      NUMERIC NOT NULL DEFAULT 0,
  unrealized_pnl   NUMERIC NOT NULL DEFAULT 0,
  realized_pnl     NUMERIC NOT NULL DEFAULT 0,
  
  -- Risk settings
  max_risk_per_trade NUMERIC NOT NULL DEFAULT 0.01,    -- 1% of equity
  max_leverage       NUMERIC NOT NULL DEFAULT 10,
  default_leverage   NUMERIC NOT NULL DEFAULT 3,
  max_open_trades    INTEGER NOT NULL DEFAULT 5,
  max_exposure_pct   NUMERIC NOT NULL DEFAULT 0.25,     -- 25% per coin
  daily_max_loss_pct NUMERIC NOT NULL DEFAULT 0.05,     -- 5%
  max_drawdown_stop_pct NUMERIC NOT NULL DEFAULT 0.15,  -- 15%
  
  -- State
  daily_pnl_today    NUMERIC NOT NULL DEFAULT 0,
  trades_today       INTEGER NOT NULL DEFAULT 0,
  trading_enabled    BOOLEAN NOT NULL DEFAULT true,
  trading_paused_reason TEXT,
  
  -- Adaptive settings
  min_confidence_threshold NUMERIC NOT NULL DEFAULT 0.55,
  
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 3. PERPETUAL_MOCK_TRADES — individual perpetual futures paper trades
CREATE TABLE IF NOT EXISTS perpetual_mock_trades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID REFERENCES perpetual_mock_accounts(id) ON DELETE CASCADE,
  signal_id       UUID REFERENCES signals(id) ON DELETE SET NULL,
  signal_memory_id UUID REFERENCES signal_memory(id) ON DELETE SET NULL,
  
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('LONG','SHORT')),
  
  -- Entry
  entry_price     NUMERIC NOT NULL,
  entry_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Position sizing
  position_size_usd NUMERIC NOT NULL,    -- notional size in USD
  margin_used     NUMERIC NOT NULL,       -- actual margin locked
  leverage        NUMERIC NOT NULL,
  
  -- Risk management
  stop_loss       NUMERIC,
  take_profit     NUMERIC,
  risk_reward     NUMERIC,
  risk_pct        NUMERIC,                -- % of equity risked
  
  -- Exit
  exit_price      NUMERIC,
  exit_at         TIMESTAMPTZ,
  exit_reason     TEXT CHECK (exit_reason IN ('sl','tp','manual','expired','adaptive_close')),
  
  -- PnL
  pnl_usd         NUMERIC,
  pnl_pct         NUMERIC,                -- % return on margin
  funding_paid    NUMERIC DEFAULT 0,      -- simulated funding fees
  
  -- Signal source info
  strategy        TEXT,
  confidence      NUMERIC,
  timeframe       TEXT,
  
  -- Decision explanation
  entry_reason    TEXT,
  exit_reason_detail TEXT,
  
  -- ML features at entry (for learning)
  entry_features  JSONB DEFAULT '{}',
  
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perp_trades_account ON perpetual_mock_trades(account_id, status);
CREATE INDEX IF NOT EXISTS idx_perp_trades_symbol ON perpetual_mock_trades(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_perp_trades_signal ON perpetual_mock_trades(signal_id);

-- 4. STRATEGY_PERFORMANCE — aggregated performance per strategy for adaptive behavior
CREATE TABLE IF NOT EXISTS strategy_performance (
  id              BIGSERIAL PRIMARY KEY,
  strategy        TEXT NOT NULL,
  symbol          TEXT,
  timeframe       TEXT,
  side            TEXT,
  
  total_trades    INTEGER NOT NULL DEFAULT 0,
  wins            INTEGER NOT NULL DEFAULT 0,
  losses          INTEGER NOT NULL DEFAULT 0,
  win_rate        NUMERIC,
  total_pnl       NUMERIC NOT NULL DEFAULT 0,
  avg_pnl         NUMERIC,
  best_trade      NUMERIC,
  worst_trade     NUMERIC,
  avg_hold_time_hours NUMERIC,
  
  -- Adaptive weights
  confidence_weight NUMERIC DEFAULT 1.0,
  size_multiplier   NUMERIC DEFAULT 1.0,
  
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(strategy, symbol, timeframe, side)
);

CREATE INDEX IF NOT EXISTS idx_strat_perf_strategy ON strategy_performance(strategy, win_rate DESC);

-- 5. PERPETUAL_TRADER_LOGS — decision audit trail
CREATE TABLE IF NOT EXISTS perpetual_trader_logs (
  id          BIGSERIAL PRIMARY KEY,
  account_id  UUID REFERENCES perpetual_mock_accounts(id) ON DELETE CASCADE,
  trade_id    UUID REFERENCES perpetual_mock_trades(id) ON DELETE CASCADE,
  level       TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  category    TEXT NOT NULL CHECK (category IN ('entry','exit','risk','adaptive','signal_skip','system')),
  message     TEXT NOT NULL,
  details     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trader_logs_account ON perpetual_trader_logs(account_id, created_at DESC);

-- Seed the perpetual mock account with $100,000
INSERT INTO perpetual_mock_accounts (name, starting_balance, current_balance, available_balance, peak_balance, equity)
VALUES ('Perpetual Signal Trader', 100000, 100000, 100000, 100000, 100000)
ON CONFLICT (name) DO NOTHING;
