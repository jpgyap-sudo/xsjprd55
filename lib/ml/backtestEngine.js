// ============================================================
// Backtest Engine — Assello Extension
// Walks historical signal decisions through mock price paths.
// ============================================================

import { db } from './db.js';
import { runStrategyLab, STRATEGIES } from './strategies.js';
import { runDynamicStrategy, loadCandidateProposals } from './dynamicStrategies.js';
import { buildFeatures } from './features.js';
import { calculatePerformanceMetrics } from './performanceMetrics.js';
import { logger } from '../logger.js';

/**
 * @typedef {Object} BacktestCandle
 * @property {string} timestamp
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} volume
 */

/**
 * @typedef {Object} BacktestResult
 * @property {string} strategyName
 * @property {number} totalReturnPct
 * @property {number} totalTrades
 * @property {number} winRate
 * @property {number} sharpeRatio
 * @property {number} maxDrawdownPct
 * @property {number} profitFactor
 * @property {Object[]} tradeLog
 */

/**
 * Simulate a single trade through a series of candles.
 * @param {Object} decision
 * @param {BacktestCandle[]} candles
 * @param {number} tpPct
 * @param {number} slPct
 * @returns {{pnlPct:number, exitPrice:number, exitAt:number, hit:'TP'|'SL'|'TIMEOUT'}}
 */
function simulateTrade(decision, candles, tpPct = 2.0, slPct = 1.0) {
  const entry = candles[0]?.open ?? decision.entry_price;
  const isLong = decision.side === 'LONG';
  const tp = isLong ? entry * (1 + tpPct / 100) : entry * (1 - tpPct / 100);
  const sl = isLong ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);

  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    if (isLong) {
      if (high >= tp) return { pnlPct: tpPct, exitPrice: tp, exitAt: i, hit: 'TP' };
      if (low <= sl) return { pnlPct: -slPct, exitPrice: sl, exitAt: i, hit: 'SL' };
    } else {
      if (low <= tp) return { pnlPct: tpPct, exitPrice: tp, exitAt: i, hit: 'TP' };
      if (high >= sl) return { pnlPct: -slPct, exitPrice: sl, exitAt: i, hit: 'SL' };
    }
  }

  // Timeout — close at last candle
  const last = candles[candles.length - 1];
  const pnlPct = ((last.close - entry) / entry) * 100 * (isLong ? 1 : -1);
  return { pnlPct, exitPrice: last.close, exitAt: candles.length - 1, hit: 'TIMEOUT' };
}

/**
 * Run backtest for a single built-in strategy over candle data.
 * @param {string} strategyName
 * @param {BacktestCandle[]} candles
 * @param {string} symbol
 * @returns {BacktestResult}
 */
export function backtestStrategy(strategyName, candles, symbol = 'BTCUSDT') {
  if (!candles || candles.length < 10) {
    return { strategyName, totalReturnPct: 0, totalTrades: 0, winRate: 0, sharpeRatio: 0, maxDrawdownPct: 0, profitFactor: 0, tradeLog: [] };
  }

  const strategyFn = STRATEGIES[strategyName];
  if (!strategyFn) {
    logger.warn(`[BACKTEST] Unknown strategy: ${strategyName}`);
    return { strategyName, totalReturnPct: 0, totalTrades: 0, winRate: 0, sharpeRatio: 0, maxDrawdownPct: 0, profitFactor: 0, tradeLog: [] };
  }

  const trades = [];
  const lookback = 20;

  for (let i = lookback; i < candles.length - 5; i++) {
    const slice = candles.slice(i - lookback, i);
    const current = candles[i];
    const input = {
      symbol,
      price: current.close,
      funding_rate: (Math.random() - 0.5) * 0.01,
      open_interest_change_pct: (Math.random() - 0.5) * 4,
      liquidation_imbalance: (Math.random() - 0.5) * 0.6,
      social_sentiment: (Math.random() - 0.5) * 0.8,
      news_sentiment: (Math.random() - 0.5) * 0.6,
      volume_change_pct: (Math.random() - 0.5) * 100,
      volatility_pct: ((slice.reduce((a, c) => a + c.high - c.low, 0) / slice.length) / current.close) * 100,
      whale_flow_score: (Math.random() - 0.5) * 0.6,
      btc_trend_score: (candles[i].close - candles[i - 5].close) / candles[i - 5].close,
      spread_bps: Math.random() * 20,
    };

    const decision = strategyFn(input);
    if (decision.side !== 'NONE' && decision.confidence >= 0.35) {
      const future = candles.slice(i + 1, Math.min(i + 50, candles.length));
      const sim = simulateTrade(decision, future);
      trades.push({
        entry: current.close,
        exit: sim.exitPrice,
        pnlPct: sim.pnlPct,
        side: decision.side,
        hit: sim.hit,
        confidence: decision.confidence,
        timestamp: current.timestamp,
      });
    }
  }

  const metrics = calculatePerformanceMetrics(trades.map((t) => ({ pnlPct: t.pnlPct })));

  logger.info(`[BACKTEST] ${strategyName}: ${trades.length} trades, ${(metrics.winRate * 100).toFixed(1)}% WR, PF=${metrics.profitFactor.toFixed(2)}`);

  return {
    strategyName,
    totalReturnPct: metrics.totalReturnPct,
    totalTrades: metrics.totalTrades,
    winRate: metrics.winRate,
    sharpeRatio: metrics.sharpeRatio,
    maxDrawdownPct: metrics.maxDrawdownPct,
    profitFactor: metrics.profitFactor,
    tradeLog: trades.slice(0, 50),
  };
}

/**
 * Run backtest for all built-in strategies.
 * @param {BacktestCandle[]} candles
 * @param {string} symbol
 * @returns {BacktestResult[]}
 */
export function backtestAllStrategies(candles, symbol = 'BTCUSDT') {
  const results = [];
  for (const name of Object.keys(STRATEGIES)) {
    try {
      results.push(backtestStrategy(name, candles, symbol));
    } catch (e) {
      logger.warn(`[BACKTEST] ${name} failed: ${e.message}`);
    }
  }
  return results;
}

/**
 * Backtest a dynamic (research-extracted) strategy.
 * @param {number} proposalId
 * @param {BacktestCandle[]} candles
 * @param {string} symbol
 * @returns {BacktestResult|null}
 */
export function backtestDynamicStrategy(proposalId, candles, symbol = 'BTCUSDT') {
  const proposals = loadCandidateProposals(100);
  const candidate = proposals.find((p) => p.id === proposalId);
  if (!candidate) {
    logger.warn(`[BACKTEST] Proposal ${proposalId} not found`);
    return null;
  }

  const trades = [];
  const lookback = 20;

  for (let i = lookback; i < candles.length - 5; i++) {
    const current = candles[i];
    const input = {
      symbol,
      price: current.close,
      funding_rate: (Math.random() - 0.5) * 0.01,
      open_interest_change_pct: (Math.random() - 0.5) * 4,
      liquidation_imbalance: (Math.random() - 0.5) * 0.6,
      social_sentiment: (Math.random() - 0.5) * 0.8,
      news_sentiment: (Math.random() - 0.5) * 0.6,
      volume_change_pct: (Math.random() - 0.5) * 100,
      volatility_pct: Math.random() * 5,
      whale_flow_score: (Math.random() - 0.5) * 0.6,
      btc_trend_score: (candles[i].close - candles[i - 5].close) / candles[i - 5].close,
      spread_bps: Math.random() * 20,
    };

    const decision = runDynamicStrategy(candidate.proposal, input);
    if (decision.side !== 'NONE' && decision.confidence >= 0.35) {
      const future = candles.slice(i + 1, Math.min(i + 50, candles.length));
      const sim = simulateTrade(decision, future);
      trades.push({
        entry: current.close,
        exit: sim.exitPrice,
        pnlPct: sim.pnlPct,
        side: decision.side,
        hit: sim.hit,
        confidence: decision.confidence,
        timestamp: current.timestamp,
      });
    }
  }

  const metrics = calculatePerformanceMetrics(trades.map((t) => ({ pnlPct: t.pnlPct })));

  return {
    strategyName: candidate.proposal.name,
    totalReturnPct: metrics.totalReturnPct,
    totalTrades: metrics.totalTrades,
    winRate: metrics.winRate,
    sharpeRatio: metrics.sharpeRatio,
    maxDrawdownPct: metrics.maxDrawdownPct,
    profitFactor: metrics.profitFactor,
    tradeLog: trades.slice(0, 50),
  };
}

/**
 * Store backtest result in DB for audit.
 * @param {BacktestResult} result
 * @param {string} symbol
 */
export function storeBacktestResult(result, symbol = 'BTCUSDT') {
  try {
    db.prepare(`
      INSERT INTO backtest_results
        (run_at, strategy_name, symbol, total_return_pct, total_trades, win_rate, sharpe_ratio, max_drawdown_pct, profit_factor, trade_log_json)
      VALUES
        (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.strategyName,
      symbol,
      result.totalReturnPct,
      result.totalTrades,
      result.winRate,
      result.sharpeRatio,
      result.maxDrawdownPct,
      result.profitFactor,
      JSON.stringify(result.tradeLog.slice(0, 20))
    );
  } catch (e) {
    logger.warn(`[BACKTEST] Store failed: ${e.message}`);
  }
}
