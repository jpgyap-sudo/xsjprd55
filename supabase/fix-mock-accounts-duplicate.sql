-- ============================================================
-- Fix duplicate mock_accounts names before creating unique index
-- Run this in Supabase SQL Editor if you get:
--   ERROR: 23505: could not create unique index "idx_mock_accounts_name_unique"
-- ============================================================

-- 1. See duplicates
-- SELECT name, COUNT(*) FROM mock_accounts GROUP BY name HAVING COUNT(*) > 1;

-- 2. Keep only the most recent row per name, delete the rest
DELETE FROM mock_accounts a
USING mock_accounts b
WHERE a.id < b.id
  AND a.name = b.name;

-- 3. Now create the unique index safely
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
