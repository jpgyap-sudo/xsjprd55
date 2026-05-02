-- ============================================================
-- Fix duplicate mock_accounts names before creating unique index
-- Run this in Supabase SQL Editor if you get:
--   ERROR: 23505: could not create unique index "idx_mock_accounts_name_unique"
--   OR
--   ERROR: 23503: update or delete on table "mock_accounts" violates foreign key constraint
-- ============================================================

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

-- 2. Now safely delete duplicate accounts (no FK violations)
DELETE FROM mock_accounts a
USING mock_accounts b
WHERE a.id < b.id AND a.name = b.name;

-- 3. Create unique index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_mock_accounts_name_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_mock_accounts_name_unique ON mock_accounts(name);
  END IF;
END $$;

-- 4. Re-seed the three standard accounts (will skip if names now exist)
INSERT INTO mock_accounts (name, starting_balance, current_balance, peak_balance, metadata)
VALUES
  ('AI Mock Account',         1000000, 1000000, 1000000, '{"auto_seeded":true,"version":"v1"}'),
  ('Aggressive AI Trader',    1000000, 1000000, 1000000, '{"auto_seeded":true,"version":"v3_ml"}'),
  ('Execution Optimizer v3',  1000000, 1000000, 1000000, '{"auto_seeded":true,"version":"v3"}')
ON CONFLICT (name) DO NOTHING;

-- 5. Verify
SELECT name, current_balance, created_at FROM mock_accounts ORDER BY name;
