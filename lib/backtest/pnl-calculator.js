// ============================================================
// PnL Calculator with Leverage & Fees
// Computes net PnL after leverage amplification and trading fees.
// ============================================================

/**
 * Calculate net PnL for a leveraged trade.
 * @param {Object} opts
 * @param {string} opts.side          'long' | 'short'
 * @param {number} opts.entryPrice
 * @param {number} opts.exitPrice
 * @param {number} [opts.leverage=1]
 * @param {number} [opts.positionSizeUsd=100]
 * @param {number} [opts.feePct=0.08]   Total round-trip fee % (entry + exit)
 */
export function calculatePnl({ side, entryPrice, exitPrice, leverage = 1, positionSizeUsd = 100, feePct = 0.08 }) {
  const direction = side === 'long' ? 1 : -1;
  const rawMovePct = ((exitPrice - entryPrice) / entryPrice) * 100 * direction;
  const leveragedPnlPct = rawMovePct * leverage;
  const fees = feePct * leverage;
  const netPnlPct = leveragedPnlPct - fees;
  const pnlUsd = positionSizeUsd * (netPnlPct / 100);

  return {
    rawMovePct: Number(rawMovePct.toFixed(4)),
    leveragedPnlPct: Number(leveragedPnlPct.toFixed(4)),
    feesPct: Number(fees.toFixed(4)),
    pnlPct: Number(netPnlPct.toFixed(4)),
    pnlUsd: Number(pnlUsd.toFixed(2)),
  };
}
