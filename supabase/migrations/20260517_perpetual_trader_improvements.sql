ALTER TABLE perpetual_mock_trades
  ADD COLUMN IF NOT EXISTS initial_risk_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS market_regime_at_entry TEXT,
  ADD COLUMN IF NOT EXISTS funding_rate_at_entry NUMERIC,
  ADD COLUMN IF NOT EXISTS partial_exit_price NUMERIC,
  ADD COLUMN IF NOT EXISTS partial_exit_pct NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trailing_stop NUMERIC,
  ADD COLUMN IF NOT EXISTS breakeven_moved BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS r_multiple_at_close NUMERIC,
  ADD COLUMN IF NOT EXISTS max_favorable_excursion_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS max_adverse_excursion_pct NUMERIC;

ALTER TABLE perp_trade_history
  ADD COLUMN IF NOT EXISTS initial_risk_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS market_regime_at_entry TEXT,
  ADD COLUMN IF NOT EXISTS funding_rate_at_entry NUMERIC,
  ADD COLUMN IF NOT EXISTS partial_exit_price NUMERIC,
  ADD COLUMN IF NOT EXISTS partial_exit_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS r_multiple_at_close NUMERIC;
