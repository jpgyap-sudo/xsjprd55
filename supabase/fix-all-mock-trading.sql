-- ============================================================
-- COMPREHENSIVE FIX: All Mock Trading Tables + Columns + Seeds
-- Run this in Supabase SQL Editor for your xsjprd55 project
-- 2026-05-02
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ════════════════════════════════════════════════════════════
-- PHASE 1: Create base tables (no-op if they already exist)
-- ════════════════════════════════════════════════════════════

-- ── 1. mock_accounts ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS mock_accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL DEFAULT 'AI Mock Account',
  starting_balance NUMERIC DEFAULT 1000000,
  current_balance  NUMERIC DEFAULT 1000000,
  peak_balance     NUMERIC DEFAULT 1000000,
  realized_pnl     NUMERIC DEFAULT 0,
  unrealized_pnl   NUMERIC DEFAULT 0,
  max_drawdown     NUMERIC DEFAULT 0,
  metadata         JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. mock_trades ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mock_trades (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID REFERENCES mock_accounts(id) ON DELETE SET NULL,
  signal_id       UUID REFERENCES signals(id) ON DELETE SET NULL,
  symbol          TEXT NOT NULL,
  side            TEXT CHECK (side IN ('long','short','LONG','SHORT')),
  strategy_name   TEXT,
  entry_price     NUMERIC,
  exit_price      NUMERIC,
  leverage        NUMERIC DEFAULT 1,
  position_size_usd NUMERIC,
  margin_used     NUMERIC,
  stop_loss       NUMERIC,
  take_profit     NUMERIC,
  pnl_pct         NUMERIC,
  pnl_usd         NUMERIC,
  status          TEXT DEFAULT 'open' CHECK (status IN ('open','closed')),
  entry_reason    TEXT,
  exit_reason     TEXT,
  probability_at_entry NUMERIC,
  score_breakdown JSONB DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  trailing_stop_pct NUMERIC DEFAULT 0.35,
  highest_price   NUMERIC,
  lowest_price    NUMERIC,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  exit_at         TIMESTAMPTZ
);

-- ── 3. execution_profiles ──────────────────────────────────
CREATE TABLE IF NOT EXISTS execution_profiles (
  id              BIGSERIAL PRIMARY KEY,
  symbol          TEXT NOT NULL UNIQUE,
  base_leverage   NUMERIC DEFAULT 3,
  optimal_sl_pct  NUMERIC DEFAULT 0.6,
  optimal_tp_pct  NUMERIC DEFAULT 1.8,
  avg_fill_slippage_bps NUMERIC DEFAULT 5,
  win_rate        NUMERIC DEFAULT 0.5,
  avg_rr          NUMERIC DEFAULT 1.5,
  best_timeframe  TEXT DEFAULT '15m',
  regime          TEXT DEFAULT 'unknown',
  confidence      NUMERIC DEFAULT 0.5,
  total_trades    INTEGER DEFAULT 0,
  total_pnl       NUMERIC DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. loss_patterns ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS loss_patterns (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol          TEXT,
  strategy        TEXT,
  leverage        NUMERIC,
  side            TEXT,
  entry_price     NUMERIC,
  exit_price      NUMERIC,
  pnl_usd         NUMERIC,
  pnl_pct         NUMERIC,
  exit_reason     TEXT,
  score_breakdown JSONB DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. mock_trade_history ──────────────────────────────────
CREATE TABLE IF NOT EXISTS mock_trade_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id        UUID,
  account_id      UUID,
  event           TEXT NOT NULL,
  symbol          TEXT,
  side            TEXT,
  price           NUMERIC,
  pnl_usd         NUMERIC,
  pnl_pct         NUMERIC,
  balance_after   NUMERIC,
  leverage        NUMERIC,
  position_size_usd NUMERIC,
  exit_reason     TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════
-- PHASE 2: Add missing columns to EXISTING tables (idempotent)
-- ════════════════════════════════════════════════════════════

-- mock_accounts columns
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'AI Mock Account';
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS starting_balance NUMERIC DEFAULT 1000000;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS current_balance NUMERIC DEFAULT 1000000;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS peak_balance NUMERIC DEFAULT 1000000;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC DEFAULT 0;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS unrealized_pnl NUMERIC DEFAULT 0;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS max_drawdown NUMERIC DEFAULT 0;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- mock_trades columns
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES mock_accounts(id);
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS signal_id UUID REFERENCES signals(id) ON DELETE SET NULL;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS symbol TEXT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS side TEXT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS strategy_name TEXT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS entry_price NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS exit_price NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS leverage NUMERIC DEFAULT 1;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS position_size_usd NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS margin_used NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS stop_loss NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS take_profit NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS pnl_pct NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS pnl_usd NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open';
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS entry_reason TEXT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS exit_reason TEXT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS probability_at_entry NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS score_breakdown JSONB DEFAULT '{}';
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS trailing_stop_pct NUMERIC DEFAULT 0.35;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS highest_price NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS lowest_price NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS exit_at TIMESTAMPTZ;

-- ════════════════════════════════════════════════════════════
-- PHASE 3: Indexes, constraints, triggers
-- ════════════════════════════════════════════════════════════

-- mock_accounts indexes
CREATE INDEX IF NOT EXISTS idx_mock_accounts_created ON mock_accounts(created_at DESC);

-- mock_trades indexes
CREATE INDEX IF NOT EXISTS idx_mock_trades_status ON mock_trades(status);
CREATE INDEX IF NOT EXISTS idx_mock_trades_symbol_status ON mock_trades(symbol, status);
CREATE INDEX IF NOT EXISTS idx_mock_trades_account_status ON mock_trades(account_id, status);
CREATE INDEX IF NOT EXISTS idx_mock_trades_signal ON mock_trades(signal_id);
CREATE INDEX IF NOT EXISTS idx_mock_trades_created ON mock_trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mock_trades_closed ON mock_trades(closed_at DESC);

-- execution_profiles indexes
CREATE INDEX IF NOT EXISTS idx_exec_profiles_symbol ON execution_profiles(symbol);

-- loss_patterns indexes
CREATE INDEX IF NOT EXISTS idx_loss_patterns_symbol ON loss_patterns(symbol);
CREATE INDEX IF NOT EXISTS idx_loss_patterns_created ON loss_patterns(created_at DESC);

-- mock_trade_history indexes
CREATE INDEX IF NOT EXISTS idx_mock_trade_history_trade ON mock_trade_history(trade_id);
CREATE INDEX IF NOT EXISTS idx_mock_trade_history_account ON mock_trade_history(account_id);
CREATE INDEX IF NOT EXISTS idx_mock_trade_history_created ON mock_trade_history(created_at DESC);

-- Side constraint fix
DO $$
BEGIN
  ALTER TABLE mock_trades DROP CONSTRAINT IF EXISTS mock_trades_side_check;
  ALTER TABLE mock_trades ADD CONSTRAINT mock_trades_side_check
    CHECK (side IN ('long', 'short', 'LONG', 'SHORT'));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Constraint update issue: %', SQLERRM;
END $$;

-- exit_at / closed_at sync trigger
CREATE OR REPLACE FUNCTION sync_exit_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.closed_at IS NOT NULL AND NEW.exit_at IS NULL THEN
    NEW.exit_at = NEW.closed_at;
  ELSIF NEW.exit_at IS NOT NULL AND NEW.closed_at IS NULL THEN
    NEW.closed_at = NEW.exit_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_exit_at_trigger ON mock_trades;
CREATE TRIGGER sync_exit_at_trigger
  BEFORE INSERT OR UPDATE ON mock_trades
  FOR EACH ROW EXECUTE FUNCTION sync_exit_at();

-- ════════════════════════════════════════════════════════════
-- PHASE 4: Deduplicate mock_accounts (FK-safe)
-- ════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- 1. Re-assign trades from duplicate accounts to the newest account per name
  UPDATE mock_trades t
  SET account_id = keepers.id
  FROM (
    SELECT DISTINCT ON (name) id, name
    FROM mock_accounts
    ORDER BY name, created_at DESC NULLS LAST, id DESC
  ) keepers
  WHERE t.account_id IN (
    SELECT dup.id FROM mock_accounts dup
    WHERE dup.name = keepers.name AND dup.id <> keepers.id
  );

  -- 2. Now safely delete duplicate accounts
  DELETE FROM mock_accounts a
  USING mock_accounts b
  WHERE a.id < b.id AND a.name = b.name;

  -- 3. Create unique index
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_mock_accounts_name_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_mock_accounts_name_unique ON mock_accounts(name);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════
-- PHASE 5: Seed data
-- ════════════════════════════════════════════════════════════

-- Seed execution_profiles for top symbols
INSERT INTO execution_profiles (symbol, base_leverage, win_rate, avg_rr, optimal_sl_pct, optimal_tp_pct)
VALUES
  ('BTCUSDT', 5, 0.52, 1.8, 0.5, 1.5),
  ('ETHUSDT', 4, 0.50, 1.6, 0.6, 1.8),
  ('SOLUSDT', 3, 0.48, 1.5, 0.8, 2.0),
  ('BNBUSDT', 3, 0.48, 1.5, 0.8, 2.0),
  ('XRPUSDT', 3, 0.47, 1.4, 0.9, 2.1),
  ('DOGEUSDT', 2, 0.45, 1.3, 1.0, 2.2),
  ('ADAUSDT', 3, 0.48, 1.5, 0.8, 2.0),
  ('AVAXUSDT', 3, 0.47, 1.5, 0.9, 2.1),
  ('LINKUSDT', 3, 0.49, 1.6, 0.7, 1.9),
  ('LTCUSDT', 3, 0.48, 1.5, 0.8, 2.0)
ON CONFLICT (symbol) DO NOTHING;

-- Seed default mock accounts
INSERT INTO mock_accounts (name, starting_balance, current_balance, peak_balance, metadata)
VALUES
  ('AI Mock Account',         1000000, 1000000, 1000000, '{"auto_seeded":true,"version":"v1"}'),
  ('Aggressive AI Trader',    1000000, 1000000, 1000000, '{"auto_seeded":true,"version":"v3_ml"}'),
  ('Execution Optimizer v3',  1000000, 1000000, 1000000, '{"auto_seeded":true,"version":"v3"}')
ON CONFLICT (name) DO NOTHING;

-- ════════════════════════════════════════════════════════════
-- PHASE 6: Cleanup & verification
-- ════════════════════════════════════════════════════════════

DELETE FROM mock_trades WHERE entry_price IS NULL OR entry_price = 0 OR entry_price != entry_price;
DELETE FROM mock_trades WHERE symbol IS NULL OR symbol = '';

SELECT '=== MOCK TRADING FIX VERIFICATION ===' AS section;
SELECT 'mock_accounts count' AS check_name, COUNT(*)::text AS result FROM mock_accounts
UNION ALL
SELECT 'mock_trades open count', COUNT(*)::text FROM mock_trades WHERE status = 'open'
UNION ALL
SELECT 'mock_trades closed count', COUNT(*)::text FROM mock_trades WHERE status = 'closed'
UNION ALL
SELECT 'execution_profiles count', COUNT(*)::text FROM execution_profiles
UNION ALL
SELECT 'loss_patterns count', COUNT(*)::text FROM loss_patterns
UNION ALL
SELECT 'mock_trade_history count', COUNT(*)::text FROM mock_trade_history
UNION ALL
SELECT 'mock_accounts seeded', string_agg(name, ', ') FROM mock_accounts;
