-- ============================================================
-- Fix existing mock trader data after strategy_name bug fix
-- Run this in Supabase SQL Editor after deploying the code fix
-- ============================================================

-- 1. Back-populate strategy_name for existing mock_trades from signals table
UPDATE mock_trades mt
SET strategy_name = s.strategy
FROM signals s
WHERE mt.signal_id = s.id
  AND (mt.strategy_name IS NULL OR mt.strategy_name = '');

-- 2. Update the mock account balance to match env config ($1,000,000)
UPDATE mock_accounts
SET starting_balance = 1000000,
    current_balance = GREATEST(current_balance, 1000000),
    peak_balance = GREATEST(peak_balance, 1000000)
WHERE name = 'AI Mock Account';

-- 3. Normalize side values to lowercase for consistency
UPDATE mock_trades
SET side = LOWER(side)
WHERE side IS NOT NULL AND side != LOWER(side);

-- 4. Show summary of what was fixed
SELECT
  'Fixed strategy_name' AS fix,
  COUNT(*) AS trades_updated
FROM mock_trades
WHERE strategy_name IS NOT NULL
UNION ALL
SELECT
  'Account balance set to $1,000,000' AS fix,
  (SELECT COUNT(*) FROM mock_accounts WHERE starting_balance = 1000000) AS trades_updated
UNION ALL
SELECT
  'Total open trades' AS fix,
  (SELECT COUNT(*) FROM mock_trades WHERE status = 'open') AS trades_updated
UNION ALL
SELECT
  'Total closed trades' AS fix,
  (SELECT COUNT(*) FROM mock_trades WHERE status = 'closed') AS trades_updated;
