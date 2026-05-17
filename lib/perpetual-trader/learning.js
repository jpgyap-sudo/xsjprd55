import { supabase } from '../supabase.js';
import { recordTradeOutcome } from '../mock-trading/strategy-scorecard.js';

export async function recordPerpetualTradeOutcome(trade) {
  const entryAt = trade.entry_at || trade.created_at;
  const exitAt = trade.exit_at || new Date().toISOString();
  const holdMinutes = Math.max(0, Math.round((new Date(exitAt) - new Date(entryAt)) / 60000));
  const initialRiskUsd = Number(trade.initial_risk_usd || 0);
  const rMultiple = initialRiskUsd > 0 ? Number(trade.pnl_usd || 0) / initialRiskUsd : 0;
  const mfePct = Number(trade.max_favorable_excursion_pct || 0);
  const maePct = Number(trade.max_adverse_excursion_pct || 0);
  const marketRegime = trade.market_regime_at_entry || 'any';

  await recordTradeOutcome({
    strategy_name: trade.strategy || 'unknown',
    symbol: trade.symbol,
    timeframe: trade.timeframe || '15m',
    market_regime: marketRegime,
  }, {
    pnl_usd: Number(trade.pnl_usd || 0),
    pnl_pct: Number(trade.pnl_pct || 0),
    r_multiple: rMultiple,
    time_in_trade_minutes: holdMinutes,
    mfe_pct: mfePct,
    mae_pct: maePct,
  });

  await supabase.from('perpetual_mock_trades').update({
    r_multiple_at_close: Math.round(rMultiple * 100) / 100,
    updated_at: new Date().toISOString(),
  }).eq('id', trade.id);
}
