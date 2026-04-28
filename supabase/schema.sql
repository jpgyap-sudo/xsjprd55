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

-- ── trades ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trades (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_id       UUID,
  user_id         UUID,
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
  user_id         UUID,
  exchange        TEXT NOT NULL,
  api_key         TEXT NOT NULL,
  api_secret      TEXT NOT NULL,
  passphrase      TEXT,
  is_read_only    BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exch_cred_user ON exchange_credentials(user_id);

-- ── Add foreign keys after all tables exist ─────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_trades_signal'
  ) THEN
    ALTER TABLE trades ADD CONSTRAINT fk_trades_signal
      FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_trades_user'
  ) THEN
    ALTER TABLE trades ADD CONSTRAINT fk_trades_user
      FOREIGN KEY (user_id) REFERENCES bot_users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_exch_cred_user'
  ) THEN
    ALTER TABLE exchange_credentials ADD CONSTRAINT fk_exch_cred_user
      FOREIGN KEY (user_id) REFERENCES bot_users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE bot_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_credentials ENABLE ROW LEVEL SECURITY;

-- bot_users: users can read/update their own row; service role can do everything
DROP POLICY IF EXISTS bot_users_self_select ON bot_users;
CREATE POLICY bot_users_self_select ON bot_users FOR SELECT USING (
  telegram_user_id = current_setting('app.current_telegram_user_id', true)
);

DROP POLICY IF EXISTS bot_users_self_update ON bot_users;
CREATE POLICY bot_users_self_update ON bot_users FOR UPDATE USING (
  telegram_user_id = current_setting('app.current_telegram_user_id', true)
);

-- trades: users can see their own trades only
DROP POLICY IF EXISTS trades_self_select ON trades;
CREATE POLICY trades_self_select ON trades FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM bot_users WHERE bot_users.id = trades.user_id
    AND bot_users.telegram_user_id = current_setting('app.current_telegram_user_id', true)
  )
);

-- exchange_credentials: users can manage their own credentials
DROP POLICY IF EXISTS exch_cred_self_all ON exchange_credentials;
CREATE POLICY exch_cred_self_all ON exchange_credentials FOR ALL USING (
  EXISTS (
    SELECT 1 FROM bot_users WHERE bot_users.id = exchange_credentials.user_id
    AND bot_users.telegram_user_id = current_setting('app.current_telegram_user_id', true)
  )
);
-- ── news_articles ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news_articles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source          TEXT NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT,
  url             TEXT NOT NULL,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sentiment_score NUMERIC,
  impact          TEXT DEFAULT 'neutral' CHECK (impact IN ('bullish','bearish','neutral')),
  detected_assets TEXT[] DEFAULT '{}',
  matched_keywords JSONB DEFAULT '[]',
  weight          NUMERIC DEFAULT 1.0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_impact ON news_articles(impact);
CREATE INDEX IF NOT EXISTS idx_news_assets ON news_articles USING GIN(detected_assets);
CREATE INDEX IF NOT EXISTS idx_news_source ON news_articles(source);

-- ── news_signals (link signals to triggering news) ───────────
CREATE TABLE IF NOT EXISTS news_signals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_id       UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  news_article_ids UUID[] DEFAULT '{}',
  news_sentiment  NUMERIC,
  technical_score NUMERIC,
  price_momentum  NUMERIC,
  win_probability NUMERIC,
  risk_level      TEXT DEFAULT 'LOW' CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_sig_signal ON news_signals(signal_id);

-- ── tracked_wallets ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracked_wallets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address         TEXT NOT NULL UNIQUE,
  label           TEXT,
  chain           TEXT DEFAULT 'hyperliquid',
  quality_score   NUMERIC DEFAULT 0,
  realized_pnl    NUMERIC DEFAULT 0,
  win_rate        NUMERIC DEFAULT 0,
  max_drawdown    NUMERIC DEFAULT 0,
  consistency     NUMERIC DEFAULT 0,
  total_trades    INTEGER DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracked_wallets_active ON tracked_wallets(is_active);
CREATE INDEX IF NOT EXISTS idx_tracked_wallets_score ON tracked_wallets(quality_score DESC);

-- ── wallet_snapshots ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_snapshots (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address         TEXT NOT NULL,
  label           TEXT,
  account_value   NUMERIC DEFAULT 0,
  withdrawable    NUMERIC DEFAULT 0,
  margin_used     NUMERIC DEFAULT 0,
  raw_snapshot    JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_snap_address ON wallet_snapshots(address);
CREATE INDEX IF NOT EXISTS idx_wallet_snap_created ON wallet_snapshots(created_at DESC);

-- ── agent_improvement_ideas ─────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_improvement_ideas (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_bot          TEXT NOT NULL CHECK (source_bot IN (
    'Coding Bot','Application Bot','Trading Signal Bot',
    'Mock Trading Bot','Backtesting Bot','Wallet Tracker Bot'
  )),
  idea_type           TEXT NOT NULL CHECK (idea_type IN (
    'Bug Fix','Feature Upgrade','Strategy Improvement',
    'Risk Management','Data Source Improvement','UI/UX Improvement',
    'Performance Improvement','Automation Idea','Cost Optimization',
    'Security Improvement','Tech Stack Upgrade'
  )),
  feature_affected    TEXT NOT NULL,
  observation         TEXT NOT NULL,
  recommendation      TEXT NOT NULL,
  expected_benefit    TEXT,
  priority            TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Critical','High','Medium','Low','Optional')),
  confidence          TEXT NOT NULL DEFAULT 'Medium' CHECK (confidence IN ('High','Medium','Low','Needs Testing')),
  status              TEXT NOT NULL DEFAULT 'New' CHECK (status IN (
    'New','Under Review','Approved','Rejected','In Progress',
    'Completed','Needs Backtest','Needs Human Decision'
  )),
  related_trade_id    UUID,
  related_backtest_id UUID,
  related_wallet      TEXT,
  related_error_id    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_ideas_status ON agent_improvement_ideas(status);
CREATE INDEX IF NOT EXISTS idx_agent_ideas_bot ON agent_improvement_ideas(source_bot);
CREATE INDEX IF NOT EXISTS idx_agent_ideas_priority ON agent_improvement_ideas(priority);
CREATE INDEX IF NOT EXISTS idx_agent_ideas_created ON agent_improvement_ideas(created_at DESC);

-- ── social_sentiment ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_sentiment (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source          TEXT NOT NULL,
  sentiment_score NUMERIC DEFAULT 0,
  sentiment_label TEXT DEFAULT 'neutral' CHECK (sentiment_label IN ('bullish','bearish','neutral')),
  raw_data        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_sent_label ON social_sentiment(sentiment_label);
CREATE INDEX IF NOT EXISTS idx_social_sent_created ON social_sentiment(created_at DESC);

-- ── market_trends ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_trends (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol          TEXT NOT NULL,
  source          TEXT NOT NULL,
  price           NUMERIC,
  change_24h      NUMERIC,
  volume_approx   TEXT,
  raw             JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trends_symbol ON market_trends(symbol);
CREATE INDEX IF NOT EXISTS idx_trends_source ON market_trends(source);
CREATE INDEX IF NOT EXISTS idx_trends_created ON market_trends(created_at DESC);

-- RLS for agent_improvement_ideas (service role can do everything; read-only for anon)
ALTER TABLE agent_improvement_ideas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_ideas_select_all ON agent_improvement_ideas;
CREATE POLICY agent_ideas_select_all ON agent_improvement_ideas FOR SELECT USING (true);
