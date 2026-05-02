// ============================================================
// Trade History Logger
// Writes open/close events to mock_trade_history for audit trails.
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';

export async function logTradeHistory({
  tradeId,
  accountId,
  event,
  symbol,
  side,
  price,
  pnlUsd,
  pnlPct,
  balanceAfter,
  leverage,
  positionSizeUsd,
  exitReason,
  metadata = {}
}) {
  try {
    const { error } = await supabase.from('mock_trade_history').insert({
      trade_id: tradeId,
      account_id: accountId,
      event,
      symbol,
      side,
      price,
      pnl_usd: pnlUsd,
      pnl_pct: pnlPct,
      balance_after: balanceAfter,
      leverage,
      position_size_usd: positionSizeUsd,
      exit_reason: exitReason,
      metadata,
      created_at: new Date().toISOString(),
    });
    if (error) {
      logger.debug(`[TRADE-HISTORY] Insert failed (table may not exist): ${error.message}`);
    }
  } catch (e) {
    logger.debug(`[TRADE-HISTORY] ${e.message}`);
  }
}
