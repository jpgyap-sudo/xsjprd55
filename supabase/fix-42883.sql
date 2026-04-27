-- ============================================================
-- EMERGENCY FIX for ERROR 42883: operator does not exist: text = bigint
-- Run this in Supabase SQL Editor (new query) BEFORE running the main schema
-- ============================================================

-- 1. Ensure bot_users exists first (trades needs it as FK)
CREATE TABLE IF NOT EXISTS bot_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT UNIQUE NOT NULL,
  username        TEXT,
  first_name      TEXT,
  risk_profile    TEXT DEFAULT 'moderate' CHECK (risk_profile IN ('conservative','moderate','aggressive')),
  max_position_size NUMERIC DEFAULT 100,
  daily_loss_limit  NUMERIC DEFAULT 50,
  cooldown_minutes  INTEGER DEFAULT 15,
  auto_trade_enabled BOOLEAN DEFAULT false,
  preferred_exchange TEXT DEFAULT 'binance',
  preferred_mode    TEXT DEFAULT 'paper' CHECK (preferred_mode IN ('paper','live')),
  is_admin        BOOLEAN DEFAULT false,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 2. Fix trades.user_id column type to UUID (handles existing wrong-type columns)
DO $$
BEGIN
  -- If trades table exists but user_id is wrong type, fix it
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'trades'
  ) THEN
    -- Drop the column if it exists with wrong type and recreate as UUID
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'trades' AND column_name = 'user_id'
      AND data_type != 'uuid'
    ) THEN
      ALTER TABLE trades DROP COLUMN user_id;
      ALTER TABLE trades ADD COLUMN user_id UUID REFERENCES bot_users(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- 3. Also fix if trades exists but user_id column is completely missing
ALTER TABLE IF EXISTS trades
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES bot_users(id) ON DELETE SET NULL;

-- 4. Fix audit_log.user_id if it was ever used in RLS (make consistent)
-- (audit_log currently has BIGINT user_id which is fine since it's just a log)

-- 5. Drop and recreate RLS policies to ensure clean state
DROP POLICY IF EXISTS "Users see themselves" ON bot_users;
DROP POLICY IF EXISTS "Users see own trades" ON trades;
DROP POLICY IF EXISTS "Users see own credentials" ON exchange_credentials;

-- 6. Recreate RLS policies with explicit casts
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

-- 7. Verify the fix
SELECT 
  c.table_name,
  c.column_name,
  c.data_type
FROM information_schema.columns c
WHERE c.table_name IN ('bot_users', 'trades')
  AND c.column_name IN ('id', 'user_id', 'telegram_user_id')
ORDER BY c.table_name, c.column_name;
