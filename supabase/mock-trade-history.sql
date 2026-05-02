-- ============================================================
-- Mock Trade History Log
-- Records every open and close event with precise timestamps.
-- Run this in Supabase SQL Editor.
-- 2026-05-02
-- ============================================================

CREATE TABLE IF NOT EXISTS mock_trade_history (
  id          BIGSERIAL PRIMARY KEY,
  trade_id    UUID REFERENCES mock_trades(id) ON DELETE CASCADE,
  account_id  UUID REFERENCES mock_accounts(id) ON DELETE SET NULL,
  event       TEXT NOT NULL CHECK (event IN ('opened','closed')),
  symbol      TEXT NOT NULL,
  side        TEXT,
  price       NUMERIC,
  pnl_usd     NUMERIC,
  pnl_pct     NUMERIC,
  balance_after NUMERIC,
  leverage    NUMERIC,
  position_size_usd NUMERIC,
  exit_reason TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mock_trade_history_trade ON mock_trade_history(trade_id);
CREATE INDEX IF NOT EXISTS idx_mock_trade_history_account ON mock_trade_history(account_id);
CREATE INDEX IF NOT EXISTS idx_mock_trade_history_event ON mock_trade_history(event);
CREATE INDEX IF NOT EXISTS idx_mock_trade_history_created ON mock_trade_history(created_at DESC);

SELECT 'mock_trade_history ready' AS status;
