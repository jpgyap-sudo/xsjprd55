-- ============================================================
-- Product Features Schema — Feature inventory + health tracking
-- ============================================================

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

-- Index for fast status filtering
CREATE INDEX IF NOT EXISTS idx_pf_status ON product_features(status);
CREATE INDEX IF NOT EXISTS idx_pf_category ON product_features(category);
CREATE INDEX IF NOT EXISTS idx_pf_priority ON product_features(priority);

-- Trigger to auto-update updated_at
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

-- ============================================================
-- Seed: Initial feature inventory
-- ============================================================
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
