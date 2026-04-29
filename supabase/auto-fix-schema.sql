-- Auto-generated fix by supabase-agent-checker
-- Run this in Supabase SQL Editor before applying main schemas

-- Fix: strategy_performance has conflicting definitions
-- Keeping UUID version (from trading_schema.sql)
DROP TABLE IF EXISTS strategy_performance CASCADE;

-- Ensure bot_users.telegram_user_id is BIGINT for RLS policies
ALTER TABLE IF EXISTS bot_users
  ALTER COLUMN telegram_user_id TYPE BIGINT
  USING (telegram_user_id::BIGINT);

-- Recreate RLS policies with explicit BIGINT casts
DROP POLICY IF EXISTS "Users see themselves" ON bot_users;
DROP POLICY IF EXISTS "Users see own trades" ON trades;
DROP POLICY IF EXISTS "Users see own credentials" ON exchange_credentials;

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
