// ============================================================
// Position Sizing Calculator
// Computes position size and margin used from risk parameters.
// ============================================================

/**
 * Calculate position size based on risk per trade.
 * @param {Object} opts
 * @param {number} opts.balance           Account balance in USD
 * @param {number} [opts.riskPerTradePct=1]  Risk % of balance per trade
 * @param {number} [opts.stopLossPct=1.2]    Stop-loss distance %
 * @param {number} [opts.leverage=1]         Leverage multiplier
 */
export function calculatePositionSize({ balance, riskPerTradePct = 1, stopLossPct = 1.2, leverage = 1 }) {
  const riskUsd = balance * (riskPerTradePct / 100);
  const positionSizeUsd = (riskUsd / (stopLossPct / 100)) * leverage;
  const marginUsed = positionSizeUsd / leverage;

  return {
    positionSizeUsd: Number(positionSizeUsd.toFixed(2)),
    marginUsed: Number(marginUsed.toFixed(2)),
    riskUsd: Number(riskUsd.toFixed(2)),
  };
}
