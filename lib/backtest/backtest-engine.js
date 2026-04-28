// ============================================================
// Backtest Engine
// Simulates trades candle-by-candle with SL/TP/Leverage.
// Includes strategy optimizer for risk settings.
// ============================================================

import { calculatePnl } from './pnl-calculator.js';
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
  const entryPrice = Number(signal.price);
  const side = signal.side;
  const sl = side === 'long'
    ? entryPrice * (1 - stopLossPct / 100)
    : entryPrice * (1 + stopLossPct / 100);
  const tp = side === 'long'
    ? entryPrice * (1 + takeProfitPct / 100)
    : entryPrice * (1 - takeProfitPct / 100);

  for (const candle of candles) {
    const hitSl = side === 'long' ? candle.low <= sl : candle.high >= sl;
    const hitTp = side === 'long' ? candle.high >= tp : candle.low <= tp;

    if (hitSl || hitTp) {
      const exitPrice = hitTp ? tp : sl;
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
        exitReason: hitTp ? 'take_profit' : 'stop_loss',
        exitTime: candle.time,
      };
    }
  }

  // Time exit — no SL/TP hit within candle window
  const last = candles[candles.length - 1];
  const exitPrice = last ? last.close : entryPrice;
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
  };
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

  const wins = trades.filter(t => t.result === 'win');
  const losses = trades.filter(t => t.result === 'loss');
  const totalPnl = trades.reduce((s, t) => s + t.pnlUsd, 0);

  return {
    trades,
    summary: {
      totalTrades: trades.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      avgPnl: trades.length ? totalPnl / trades.length : 0,
      totalPnlUsd: totalPnl,
      profitFactor: losses.length ? wins.reduce((s, t) => s + t.pnlUsd, 0) / Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0)) : 0,
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
