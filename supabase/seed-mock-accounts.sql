-- ============================================================
-- Auto-seed mock_accounts for paper trading
-- Run this after schema creation to ensure all trading engines
-- have an account to work with even if RLS blocks inserts.
-- ============================================================

INSERT INTO mock_accounts (name, starting_balance, current_balance, peak_balance, metadata)
VALUES
  ('AI Mock Account',         1000000, 1000000, 1000000, '{"auto_seeded":true,"version":"v1"}'),
  ('Aggressive AI Trader',    1000000, 1000000, 1000000, '{"auto_seeded":true,"version":"v3_ml"}'),
  ('Execution Optimizer v3',  1000000, 1000000, 1000000, '{"auto_seeded":true,"version":"v3"}')
ON CONFLICT (name) DO NOTHING;
