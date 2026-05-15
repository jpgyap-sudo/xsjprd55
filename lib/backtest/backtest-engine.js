// ============================================================
// Backtest Engine
// Simulates trades candle-by-candle with SL/TP/Leverage.
// Includes strategy optimizer for risk settings.
// Now uses shared-core.js for the simulation logic.
// ============================================================

import { simulateTradeCore, summarizeTrades } from './shared-core.js';
import { logger } from '../logger.js';

/**
 * Simulate a single trade through forward candles.
 * @param {Object} opts
 * @param {Object} opts.signal         { price, side }
 * @param {Array}  opts.candles        [{ open, high, low, close, time }]
 * @param {number} [opts.leverage=1]
 * @param {number} [opts.stopLossPct=1.2]
 * @param {number} [opts.takeProfitPct=2.5]
 * @param {number} [opts.positionSizeUsd=100]
 */
export function simulateTrade({ signal, candles, leverage = 1, stopLossPct = 1.2, takeProfitPct = 2.5, positionSizeUsd = 100 }) {
  return simulateTradeCore({
    entryPrice: Number(signal.price),
    side: signal.side,
    candles,
    takeProfitPct,
    stopLossPct,
    leverage,
    positionSizeUsd,
  }, 'detailed');
}

/**
 * Build human-readable trade rationale from probability result.
 */
export function buildTradeRationale(signal, probabilityResult) {
  const scores = probabilityResult.scores;
  return (
    `Trade opened because final probability was ${probabilityResult.finalProbability}% ` +
    `with ${probabilityResult.confidence} confidence. ` +
    `Market score ${scores.market}, liquidation score ${scores.liquidation}, ` +
    `social score ${scores.social}, funding/OI score ${scores.fundingOi}, ` +
    `liquidity score ${scores.liquidity}, strategy history score ${scores.strategyHistory}.`
  );
}

/**
 * Run a full backtest over multiple signals.
 * @param {Object} opts
 * @param {Array}  opts.signals
 * @param {Object} opts.candleMap    { symbol: [candles] }
 * @param {Object} opts.config       { minProbability, leverage, stopLossPct, takeProfitPct }
 * @param {Function} opts.probabilityFn  (scores, options) => probabilityResult
 */
export function runBacktest({ signals, candleMap, config = {}, probabilityFn }) {
  const trades = [];
  for (const signal of signals) {
    const forwardCandles = candleMap[signal.symbol] || [];
    const probabilityResult = probabilityFn
      ? probabilityFn(signal.scores || {}, { sampleSize: signal.sampleSize || 0, dataQuality: signal.dataQuality || 70 })
      : { finalProbability: 50, confidence: 'weak', scores: signal.scores || {} };

    if (probabilityResult.finalProbability < (config.minProbability || 60)) continue;

    const trade = simulateTrade({
      signal,
      candles: forwardCandles,
      leverage: config.leverage || 1,
      stopLossPct: config.stopLossPct || 1.2,
      takeProfitPct: config.takeProfitPct || 2.5,
      positionSizeUsd: config.positionSizeUsd || 100,
    });

    trade.probabilityAtEntry = probabilityResult.finalProbability;
    trade.tradeRationale = buildTradeRationale(signal, probabilityResult);
    trade.scoreBreakdown = probabilityResult.scores;
    trades.push(trade);
  }

  const summary = summarizeTrades(trades);

  return {
    trades,
    summary: {
      totalTrades: summary.totalTrades,
      winRate: summary.totalTrades ? summary.winRate * 100 : 0,
      avgPnl: summary.avgPnl,
      totalPnlUsd: summary.totalPnlUsd,
      profitFactor: summary.profitFactor,
    },
  };
}

/**
 * Grid-search optimal risk settings for a signal.
 * @param {Object} opts
 * @param {Object} opts.signal
 * @param {Array}  opts.candles
 * @param {number[]} [opts.leverageOptions=[1,2,3,5]]
 * @param {number[]} [opts.stopLossOptions=[0.8,1.2,1.5,2]]
 * @param {number[]} [opts.takeProfitOptions=[1.5,2.5,3.5,5]]
 */
export function optimizeRiskSettings({ signal, candles, leverageOptions = [1, 2, 3, 5], stopLossOptions = [0.8, 1.2, 1.5, 2], takeProfitOptions = [1.5, 2.5, 3.5, 5] }) {
  const results = [];
  for (const leverage of leverageOptions) {
    for (const stopLossPct of stopLossOptions) {
      for (const takeProfitPct of takeProfitOptions) {
        const result = simulateTrade({ signal, candles, leverage, stopLossPct, takeProfitPct, positionSizeUsd: 100 });
        results.push({ leverage, stopLossPct, takeProfitPct, ...result });
      }
    }
  }
  const best = results.sort((a, b) => b.pnlUsd - a.pnlUsd)[0];
  logger.info(`[OPTIMIZER] Best for ${signal.symbol} ${signal.side}: lev=${best.leverage} SL=${best.stopLossPct}% TP=${best.takeProfitPct}% => $${best.pnlUsd}`);
  return best;
}
