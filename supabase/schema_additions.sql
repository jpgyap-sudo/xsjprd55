-- ============================================================
-- Self-Improving Bot — Schema Additions
-- Pattern Learning | App Suggestions | Data Source Registry | Learning Feedback
-- Run in Supabase SQL Editor
-- ============================================================

-- ── signal_patterns ─────────────────────────────────────────
-- Extracted features from every signal at generation time for ML-style analysis
CREATE TABLE IF NOT EXISTS signal_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_id UUID REFERENCES signals(id) ON DELETE CASCADE,

  -- Signal metadata
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('LONG','SHORT','CLOSE')),
  strategy TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL,
  source TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,

  -- Market snapshot at signal time
  market_price NUMERIC(18,8),
  market_change_24h NUMERIC(8,4),
  market_volume_24h NUMERIC(24,4),
  market_rsi_14 NUMERIC(6,2),
  market_ema_9 NUMERIC(18,8),
  market_ema_21 NUMERIC(18,8),
  market_vol_spike NUMERIC(6,2),

  -- Liquidation snapshot at signal time
  liq_funding_annualized NUMERIC(8,4),
  liq_open_interest_usd NUMERIC(24,2),
  liq_risk_score INTEGER CHECK (liq_risk_score BETWEEN 0 AND 100),

  -- News snapshot at signal time
  news_sentiment_score NUMERIC(4,3),
  news_count_1h INTEGER DEFAULT 0,
  news_bullish_count INTEGER DEFAULT 0,
  news_bearish_count INTEGER DEFAULT 0,

  -- Global market snapshot
  global_btc_dominance NUMERIC(6,2),
  global_fear_greed NUMERIC(6,2),
  global_total_mcap_usd NUMERIC(24,2),

  -- Outcome (filled later when trade closes or signal expires)
  outcome TEXT CHECK (outcome IN ('win','loss','breakeven','expired','pending')),
  outcome_pnl NUMERIC(12,4),
  outcome_reached_tp BOOLEAN DEFAULT FALSE,
  outcome_reached_sl BOOLEAN DEFAULT FALSE,
  outcome_duration_minutes INTEGER,
  outcome_filled_at TIMESTAMPTZ,

  -- Feature vector (JSONB for extensibility)
  feature_vector JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_patterns_symbol ON signal_patterns(symbol);
CREATE INDEX IF NOT EXISTS idx_signal_patterns_strategy ON signal_patterns(strategy);
CREATE INDEX IF NOT EXISTS idx_signal_patterns_outcome ON signal_patterns(outcome) WHERE outcome IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_patterns_generated ON signal_patterns(generated_at);
CREATE INDEX IF NOT EXISTS idx_signal_patterns_feature ON signal_patterns USING GIN(feature_vector);

-- ── app_suggestions ─────────────────────────────────────────
-- Bot-generated improvement suggestions with user voting and status workflow
CREATE TABLE IF NOT EXISTS app_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  category TEXT NOT NULL CHECK (category IN (
    'new_api', 'new_strategy', 'strategy_tweak', 'new_data_source',
    'ui_improvement', 'risk_adjustment', 'tool_discovery', 'correction'
  )),

  title TEXT NOT NULL,
  description TEXT NOT NULL,
  rationale TEXT NOT NULL,
  expected_impact TEXT,
  implementation_hint TEXT,
  suggested_config JSONB DEFAULT '{}',
  evidence JSONB DEFAULT '{}',

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','under_review','approved','rejected','implemented','deferred')),

  user_vote INTEGER DEFAULT 0 CHECK (user_vote BETWEEN -1 AND 1),
  user_notes TEXT,
  admin_notes TEXT,

  generated_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  implemented_at TIMESTAMPTZ,
  reviewed_by TEXT,

  source_module TEXT NOT NULL,
  source_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_suggestions_status ON app_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_app_suggestions_category ON app_suggestions(category);
CREATE INDEX IF NOT EXISTS idx_app_suggestions_generated ON app_suggestions(generated_at);

-- ── data_source_registry ────────────────────────────────────
-- Registry of all connected APIs, exchanges, news sources
CREATE TABLE IF NOT EXISTS data_source_registry (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'exchange_rest', 'exchange_ws', 'news_rss', 'news_api',
    'onchain', 'social', 'sentiment', 'macro', 'custom'
  )),

  base_url TEXT,
  api_endpoint TEXT,
  auth_type TEXT CHECK (auth_type IN ('none','api_key','bearer','oauth','webhook_secret')),
  config JSONB DEFAULT '{}',

  provides JSONB DEFAULT '[]',
  supported_symbols JSONB DEFAULT '[]',
  rate_limit JSONB DEFAULT '{}',

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','degraded','down','disabled','experimental')),
  last_success_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,
  avg_latency_ms INTEGER,
  reliability_score NUMERIC(4,3) DEFAULT 1.0,

  requests_count INTEGER DEFAULT 0,
  signals_contributed INTEGER DEFAULT 0,

  discovered_by TEXT DEFAULT 'manual',
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  docs_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_source_type ON data_source_registry(type);
CREATE INDEX IF NOT EXISTS idx_data_source_status ON data_source_registry(status);
CREATE INDEX IF NOT EXISTS idx_data_source_provides ON data_source_registry USING GIN(provides);

-- ── learning_feedback_log ───────────────────────────────────
-- Audit trail of every learning event
CREATE TABLE IF NOT EXISTS learning_feedback_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  event_type TEXT NOT NULL CHECK (event_type IN (
    'pattern_extracted', 'outcome_recorded', 'suggestion_generated',
    'suggestion_reviewed', 'config_updated', 'new_source_discovered',
    'strategy_backtested', 'model_retrained'
  )),

  signal_id UUID REFERENCES signals(id) ON DELETE SET NULL,
  suggestion_id UUID REFERENCES app_suggestions(id) ON DELETE SET NULL,
  source_id UUID REFERENCES data_source_registry(id) ON DELETE SET NULL,

  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_event_type ON learning_feedback_log(event_type);
CREATE INDEX IF NOT EXISTS idx_learning_created ON learning_feedback_log(created_at DESC);

-- ── strategy_performance ────────────────────────────────────
-- Rolling performance windows by strategy
CREATE TABLE IF NOT EXISTS strategy_performance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  strategy TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  symbol TEXT,
  market_regime TEXT, -- 'bull', 'bear', 'ranging', 'volatile'

  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,

  signals_count INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  breakevens INTEGER DEFAULT 0,
  expired INTEGER DEFAULT 0,

  win_rate NUMERIC(5,4),
  avg_pnl NUMERIC(12,4),
  total_pnl NUMERIC(12,4),
  max_drawdown NUMERIC(12,4),
  sharpe_ratio NUMERIC(6,4),

  avg_confidence NUMERIC(4,3),
  avg_duration_minutes INTEGER,

  feature_summary JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(strategy, timeframe, symbol, market_regime, window_start)
);

CREATE INDEX IF NOT EXISTS idx_strat_perf_strategy ON strategy_performance(strategy);
CREATE INDEX IF NOT EXISTS idx_strat_perf_window ON strategy_performance(window_start DESC);

-- Seed default data sources
INSERT INTO data_source_registry (name, display_name, type, provides, status, discovered_by, notes)
VALUES
  ('binance_spot', 'Binance Spot', 'exchange_rest', '["price","volume","ohlcv"]', 'active', 'manual', 'Primary price/volume source'),
  ('binance_futures', 'Binance Futures', 'exchange_rest', '["price","volume","ohlcv","funding","oi"]', 'active', 'manual', 'Futures data for funding + OI'),
  ('okx_perp', 'OKX Perpetual', 'exchange_rest', '["price","funding","oi"]', 'active', 'manual', 'Funding rate comparison'),
  ('coingecko', 'CoinGecko', 'exchange_rest', '["price","market_cap","volume","dominance"]', 'active', 'manual', 'Global market metrics'),
  ('cointelegraph', 'CoinTelegraph', 'news_rss', '["news"]', 'active', 'manual', 'Crypto news feed'),
  ('cryptopanic', 'CryptoPanic', 'news_api', '["news","sentiment"]', 'active', 'manual', 'News aggregator with sentiment'),
  ('telegram_bot', 'Telegram Bot API', 'custom', '["delivery","commands"]', 'active', 'manual', 'Signal delivery channel')
ON CONFLICT (name) DO NOTHING;
