// ============================================================
// Performance Metrics — Assello Backtest Extension
// Calculates Sharpe, Sortino, Calmar, max drawdown, etc.
// ============================================================

/**
 * @typedef {Object} TradeRecord
 * @property {number} pnlPct
 * @property {string} [created_at]
 */

/**
 * @typedef {Object} PerformanceReport
 * @property {number} totalReturnPct
 * @property {number} totalTrades
 * @property {number} winRate
 * @property {number} avgWinPct
 * @property {number} avgLossPct
 * @property {number} profitFactor
 * @property {number} sharpeRatio
 * @property {number} sortinoRatio
 * @property {number} calmarRatio
 * @property {number} maxDrawdownPct
 * @property {number} maxConsecutiveLosses
 * @property {number} expectancy
 */

/**
 * Calculate performance metrics from an array of closed trade returns (%).
 * @param {TradeRecord[]} trades
 * @param {number} [riskFreeRate=0] annualized risk-free rate
 * @returns {PerformanceReport}
 */
export function calculatePerformanceMetrics(trades, riskFreeRate = 0) {
  if (!trades || trades.length === 0) {
    return {
      totalReturnPct: 0, totalTrades: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0,
      profitFactor: 0, sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0,
      maxDrawdownPct: 0, maxConsecutiveLosses: 0, expectancy: 0,
    };
  }

  const pnls = trades.map((t) => t.pnlPct ?? 0);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);

  // Total return as compounded percentage: start at 100, multiply by (1 + pnlPct/100) for each trade
  const totalReturnPct = pnls.reduce((equity, p) => equity * (1 + p / 100), 100) - 100;
  const winRate = wins.length / pnls.length;
  const avgWinPct = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLossPct = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0)) || 1e-9;
  const profitFactor = grossProfit / grossLoss;

  // Sharpe
  const mean = totalReturnPct / pnls.length;
  const variance = pnls.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pnls.length;
  const stdDev = Math.sqrt(variance) || 1e-9;
  const sharpeRatio = (mean - riskFreeRate / 252) / stdDev; // daily

  // Sortino (downside deviation only)
  const downside = losses.map((p) => p ** 2);
  const downsideDev = Math.sqrt(downside.reduce((a, b) => a + b, 0) / pnls.length) || 1e-9;
  const sortinoRatio = (mean - riskFreeRate / 252) / downsideDev;

  // Max drawdown — percentage of peak equity, not cumulative PnL sum
  // Convert pnlPct to equity curve: start at 100, each trade multiplies by (1 + pnlPct/100)
  let equity = 100;
  let peakEquity = 100;
  let maxDD = 0;
  for (const p of pnls) {
    equity = equity * (1 + p / 100);
    if (equity > peakEquity) peakEquity = equity;
    const ddPct = ((peakEquity - equity) / peakEquity) * 100;
    if (ddPct > maxDD) maxDD = ddPct;
  }
  const maxDrawdownPct = maxDD;

  // Calmar = annualized return / max drawdown
  // Annualized return from compounded total return
  const periods = pnls.length || 1;
  const annualizedReturn = ((1 + totalReturnPct / 100) ** (252 / periods) - 1) * 100;
  const calmarRatio = maxDrawdownPct > 0 ? annualizedReturn / maxDrawdownPct : annualizedReturn;

  // Max consecutive losses
  let maxCL = 0;
  let currentCL = 0;
  for (const p of pnls) {
    if (p <= 0) { currentCL++; maxCL = Math.max(maxCL, currentCL); }
    else { currentCL = 0; }
  }

  // Expectancy = (winRate * avgWin) + (lossRate * avgLoss)
  const expectancy = (winRate * avgWinPct) + ((1 - winRate) * avgLossPct);

  return {
    totalReturnPct: Number(totalReturnPct.toFixed(4)),
    totalTrades: pnls.length,
    winRate: Number(winRate.toFixed(4)),
    avgWinPct: Number(avgWinPct.toFixed(4)),
    avgLossPct: Number(avgLossPct.toFixed(4)),
    profitFactor: Number(profitFactor.toFixed(4)),
    sharpeRatio: Number(sharpeRatio.toFixed(4)),
    sortinoRatio: Number(sortinoRatio.toFixed(4)),
    calmarRatio: Number(calmarRatio.toFixed(4)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(4)),
    maxConsecutiveLosses: maxCL,
    expectancy: Number(expectancy.toFixed(4)),
  };
}

/**
 * Calculate rolling metrics over a window.
 * @param {TradeRecord[]} trades
 * @param {number} windowSize
 * @returns {PerformanceReport[]}
 */
export function rollingMetrics(trades, windowSize = 30) {
  const results = [];
  for (let i = windowSize; i <= trades.length; i++) {
    const slice = trades.slice(i - windowSize, i);
    results.push(calculatePerformanceMetrics(slice));
  }
  return results;
}
