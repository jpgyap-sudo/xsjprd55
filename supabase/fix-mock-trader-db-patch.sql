-- ============================================================
-- Mock Trader DB Patch — Run in Supabase SQL Editor
-- Fixes schema mismatches discovered during autonomous debugging
-- 2026-04-29
-- ============================================================

-- 1. Ensure mock_accounts has correct columns and constraints
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS peak_balance NUMERIC DEFAULT 1000000;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE mock_accounts ALTER COLUMN name SET NOT NULL;

-- Create unique index on name if not exists (safer than CONSTRAINT for existing data)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_mock_accounts_name_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_mock_accounts_name_unique ON mock_accounts(name);
  END IF;
END $$;

-- 2. Fix existing mock account balances (if seeded with wrong values)
UPDATE mock_accounts
SET starting_balance = 1000000,
    current_balance = GREATEST(current_balance, 1000000),
    peak_balance = GREATEST(peak_balance, 1000000)
WHERE starting_balance < 1000000 OR starting_balance IS NULL;

-- 3. Seed default accounts if missing
INSERT INTO mock_accounts (name, starting_balance, current_balance, peak_balance, metadata)
VALUES
  ('AI Mock Account', 1000000, 1000000, 1000000, '{"auto_seeded":true}'),
  ('Execution Optimizer v3', 1000000, 1000000, 1000000, '{"auto_seeded":true}')
ON CONFLICT (name) DO NOTHING;

-- 4. Seed execution profiles for common symbols
INSERT INTO execution_profiles (symbol, base_leverage, win_rate, avg_rr, optimal_sl_pct, optimal_tp_pct)
VALUES
  ('BTCUSDT', 5, 0.52, 1.8, 0.5, 1.5),
  ('ETHUSDT', 4, 0.50, 1.6, 0.6, 1.8),
  ('SOLUSDT', 3, 0.48, 1.5, 0.8, 2.0)
ON CONFLICT (symbol) DO NOTHING;

-- 5. Verify mock_trades FK points to signals (not signal_logs)
-- If you get FK errors, run this to check:
-- SELECT conname, confrelid::regclass AS references_table
-- FROM pg_constraint WHERE conrelid = 'mock_trades'::regclass AND contype = 'f';

-- 6. Add missing columns to mock_trades if needed
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS trailing_stop_pct NUMERIC DEFAULT 0.35;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS highest_price NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS lowest_price NUMERIC;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS score_breakdown JSONB DEFAULT '{}';
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS entry_reason TEXT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS exit_reason TEXT;
ALTER TABLE mock_trades ADD COLUMN IF NOT EXISTS probability_at_entry NUMERIC;

-- 7. Clean up any broken trades from previous NaN entry_price bug
DELETE FROM mock_trades WHERE entry_price IS NULL OR entry_price = 0;

-- 8. Verify results
SELECT 'mock_accounts count' AS check_name, COUNT(*)::text AS result FROM mock_accounts
UNION ALL
SELECT 'mock_trades open count', COUNT(*)::text FROM mock_trades WHERE status = 'open'
UNION ALL
SELECT 'signals active count', COUNT(*)::text FROM signals WHERE status = 'active'
UNION ALL
SELECT 'execution_profiles count', COUNT(*)::text FROM execution_profiles;
