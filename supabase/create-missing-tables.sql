-- ============================================================
-- Create Missing Trading Tables — Safe to re-run (IF NOT EXISTS)
-- Run this in Supabase SQL Editor to fix "mock_trades does not exist"
-- 2026-04-29
-- ============================================================

-- 1. SIGNAL_LOGS (needed by signal_feature_scores FK)
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

-- 2. SIGNAL_FEATURE_SCORES (mock-trading-worker reads from this)
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

-- 3. MOCK_ACCOUNTS (paper trading balance tracking)
CREATE TABLE IF NOT EXISTS mock_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT UNIQUE NOT NULL DEFAULT 'AI Mock Account',
  starting_balance  NUMERIC DEFAULT 1000000,
  current_balance   NUMERIC DEFAULT 1000000,
  peak_balance      NUMERIC DEFAULT 1000000,
  realized_pnl      NUMERIC DEFAULT 0,
  unrealized_pnl    NUMERIC DEFAULT 0,
  max_drawdown      NUMERIC DEFAULT 0,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 4. MOCK_TRADES (open/closed paper trades)
CREATE TABLE IF NOT EXISTS mock_trades (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID REFERENCES mock_accounts(id),
  signal_id           UUID REFERENCES signals(id) ON DELETE SET NULL,
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
  trailing_stop_pct   NUMERIC DEFAULT 0.35,
  highest_price       NUMERIC,
  lowest_price        NUMERIC,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  closed_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mock_trades_account ON mock_trades(account_id, status);
CREATE INDEX IF NOT EXISTS idx_mock_trades_signal ON mock_trades(signal_id);

-- 5. BACKTEST_RUNS
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

-- 6. BACKTEST_TRADES
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

-- 7. STRATEGY_FEATURE_PERFORMANCE
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

-- 8. APP_IMPROVEMENT_SUGGESTIONS
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

-- 9. EXTERNAL_DATA_SNAPSHOTS
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

-- 10. EXECUTION_PROFILES (used by execution engine v3)
CREATE TABLE IF NOT EXISTS execution_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          TEXT NOT NULL UNIQUE,
  base_leverage   NUMERIC DEFAULT 3,
  win_rate        NUMERIC DEFAULT 0.5,
  avg_rr          NUMERIC DEFAULT 1.5,
  optimal_sl_pct  NUMERIC DEFAULT 0.6,
  optimal_tp_pct  NUMERIC DEFAULT 1.8,
  total_trades    INT DEFAULT 0,
  wins            INT DEFAULT 0,
  losses          INT DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 11. LOSS_PATTERNS (used by aggressive engine)
CREATE TABLE IF NOT EXISTS loss_patterns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol        TEXT NOT NULL,
  strategy_name TEXT,
  side          TEXT,
  entry_price   NUMERIC,
  exit_price    NUMERIC,
  leverage      NUMERIC,
  pnl           NUMERIC,
  loss_reason   TEXT,
  market_context JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 12. DATA_SOURCE_HEALTH
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

-- 13. SYSTEM_NOTIFICATIONS
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

-- 14. LIQUIDATION_HEATMAPS
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

-- 15. OPEN_INTEREST_SNAPSHOTS
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

-- 16. ANALYSIS_RESULTS
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

-- 17. PRODUCT_FEATURES (feature inventory + health tracking)
CREATE TABLE IF NOT EXISTS product_features (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id        TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT DEFAULT 'General',
  description       TEXT,
  status            TEXT DEFAULT 'Needs Check',
  priority          TEXT DEFAULT 'Medium',
  last_checked      TIMESTAMPTZ,
  bug_notes         TEXT,
  debugger_status   TEXT DEFAULT 'Not Sent',
  coder_status      TEXT DEFAULT 'Not Sent',
  related_files     TEXT[],
  improvement_proposal TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pf_status ON product_features(status);
CREATE INDEX IF NOT EXISTS idx_pf_category ON product_features(category);
CREATE INDEX IF NOT EXISTS idx_pf_priority ON product_features(priority);

CREATE OR REPLACE FUNCTION update_product_features_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_features_updated_at ON product_features;
CREATE TRIGGER trg_product_features_updated_at
BEFORE UPDATE ON product_features
FOR EACH ROW
EXECUTE FUNCTION update_product_features_updated_at();

-- Seed: Initial feature inventory
INSERT INTO product_features (feature_id, name, category, description, status, priority, related_files, improvement_proposal)
VALUES
  ('FEAT-001', 'Trading Signal Engine', 'Signal', 'Generates LONG/SHORT signals via EMA cross, RSI bounce, and momentum strategies', 'Working', 'Critical', ARRAY['api/signals.js', 'lib/signal-engine.js'], 'Add MACD and Bollinger Band strategies'),
  ('FEAT-002', 'Research Agent', 'Research', 'AI-driven strategy proposals, backtests, and pattern learning', 'Working', 'High', ARRAY['api/research-agent.js', 'lib/learning-loop.js'], 'Add sentiment-based strategy generation'),
  ('FEAT-003', 'Mock Trader (Aggressive)', 'Mock Trader', 'Opens paper trades with fixed leverage and basic SL/TP', 'Working', 'High', ARRAY['lib/mock-trading/mock-account-engine.js'], 'Add dynamic leverage based on volatility'),
  ('FEAT-004', 'Execution Optimizer v3', 'Mock Trader', 'Advanced signal evaluation with Kelly sizing, trailing stops, and ML/RL confluence', 'Working', 'Critical', ARRAY['lib/mock-trading/execution-engine.js', 'workers/execution-worker.js'], 'Add regime detection for leverage adjustment'),
  ('FEAT-005', 'News Feed & Sentiment', 'News', 'RSS news ingestion with NLP sentiment scoring and urgency detection', 'Working', 'High', ARRAY['api/news-feed.js', 'lib/social-crawler.js'], 'Add on-chain event detection'),
  ('FEAT-006', 'Liquidation Intelligence', 'Signal', 'Analyzes funding rates, OI, and liquidation clusters for contrarian signals', 'Working', 'Medium', ARRAY['api/liquidation.js', 'lib/liquidation-engine.js'], 'Add exchange liquidation heatmap widget'),
  ('FEAT-007', 'Wallet Tracker', 'Wallet Tracker', 'Monitors whale wallet movements and exchange flows', 'Working', 'Medium', ARRAY['api/wallet-tracker.js', 'lib/wallet-tracker.js'], 'Add PnL tracking for tracked wallets'),
  ('FEAT-008', 'API Debugger', 'API', 'Health checks all external APIs (Binance, Bybit, Kimi, Claude, etc.)', 'Working', 'High', ARRAY['api/api-debugger.js', 'workers/api-debugger-worker.js'], 'Add auto-retry with circuit breaker'),
  ('FEAT-009', 'Market Data Ticker', 'API', '24h top movers from Binance with real-time price updates', 'Working', 'Medium', ARRAY['api/binance-ticker.js'], 'Add order book depth visualization'),
  ('FEAT-010', 'Telegram Bot', 'Automation', 'Sends signal alerts, confirmations, and admin notifications via Telegram', 'Working', 'Critical', ARRAY['api/telegram.js', 'lib/telegram.js'], 'Add inline trading buttons for quick actions'),
  ('FEAT-011', 'Dashboard UI', 'Dashboard', 'Main SPA with tabs: Overview, Signals, Research, Mock Trading, Diagnostics, Bugs, etc.', 'Working', 'Critical', ARRAY['public/index.html'], 'Add dark/light theme toggle and mobile optimization'),
  ('FEAT-012', 'Autonomous Coding Workflow', 'Automation', 'Self-directed scanning, bug detection, auto-fix proposals, and deployment', 'Working', 'High', ARRAY['api/debug.js', 'workers/diagnostic-worker.js'], 'Add feature request queue with impact scoring'),
  ('FEAT-013', 'Backtest Engine', 'Research', 'Runs strategy backtests with Sharpe, drawdown, and win-rate metrics', 'Working', 'Medium', ARRAY['api/backtest.js', 'workers/continuous-backtester.js'], 'Add walk-forward optimization'),
  ('FEAT-014', 'ML Prediction Service', 'Signal', 'Python FastAPI service for feature engineering and model inference', 'Working', 'High', ARRAY['ml-service/app/main.py', 'api/ml-predict.js'], 'Add online learning with drift detection'),
  ('FEAT-015', 'RL Agent', 'Mock Trader', 'Reinforcement learning agent for portfolio sizing and trade decisions', 'Working', 'Medium', ARRAY['api/ml-rl.js', 'ml-service/app/rl_agent.py'], 'Add multi-agent ensemble for risk management'),
  ('FEAT-016', 'Catalyst Watch', 'Signal', 'High-impact event detection (ETF approvals, regulatory news, exchange events)', 'Working', 'Medium', ARRAY['api/catalyst.js'], 'Add calendar integration with countdown timers'),
  ('FEAT-017', 'Perpetual Trader', 'Mock Trader', 'Separate paper perpetual futures account with isolated margin simulation', 'Working', 'High', ARRAY['api/perpetual-trader.js', 'lib/perpetual-trader/'], 'Add funding rate arbitrage signals'),
  ('FEAT-018', 'Social Intelligence', 'News', 'Twitter/X sentiment and influencer signal tracking', 'Working', 'Low', ARRAY['api/social-intel.js', 'lib/social-intel-store.js'], 'Add real-time social sentiment alerts'),
  ('FEAT-019', 'App Development Proposals', 'Dashboard', 'Capability proposals, product dev pipeline, and consolidation engine', 'Working', 'Medium', ARRAY['api/app-development-proposals.js', 'lib/advisor/'], 'Add user voting on proposals'),
  ('FEAT-020', 'Bug Fix Pipeline', 'Debugging', 'Automated bug detection, queueing, and auto-fix task creation', 'Working', 'High', ARRAY['api/bug-fix-pipeline.js', 'lib/advisor/bug-fix-pipeline.js'], 'Add regression test after each fix'),
  ('FEAT-021', 'Product Updates Log', 'Dashboard', 'Changelog of all features, fixes, and improvements with search/filter', 'Working', 'Medium', ARRAY['api/product-updates.js'], 'Add RSS feed for product updates'),
  ('FEAT-022', 'Product Features Manager', 'Dashboard', 'Feature inventory with health checks, bug escalation, and improvement proposals', 'In Progress', 'Critical', ARRAY['api/product-features.js', 'public/index.html'], 'Add automated health check scheduler')
ON CONFLICT (feature_id) DO NOTHING;

-- Seed a default mock account so trading can start immediately
INSERT INTO mock_accounts (name, starting_balance, current_balance, peak_balance)
VALUES ('AI Mock Account', 1000000, 1000000, 1000000)
ON CONFLICT (name) DO NOTHING;

-- Seed a default execution profile for common symbols
INSERT INTO execution_profiles (symbol, base_leverage, win_rate, avg_rr, optimal_sl_pct, optimal_tp_pct)
VALUES
  ('BTCUSDT', 5, 0.52, 1.8, 0.5, 1.5),
  ('ETHUSDT', 4, 0.50, 1.6, 0.6, 1.8),
  ('SOLUSDT', 3, 0.48, 1.5, 0.8, 2.0)
ON CONFLICT (symbol) DO NOTHING;

-- 18. DEPLOY_HISTORY (tracks every deploy check vs GitHub)
CREATE TABLE IF NOT EXISTS deploy_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_commit       TEXT,
  github_commit_date  TIMESTAMPTZ,
  vps_commit          TEXT,
  vps_commit_date     TIMESTAMPTZ,
  status              TEXT DEFAULT 'unknown' CHECK (status IN ('synced','behind','failed','unknown','deploying')),
  error_message       TEXT,
  deploy_started_at   TIMESTAMPTZ,
  deploy_finished_at  TIMESTAMPTZ,
  health_check_ok     BOOLEAN,
  pm2_status          JSONB DEFAULT '{}',
  checked_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deploy_checked_at ON deploy_history(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_status ON deploy_history(status);
