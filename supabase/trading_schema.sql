-- ============================================================
-- Trading Signal Bot — Supabase Schema
-- Run this in Supabase SQL Editor (new query)
-- ============================================================

-- 1. SIGNALS — every generated signal broadcast to Telegram
CREATE TABLE IF NOT EXISTS signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('LONG','SHORT','CLOSE')),
  entry_price   NUMERIC,
  stop_loss     NUMERIC,
  take_profit   NUMERIC[],        -- array of TP levels
  confidence    NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  strategy      TEXT NOT NULL,
  timeframe     TEXT NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until   TIMESTAMPTZ,
  source        TEXT NOT NULL DEFAULT 'manual',
  mode          TEXT NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper','live')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled','hit_sl','hit_tp')),
  telegram_msg_id BIGINT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE signals IS 'Every signal broadcast to Telegram';

-- Index for fast lookups by symbol/time
CREATE INDEX IF NOT EXISTS idx_signals_symbol_generated
  ON signals(symbol, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_status
  ON signals(status) WHERE status = 'active';

-- 2. USERS — bot subscribers with risk profiles (must be BEFORE trades FK)
CREATE TABLE IF NOT EXISTS bot_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT UNIQUE NOT NULL,
  username        TEXT,
  first_name      TEXT,
  risk_profile    TEXT DEFAULT 'moderate' CHECK (risk_profile IN ('conservative','moderate','aggressive')),
  max_position_size NUMERIC DEFAULT 100,   -- USD
  daily_loss_limit  NUMERIC DEFAULT 50,    -- USD
  cooldown_minutes  INTEGER DEFAULT 15,
  auto_trade_enabled BOOLEAN DEFAULT false,
  preferred_exchange TEXT DEFAULT 'binance',
  preferred_mode    TEXT DEFAULT 'paper' CHECK (preferred_mode IN ('paper','live')),
  is_admin        BOOLEAN DEFAULT false,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_users_telegram ON bot_users(telegram_user_id);

-- 3. TRADES — paper & live trade executions
CREATE TABLE IF NOT EXISTS trades (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id     UUID REFERENCES signals(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES bot_users(id) ON DELETE SET NULL,
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('LONG','SHORT')),
  mode          TEXT NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper','live')),
  entry_price   NUMERIC NOT NULL,
  exit_price    NUMERIC,
  quantity      NUMERIC,
  stop_loss     NUMERIC,
  take_profit   NUMERIC[],
  pnl           NUMERIC,
  pnl_percent   NUMERIC,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','stopped')),
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  closed_reason TEXT CHECK (closed_reason IN ('sl','tp','manual','expired')),
  exchange      TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Fix for existing tables that were created without user_id or wrong type
ALTER TABLE trades ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES bot_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_symbol  ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_user    ON trades(user_id);

-- 4. AUDIT_LOG — every Telegram message and signal for compliance
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  event_type  TEXT NOT NULL,   -- 'signal_sent','trade_opened','trade_closed','user_cmd','error','system'
  symbol      TEXT,
  user_id     BIGINT,
  details     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_type, created_at DESC);

-- 5. MARKET_DATA — cached OHLCV for quick signal checks
CREATE TABLE IF NOT EXISTS market_data (
  id          BIGSERIAL PRIMARY KEY,
  symbol      TEXT NOT NULL,
  exchange    TEXT NOT NULL DEFAULT 'binance',
  timeframe   TEXT NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL,
  open        NUMERIC,
  high        NUMERIC,
  low         NUMERIC,
  close       NUMERIC,
  volume      NUMERIC,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(symbol, exchange, timeframe, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_market_data_lookup
  ON market_data(symbol, exchange, timeframe, timestamp DESC);

-- 6. EXCHANGE_CREDENTIALS — read-only API keys (user-scoped)
-- IMPORTANT: store ONLY read-only keys here. Never store trade keys.
CREATE TABLE IF NOT EXISTS exchange_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES bot_users(id) ON DELETE CASCADE,
  exchange      TEXT NOT NULL,
  api_key       TEXT NOT NULL,
  api_secret    TEXT NOT NULL,   -- encrypt at application layer before insert
  is_read_only  BOOLEAN DEFAULT true,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security (RLS) — users can only see their own rows
ALTER TABLE bot_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see themselves"
  ON bot_users FOR ALL
  USING (telegram_user_id = current_setting('app.current_telegram_id')::BIGINT);

CREATE POLICY "Users see own trades"
  ON trades FOR ALL
  USING (EXISTS (
    SELECT 1 FROM bot_users u
    WHERE u.id = trades.user_id
      AND u.telegram_user_id = current_setting('app.current_telegram_id')::BIGINT
  ));

CREATE POLICY "Users see own credentials"
  ON exchange_credentials FOR ALL
  USING (EXISTS (
    SELECT 1 FROM bot_users u
    WHERE u.id = exchange_credentials.user_id
      AND u.telegram_user_id = current_setting('app.current_telegram_id')::BIGINT
  ));

-- Admin bypass policy (apply via Supabase dashboard if needed)
-- CREATE POLICY "Admin sees all" ON bot_users FOR ALL USING (is_admin = true);

-- ============================================================
-- NEW TABLES for VPS Advanced Features (v2.1)
-- ============================================================

-- 7. DATA_SOURCE_HEALTH — monitor API/crawler status per source
CREATE TABLE IF NOT EXISTS data_source_health (
  id BIGSERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_type TEXT,
  data_type TEXT,
  api_status TEXT,
  crawler_status TEXT,
  fallback_used BOOLEAN DEFAULT FALSE,
  last_success_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,
  missing_data_types JSONB,
  accuracy_impact TEXT,
  recommended_fix TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_name, data_type)
);

CREATE INDEX IF NOT EXISTS idx_dsh_source ON data_source_health(source_name, data_type);
CREATE INDEX IF NOT EXISTS idx_dsh_error ON data_source_health(last_error_at DESC);

-- 8. SYSTEM_NOTIFICATIONS — alert log for admins
CREATE TABLE IF NOT EXISTS system_notifications (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('info','warning','critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  source_name TEXT,
  data_type TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  sent_to_telegram BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_unsent ON system_notifications(sent_to_telegram, level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_level ON system_notifications(level, created_at DESC);

-- 9. LIQUIDATION_HEATMAPS — liquidation cluster snapshots
CREATE TABLE IF NOT EXISTS liquidation_heatmaps (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  exchange TEXT,
  timeframe TEXT,
  current_price NUMERIC,
  heatmap_data JSONB,
  long_liquidation_levels JSONB,
  short_liquidation_levels JSONB,
  probable_direction TEXT,
  confidence_score NUMERIC,
  data_source TEXT,
  fallback_used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liq_symbol ON liquidation_heatmaps(symbol, created_at DESC);

-- 10. OPEN_INTEREST_SNAPSHOTS — OI, funding, long/short ratio
CREATE TABLE IF NOT EXISTS open_interest_snapshots (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  open_interest NUMERIC,
  open_interest_value NUMERIC,
  funding_rate NUMERIC,
  long_short_ratio NUMERIC,
  data_source TEXT,
  fallback_used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oi_symbol ON open_interest_snapshots(symbol, exchange, created_at DESC);

-- 11. ANALYSIS_RESULTS — full probability scoring output
CREATE TABLE IF NOT EXISTS analysis_results (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  bias TEXT,
  raw_confidence NUMERIC,
  data_reliability_score NUMERIC,
  adjusted_confidence NUMERIC,
  technical_score NUMERIC,
  backtest_score NUMERIC,
  liquidation_score NUMERIC,
  oi_funding_score NUMERIC,
  news_social_score NUMERIC,
  recommendation TEXT,
  risk_warning TEXT,
  explanation JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_symbol ON analysis_results(symbol, created_at DESC);

-- ============================================================
-- Helper function: update updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_bot_users_updated_at ON bot_users;
CREATE TRIGGER update_bot_users_updated_at
  BEFORE UPDATE ON bot_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_exchange_credentials_updated_at ON exchange_credentials;
CREATE TRIGGER update_exchange_credentials_updated_at
  BEFORE UPDATE ON exchange_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Backtesting & Mock Trading Schema
-- ============================================================

-- 12. SIGNAL_LOGS — signals evaluated by backtester
CREATE TABLE IF NOT EXISTS signal_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol        TEXT NOT NULL,
  timeframe     TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('long','short')),
  price         NUMERIC,
  confidence    TEXT,
  probability_correct NUMERIC,
  expected_profit_pct NUMERIC,
  expected_loss_pct   NUMERIC,
  market_condition    TEXT,
  indicators    JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_signal_logs_symbol_time ON signal_logs(symbol, timeframe, created_at DESC);

-- 13. SIGNAL_FEATURE_SCORES — probability breakdown per signal
CREATE TABLE IF NOT EXISTS signal_feature_scores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id             UUID REFERENCES signal_logs(id) ON DELETE CASCADE,
  market_score          NUMERIC,
  liquidation_score     NUMERIC,
  social_score          NUMERIC,
  funding_oi_score      NUMERIC,
  liquidity_score       NUMERIC,
  strategy_history_score NUMERIC,
  final_probability     NUMERIC,
  confidence_level      TEXT,
  score_breakdown       JSONB DEFAULT '{}',
  data_evidence         JSONB DEFAULT '{}',
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- 14. BACKTEST_RUNS — strategy performance summary
CREATE TABLE IF NOT EXISTS backtest_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name    TEXT NOT NULL,
  symbol           TEXT NOT NULL,
  timeframe        TEXT NOT NULL,
  side             TEXT,
  market_condition TEXT,
  start_time       TIMESTAMPTZ,
  end_time         TIMESTAMPTZ,
  total_trades     INT DEFAULT 0,
  win_rate         NUMERIC DEFAULT 0,
  profit_factor    NUMERIC DEFAULT 0,
  max_drawdown     NUMERIC DEFAULT 0,
  avg_pnl          NUMERIC DEFAULT 0,
  best_leverage    NUMERIC,
  best_stop_loss   NUMERIC,
  best_take_profit NUMERIC,
  config           JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 15. BACKTEST_TRADES — individual simulated trades
CREATE TABLE IF NOT EXISTS backtest_trades (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID REFERENCES backtest_runs(id) ON DELETE CASCADE,
  signal_id           UUID REFERENCES signal_logs(id) ON DELETE SET NULL,
  symbol              TEXT NOT NULL,
  side                TEXT NOT NULL CHECK (side IN ('long','short')),
  strategy_name       TEXT,
  entry_price         NUMERIC,
  exit_price          NUMERIC,
  entry_time          TIMESTAMPTZ,
  exit_time           TIMESTAMPTZ,
  leverage            NUMERIC,
  position_size_usd   NUMERIC,
  margin_used         NUMERIC,
  stop_loss           NUMERIC,
  take_profit         NUMERIC,
  pnl_pct             NUMERIC,
  pnl_usd             NUMERIC,
  result              TEXT,
  exit_reason         TEXT,
  probability_at_entry NUMERIC,
  trade_rationale     TEXT,
  outcome_analysis    TEXT,
  lessons             TEXT,
  score_breakdown     JSONB DEFAULT '{}',
  data_evidence       JSONB DEFAULT '{}',
  market_condition    TEXT,
  model_version       TEXT DEFAULT 'v1',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_run ON backtest_trades(run_id);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_symbol ON backtest_trades(symbol, created_at DESC);

-- 16. STRATEGY_FEATURE_PERFORMANCE — leaderboard per feature combo
CREATE TABLE IF NOT EXISTS strategy_feature_performance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name   TEXT NOT NULL,
  symbol          TEXT NOT NULL,
  timeframe       TEXT NOT NULL,
  feature_combo   TEXT NOT NULL,
  sample_size     INT DEFAULT 0,
  win_rate        NUMERIC DEFAULT 0,
  avg_pnl         NUMERIC DEFAULT 0,
  max_drawdown    NUMERIC DEFAULT 0,
  profit_factor   NUMERIC DEFAULT 0,
  confidence      TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(strategy_name, symbol, timeframe, feature_combo)
);

-- 17. MOCK_ACCOUNTS — paper trading balance tracking
CREATE TABLE IF NOT EXISTS mock_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT DEFAULT 'AI Mock Account',
  starting_balance  NUMERIC DEFAULT 1000,
  current_balance   NUMERIC DEFAULT 1000,
  realized_pnl      NUMERIC DEFAULT 0,
  unrealized_pnl    NUMERIC DEFAULT 0,
  max_drawdown      NUMERIC DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 18. MOCK_TRADES — open/closed paper trades
CREATE TABLE IF NOT EXISTS mock_trades (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID REFERENCES mock_accounts(id),
  signal_id           UUID REFERENCES signal_logs(id) ON DELETE SET NULL,
  symbol              TEXT NOT NULL,
  side                TEXT NOT NULL CHECK (side IN ('long','short')),
  strategy_name       TEXT,
  entry_price         NUMERIC,
  exit_price          NUMERIC,
  leverage            NUMERIC,
  position_size_usd   NUMERIC,
  margin_used         NUMERIC,
  stop_loss           NUMERIC,
  take_profit         NUMERIC,
  pnl_pct             NUMERIC,
  pnl_usd             NUMERIC,
  status              TEXT DEFAULT 'open',
  entry_reason        TEXT,
  exit_reason         TEXT,
  probability_at_entry NUMERIC,
  score_breakdown     JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  closed_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mock_trades_account ON mock_trades(account_id, status);

-- 19. APP_IMPROVEMENT_SUGGESTIONS — auto-generated upgrade ideas
CREATE TABLE IF NOT EXISTS app_improvement_suggestions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category                TEXT,
  priority                TEXT,
  title                   TEXT,
  reason                  TEXT,
  expected_accuracy_impact TEXT,
  estimated_cost          TEXT,
  suggested_provider      TEXT,
  status                  TEXT DEFAULT 'pending',
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- 20. EXTERNAL_DATA_SNAPSHOTS — crawler/screenshot evidence
CREATE TABLE IF NOT EXISTS external_data_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source            TEXT NOT NULL,
  symbol            TEXT,
  data_type         TEXT NOT NULL,
  raw_json          JSONB DEFAULT '{}',
  screenshot_url    TEXT,
  extracted_summary TEXT,
  quality_score     NUMERIC,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_external_snapshots_symbol ON external_data_snapshots(symbol, source, created_at DESC);

-- ============================================================
-- Self-Improving Bot Schema (v2.2)
-- Pattern learning, suggestions, data source registry, learning loop
-- ============================================================

-- 21. SIGNAL_PATTERNS — ML feature vectors from every signal at generation time
CREATE TABLE IF NOT EXISTS signal_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES signals(id) ON DELETE CASCADE,

  -- Signal metadata
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('LONG','SHORT','CLOSE')),
  strategy TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  confidence DECIMAL(4,3) NOT NULL,
  source TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,

  -- Market snapshot at signal time
  market_price DECIMAL(18,8),
  market_change_24h DECIMAL(8,4),
  market_volume_24h DECIMAL(24,4),
  market_rsi_14 DECIMAL(6,2),
  market_ema_9 DECIMAL(18,8),
  market_ema_21 DECIMAL(18,8),
  market_vol_spike DECIMAL(6,2),

  -- Liquidation snapshot at signal time
  liq_funding_annualized DECIMAL(8,4),
  liq_open_interest_usd DECIMAL(24,2),
  liq_risk_score INTEGER CHECK (liq_risk_score BETWEEN 0 AND 100),

  -- News snapshot at signal time
  news_sentiment_score DECIMAL(4,3),
  news_count_1h INTEGER DEFAULT 0,
  news_bullish_count INTEGER DEFAULT 0,
  news_bearish_count INTEGER DEFAULT 0,

  -- Global market snapshot
  global_btc_dominance DECIMAL(6,2),
  global_fear_greed DECIMAL(6,2),
  global_total_mcap_usd DECIMAL(24,2),

  -- Outcome (filled later when trade closes or signal expires)
  outcome TEXT CHECK (outcome IN ('win','loss','breakeven','expired','pending')),
  outcome_pnl DECIMAL(12,4),
  outcome_reached_tp BOOLEAN DEFAULT FALSE,
  outcome_reached_sl BOOLEAN DEFAULT FALSE,
  outcome_duration_minutes INTEGER,
  outcome_filled_at TIMESTAMPTZ,

  -- Feature vector (JSONB for extensibility)
  feature_vector JSONB DEFAULT '{}',

  CONSTRAINT fk_signal FOREIGN KEY (signal_id) REFERENCES signals(id)
);

CREATE INDEX IF NOT EXISTS idx_signal_patterns_symbol ON signal_patterns(symbol);
CREATE INDEX IF NOT EXISTS idx_signal_patterns_strategy ON signal_patterns(strategy);
CREATE INDEX IF NOT EXISTS idx_signal_patterns_outcome ON signal_patterns(outcome) WHERE outcome IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signal_patterns_generated ON signal_patterns(generated_at);
CREATE INDEX IF NOT EXISTS idx_signal_patterns_feature ON signal_patterns USING GIN(feature_vector);

-- 22. APP_SUGGESTIONS — bot-generated improvement suggestions
CREATE TABLE IF NOT EXISTS app_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  category TEXT NOT NULL CHECK (category IN (
    'new_api',
    'new_strategy',
    'strategy_tweak',
    'new_data_source',
    'ui_improvement',
    'risk_adjustment',
    'tool_discovery',
    'correction'
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

  generated_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  implemented_at TIMESTAMPTZ,
  reviewed_by TEXT,

  source_module TEXT NOT NULL,
  source_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_suggestions_status ON app_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_app_suggestions_category ON app_suggestions(category);
CREATE INDEX IF NOT EXISTS idx_app_suggestions_generated ON app_suggestions(generated_at);

-- 23. DATA_SOURCE_REGISTRY — registry of connected data sources
CREATE TABLE IF NOT EXISTS data_source_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

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
  reliability_score DECIMAL(4,3) DEFAULT 1.0,

  requests_count INTEGER DEFAULT 0,
  signals_contributed INTEGER DEFAULT 0,

  discovered_by TEXT DEFAULT 'manual',
  discovered_at TIMESTAMPTZ DEFAULT now(),
  docs_url TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_source_type ON data_source_registry(type);
CREATE INDEX IF NOT EXISTS idx_data_source_status ON data_source_registry(status);
CREATE INDEX IF NOT EXISTS idx_data_source_provides ON data_source_registry USING GIN(provides);

-- 24. LEARNING_FEEDBACK_LOG — feedback loop audit trail
CREATE TABLE IF NOT EXISTS learning_feedback_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  event_type TEXT NOT NULL CHECK (event_type IN (
    'pattern_extracted',
    'outcome_recorded',
    'suggestion_generated',
    'suggestion_reviewed',
    'config_updated',
    'new_source_discovered',
    'strategy_backtested',
    'model_retrained'
  )),

  signal_id UUID REFERENCES signals(id) ON DELETE SET NULL,
  suggestion_id UUID REFERENCES app_suggestions(id) ON DELETE SET NULL,
  source_id UUID REFERENCES data_source_registry(id) ON DELETE SET NULL,

  module TEXT NOT NULL,
  data JSONB DEFAULT '{}',

  before_state JSONB,
  after_state JSONB,
  improvement_metric DECIMAL(8,4),

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_feedback_module ON learning_feedback_log(module);
CREATE INDEX IF NOT EXISTS idx_learning_feedback_event ON learning_feedback_log(event_type);
CREATE INDEX IF NOT EXISTS idx_learning_feedback_created ON learning_feedback_log(created_at);

-- 25. STRATEGY_PERFORMANCE — rolling performance by strategy + market condition
CREATE TABLE IF NOT EXISTS strategy_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  strategy TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  symbol TEXT,

  market_regime TEXT CHECK (market_regime IN ('bull','bear','range','volatile','any')),
  btc_dominance_range TEXT,

  total_signals INTEGER DEFAULT 0,
  win_count INTEGER DEFAULT 0,
  loss_count INTEGER DEFAULT 0,
  expired_count INTEGER DEFAULT 0,
  avg_pnl DECIMAL(12,4),
  avg_confidence DECIMAL(4,3),
  win_rate DECIMAL(4,3),
  sharpe_like DECIMAL(6,3),

  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,

  suggested_tweak JSONB,

  UNIQUE(strategy, timeframe, symbol, market_regime, window_start)
);

CREATE INDEX IF NOT EXISTS idx_strategy_perf_strategy ON strategy_performance(strategy);
CREATE INDEX IF NOT EXISTS idx_strategy_perf_window ON strategy_performance(window_start, window_end);
