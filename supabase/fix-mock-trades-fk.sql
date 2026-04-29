-- ============================================================
-- FIX: mock_trades.signal_id FK mismatch
-- Problem: trading_schema.sql creates signal_id -> signal_logs(id)
--          but execution workers read from signals(id)
-- This causes silent insert failures = zero mock trades
-- ============================================================

-- 1. Drop the incorrect FK constraint (if exists)
--    Since Supabase auto-generated the constraint name, we handle both cases
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
  WHERE tc.table_name = 'mock_trades'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name = 'signal_logs';

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE mock_trades DROP CONSTRAINT %I', fk_name);
    RAISE NOTICE 'Dropped FK % referencing signal_logs', fk_name;
  END IF;
END $$;

-- 2. Ensure signal_id column exists and points to signals(id)
--    First drop any duplicate signal_id column from schema_additions
DO $$
BEGIN
  -- If there are two signal_id columns (rare but possible after repeated migrations),
  -- we keep only one and fix its type/reference
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mock_trades' AND column_name = 'signal_id'
  ) THEN
    -- Remove the FK constraint on signal_id if any remains
    ALTER TABLE mock_trades DROP CONSTRAINT IF EXISTS mock_trades_signal_id_fkey;
  END IF;
END $$;

-- 3. Make sure signal_id is UUID type
ALTER TABLE mock_trades
  ALTER COLUMN signal_id TYPE UUID USING signal_id::UUID;

-- 4. Add the correct FK referencing signals(id)
ALTER TABLE mock_trades
  ADD CONSTRAINT mock_trades_signal_id_fkey
  FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE SET NULL;

-- 5. Also ensure signals.id is the right type for FK
--    (It should already be UUID PRIMARY KEY from trading_schema.sql)

-- 6. Verify
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS references_table,
  ccu.column_name AS references_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.table_name = 'mock_trades'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'signal_id';
