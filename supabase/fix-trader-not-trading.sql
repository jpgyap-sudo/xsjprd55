-- ============================================================
-- CRITICAL FIX: Trader Not Trading - Comprehensive DB Patch
-- Run this in Supabase SQL Editor to fix all trading issues
-- 2026-04-30
-- ============================================================

-- 1. Ensure execution_profiles table exists (CRITICAL - execution-engine.js requires this)
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

CREATE INDEX IF NOT EXISTS idx_exec_profiles_symbol ON execution_profiles(symbol);

-- 2. Seed execution profiles for top symbols
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

-- 3. Fix mock_trades side constraint to accept both cases
-- First check current constraint
DO $$
BEGIN
  -- Drop the old lowercase-only constraint if it exists
  ALTER TABLE mock_trades DROP CONSTRAINT IF EXISTS mock_trades_side_check;
  
  -- Add new constraint that accepts both cases
  ALTER TABLE mock_trades ADD CONSTRAINT mock_trades_side_check 
    CHECK (side IN ('long', 'short', 'LONG', 'SHORT'));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Constraint update issue: %', SQLERRM;
END $$;

-- 4. Ensure all required columns exist in mock_trades
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

-- 5. Add exit_at column if not exists (code uses both exit_at and closed_at)
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS exit_at TIMESTAMPTZ;

-- 6. Create trigger to sync exit_at with closed_at
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

-- 7. Fix mock_accounts columns
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'AI Mock Account';
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS starting_balance NUMERIC DEFAULT 1000000;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS current_balance NUMERIC DEFAULT 1000000;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS peak_balance NUMERIC DEFAULT 1000000;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC DEFAULT 0;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS unrealized_pnl NUMERIC DEFAULT 0;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS max_drawdown NUMERIC DEFAULT 0;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 8. Ensure unique name constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_mock_accounts_name_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_mock_accounts_name_unique ON mock_accounts(name);
  END IF;
END $$;

-- 9. Seed default mock accounts
INSERT INTO mock_accounts (name, starting_balance, current_balance, peak_balance, metadata)
VALUES
  ('AI Mock Account', 1000000, 1000000, 1000000, '{"version": "v3", "auto_seeded": true}'),
  ('Execution Optimizer v3', 1000000, 1000000, 1000000, '{"version": "v3", "auto_seeded": true}'),
  ('Aggressive AI Trader', 1000000, 1000000, 1000000, '{"version": "v3", "auto_seeded": true}')
ON CONFLICT (name) DO NOTHING;

-- 10. Clean up invalid trades
DELETE FROM mock_trades WHERE entry_price IS NULL OR entry_price = 0 OR entry_price != entry_price;
DELETE FROM mock_trades WHERE symbol IS NULL OR symbol = '';

-- 11. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_mock_trades_status ON mock_trades(status);
CREATE INDEX IF NOT EXISTS idx_mock_trades_symbol_status ON mock_trades(symbol, status);
CREATE INDEX IF NOT EXISTS idx_mock_trades_account_status ON mock_trades(account_id, status);
CREATE INDEX IF NOT EXISTS idx_mock_trades_signal ON mock_trades(signal_id);
CREATE INDEX IF NOT EXISTS idx_mock_trades_created ON mock_trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mock_trades_closed ON mock_trades(closed_at DESC);

-- 12. Verify results
SELECT '=== TRADER FIX VERIFICATION ===' AS section;
SELECT 'mock_accounts count' AS check_name, COUNT(*)::text AS result FROM mock_accounts
UNION ALL
SELECT 'mock_trades open count', COUNT(*)::text FROM mock_trades WHERE status = 'open'
UNION ALL
SELECT 'mock_trades closed count', COUNT(*)::text FROM mock_trades WHERE status = 'closed'
UNION ALL
SELECT 'signals active count', COUNT(*)::text FROM signals WHERE status = 'active'
UNION ALL
SELECT 'execution_profiles count', COUNT(*)::text FROM execution_profiles
UNION ALL
SELECT 'mock_accounts seeded', string_agg(name, ', ') FROM mock_accounts;
