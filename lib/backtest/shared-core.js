// ============================================================
// Shared Backtest Core
// Unified trade simulation logic used by both:
//   - lib/backtest/backtest-engine.js (signal-based)
//   - lib/ml/backtestEngine.js (ML strategy-based)
// ============================================================

import { calculatePnl } from './pnl-calculator.js';

/**
 * @typedef {Object} SimTradeOptions
 * @property {number} entryPrice
 * @property {'LONG'|'SHORT'} side
 * @property {Array<{open:number,high:number,low:number,close:number,time?:string|number}>} candles
 * @property {number} [takeProfitPct=2.0]
 * @property {number} [stopLossPct=1.0]
 * @property {number} [leverage=1]
 * @property {number} [positionSizeUsd=100]
 */

/**
 * Simulate a single trade through forward candles.
 * Unified version that supports both simple (pnlPct-only) and
 * detailed (pnlUsd, exitReason, etc.) output modes.
 *
 * @param {SimTradeOptions} opts
 * @param {'simple'|'detailed'} [mode='simple']
 * @returns {Object}
 */
export function simulateTradeCore(opts, mode = 'simple') {
  const {
    entryPrice,
    side,
    candles,
    takeProfitPct = 2.0,
    stopLossPct = 1.0,
    leverage = 1,
    positionSizeUsd = 100,
  } = opts;

  const isLong = side === 'LONG' || side === 'long';
  const tp = isLong
    ? entryPrice * (1 + takeProfitPct / 100)
    : entryPrice * (1 - takeProfitPct / 100);
  const sl = isLong
    ? entryPrice * (1 - stopLossPct / 100)
    : entryPrice * (1 + stopLossPct / 100);

  for (let i = 0; i < candles.length; i++) {
    const { high, low, time } = candles[i];
    const hitSl = isLong ? low <= sl : high >= sl;
    const hitTp = isLong ? high >= tp : low <= tp;

    if (hitSl || hitTp) {
      const exitPrice = hitTp ? tp : sl;
      const exitReason = hitTp ? 'take_profit' : 'stop_loss';

      if (mode === 'detailed') {
        const pnl = calculatePnl({ side, entryPrice, exitPrice, leverage, positionSizeUsd });
        return {
          entryPrice,
          exitPrice,
          stopLoss: sl,
          takeProfit: tp,
          leverage,
          positionSizeUsd,
          pnlPct: pnl.pnlPct,
          pnlUsd: pnl.pnlUsd,
          result: pnl.pnlUsd > 0 ? 'win' : 'loss',
          exitReason,
          exitTime: time,
          exitAt: i,
          hit: hitTp ? 'TP' : 'SL',
        };
      }

      // Simple mode
      const pnlPct = hitTp ? takeProfitPct : -stopLossPct;
      return { pnlPct, exitPrice, exitAt: i, hit: hitTp ? 'TP' : 'SL' };
    }
  }

  // Timeout — close at last candle
  const last = candles[candles.length - 1];
  const exitPrice = last ? last.close : entryPrice;

  if (mode === 'detailed') {
    const pnl = calculatePnl({ side, entryPrice, exitPrice, leverage, positionSizeUsd });
    return {
      entryPrice,
      exitPrice,
      stopLoss: sl,
      takeProfit: tp,
      leverage,
      positionSizeUsd,
      pnlPct: pnl.pnlPct,
      pnlUsd: pnl.pnlUsd,
      result: pnl.pnlUsd > 0 ? 'win' : 'loss',
      exitReason: 'time_exit',
      exitTime: last ? last.time : null,
      exitAt: candles.length - 1,
      hit: 'TIMEOUT',
    };
  }

  const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1);
  return { pnlPct, exitPrice, exitAt: candles.length - 1, hit: 'TIMEOUT' };
}

/**
 * Compute performance summary from an array of trades.
 * @param {Array<{pnlPct:number, pnlUsd?:number, result?:string}>} trades
 * @returns {Object}
 */
export function summarizeTrades(trades) {
  if (!trades || trades.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      avgPnl: 0,
      totalPnlUsd: 0,
      profitFactor: 0,
      totalReturnPct: 0,
    };
  }

  const wins = trades.filter(t => (t.result === 'win') || (t.pnlPct > 0));
  const losses = trades.filter(t => (t.result === 'loss') || (t.pnlPct <= 0));
  const totalPnlUsd = trades.reduce((s, t) => s + (t.pnlUsd || 0), 0);
  const totalPnlPct = trades.reduce((s, t) => s + (t.pnlPct || 0), 0);
  const winPnl = wins.reduce((s, t) => s + Math.abs(t.pnlUsd || t.pnlPct || 0), 0);
  const lossPnl = losses.reduce((s, t) => s + Math.abs(t.pnlUsd || t.pnlPct || 0), 0);

  return {
    totalTrades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgPnl: trades.length ? totalPnlPct / trades.length : 0,
    totalPnlUsd,
    totalReturnPct: totalPnlPct,
    profitFactor: lossPnl > 0 ? winPnl / lossPnl : winPnl > 0 ? Infinity : 0,
  };
}
