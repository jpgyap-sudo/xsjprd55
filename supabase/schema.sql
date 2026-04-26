-- ============================================================
-- Trading Signal Bot — Database Schema + RLS
-- Run this in the Supabase SQL Editor for your xsjprd55 project
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── signals ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('LONG','SHORT','CLOSE')),
  entry_price     NUMERIC,
  stop_loss       NUMERIC,
  take_profit     NUMERIC[] DEFAULT '{}',
  confidence      NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  strategy        TEXT NOT NULL DEFAULT 'Unknown',
  timeframe       TEXT NOT NULL DEFAULT '1h',
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until     TIMESTAMPTZ,
  source          TEXT NOT NULL DEFAULT 'unknown',
  mode            TEXT NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper','live')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','confirmed','dismissed','expired')),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_symbol_side_status ON signals(symbol, side, status);
CREATE INDEX IF NOT EXISTS idx_signals_generated_at ON signals(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_strategy ON signals(strategy);

-- ── trades ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trades (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_id       UUID REFERENCES signals(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES bot_users(id) ON DELETE SET NULL,
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('LONG','SHORT')),
  entry_price     NUMERIC NOT NULL,
  quantity        NUMERIC,
  stop_loss       NUMERIC,
  take_profit     NUMERIC[] DEFAULT '{}',
  mode            TEXT NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper','live')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  closed_reason   TEXT,
  pnl             NUMERIC DEFAULT 0,
  pnl_percent     NUMERIC DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_symbol_status ON trades(symbol, status);
CREATE INDEX IF NOT EXISTS idx_trades_opened_at ON trades(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_mode ON trades(mode);

-- ── bot_users ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  telegram_user_id TEXT UNIQUE,
  username        TEXT,
  risk_profile    JSONB DEFAULT '{}',
  max_position_size_usd NUMERIC DEFAULT 100,
  daily_loss_limit_usd  NUMERIC DEFAULT 50,
  cooldown_minutes      NUMERIC DEFAULT 15,
  auto_trade_enabled    BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_users_telegram ON bot_users(telegram_user_id);

-- ── audit_log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type      TEXT NOT NULL,
  symbol          TEXT,
  user_id         TEXT,
  details         JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- ── market_data ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_data (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol          TEXT NOT NULL,
  exchange        TEXT NOT NULL,
  timeframe       TEXT NOT NULL,
  timestamp       TIMESTAMPTZ NOT NULL,
  open            NUMERIC,
  high            NUMERIC,
  low             NUMERIC,
  close           NUMERIC,
  volume          NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, exchange, timeframe, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_market_symbol_tf ON market_data(symbol, timeframe, timestamp DESC);

-- ── exchange_credentials ────────────────────────────────────
CREATE TABLE IF NOT EXISTS exchange_credentials (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES bot_users(id) ON DELETE CASCADE,
  exchange        TEXT NOT NULL,
  api_key         TEXT NOT NULL,
  api_secret      TEXT NOT NULL,
  passphrase      TEXT,
  is_read_only    BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exch_cred_user ON exchange_credentials(user_id);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE bot_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_credentials ENABLE ROW LEVEL SECURITY;

-- bot_users: users can read/update their own row; service role can do everything
CREATE POLICY bot_users_self_select ON bot_users FOR SELECT USING (
  telegram_user_id = current_setting('app.current_telegram_user_id', true)
);
CREATE POLICY bot_users_self_update ON bot_users FOR UPDATE USING (
  telegram_user_id = current_setting('app.current_telegram_user_id', true)
);

-- trades: users can see their own trades only
CREATE POLICY trades_self_select ON trades FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM bot_users WHERE bot_users.id = trades.user_id
    AND bot_users.telegram_user_id = current_setting('app.current_telegram_user_id', true)
  )
);

-- exchange_credentials: users can manage their own credentials
CREATE POLICY exch_cred_self_all ON exchange_credentials FOR ALL USING (
  EXISTS (
    SELECT 1 FROM bot_users WHERE bot_users.id = exchange_credentials.user_id
    AND bot_users.telegram_user_id = current_setting('app.current_telegram_user_id', true)
  )
);
