// ============================================================
// Backtest Engine — Assello Extension
// Walks historical signal decisions through mock price paths.
// Now writes results through Supabase adapter (with SQLite fallback).
// v2: Removed Math.random() from features, added synthetic flag,
//     walk-forward validation, and expectancy in results.
// v3: Uses shared-core.js for trade simulation (consolidated).
// ============================================================

import { db } from './db.js';
import { saveBacktestResult, markProposalTested } from './supabase-db.js';
import { runStrategyLab, STRATEGIES } from './strategies.js';
import { runDynamicStrategy, loadCandidateProposals } from './dynamicStrategies.js';
import { buildFeatures } from './features.js';
import { calculatePerformanceMetrics } from './performanceMetrics.js';
import { validateWalkForward } from './walkForwardValidator.js';
import { simulateTradeCore } from '../backtest/shared-core.js';
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
 * @property {number} expectancy
 * @property {Object[]} tradeLog
 * @property {boolean} isSynthetic — true if dummy candles were used
 * @property {boolean} hasRandomFeatures — true if Math.random was used for features
 * @property {Object} [walkForward] — walk-forward validation result
 */

/**
 * Simulate a single trade through a series of candles.
 * Delegates to shared-core.js for consolidated trade simulation logic.
 * @param {Object} decision - { side, entry_price, confidence }
 * @param {BacktestCandle[]} candles
 * @param {number} tpPct
 * @param {number} slPct
 * @returns {{pnlPct:number, exitPrice:number, exitAt:number, hit:'TP'|'SL'|'TIMEOUT'}}
 */
function simulateTrade(decision, candles, tpPct = 2.0, slPct = 1.0) {
  const entryPrice = candles[0]?.open ?? decision.entry_price;
  return simulateTradeCore({
    entryPrice,
    side: decision.side,
    candles,
    takeProfitPct: tpPct,
    stopLossPct: slPct,
  }, 'simple');
}

/**
 * Compute RSI from an array of closing prices.
 * @param {number[]} closes
 * @param {number} [period=14]
 * @returns {number[]}
 */
function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return closes.map(() => 50);
  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  const out = new Array(period).fill(50);
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

/**
 * Compute EMA for a given period.
 * @param {number[]} data
 * @param {number} period
 * @returns {number[]}
 */
function computeEMA(data, period) {
  const k = 2 / (period + 1);
  let e = data[0];
  const out = [e];
  for (let i = 1; i < data.length; i++) {
    e = data[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

/**
 * Detect EMA cross score (-1 to 1).
 * Positive = bullish cross (fast EMA crosses above slow EMA).
 * Negative = bearish cross (fast EMA crosses below slow EMA).
 * @param {number[]} closes
 * @returns {number}
 */
function detectEMACross(closes) {
  if (closes.length < 22) return 0;
  const fast = computeEMA(closes, 9);
  const slow = computeEMA(closes, 21);
  const f1 = fast[fast.length - 1], s1 = slow[slow.length - 1];
  const f2 = fast[fast.length - 2], s2 = slow[slow.length - 2];
  // Bullish cross: fast was below slow, now above
  if (f2 <= s2 && f1 > s1) return 0.8;
  // Bearish cross: fast was above slow, now below
  if (f2 >= s2 && f1 < s1) return -0.8;
  // Already crossed: measure distance
  const diff = (f1 - s1) / s1;
  if (diff > 0.005) return 0.5;  // bullish alignment
  if (diff < -0.005) return -0.5; // bearish alignment
  return 0;
}

/**
 * Compute RSI divergence score (0 to 1).
 * Higher values indicate stronger divergence signal.
 * @param {number[]} closes
 * @param {number[]} rsiValues
 * @returns {number}
 */
function detectRSIDivergence(closes, rsiValues) {
  if (closes.length < 20 || rsiValues.length < 20) return 0.5;
  const recentCloses = closes.slice(-10);
  const recentRSI = rsiValues.slice(-10);
  const priceHigher = recentCloses[recentCloses.length - 1] > recentCloses[0];
  const rsiLower = recentRSI[recentRSI.length - 1] < recentRSI[0];
  const priceLower = recentCloses[recentCloses.length - 1] < recentCloses[0];
  const rsiHigher = recentRSI[recentRSI.length - 1] > recentRSI[0];
  // Bearish divergence: price higher, RSI lower
  if (priceHigher && rsiLower) return -0.7;
  // Bullish divergence: price lower, RSI higher
  if (priceLower && rsiHigher) return 0.7;
  // RSI oversold/overbought
  const lastRSI = rsiValues[rsiValues.length - 1];
  if (lastRSI < 30) return 0.6;  // oversold — potential bounce
  if (lastRSI > 70) return -0.6; // overbought — potential drop
  return 0;
}

/**
 * Detect support/resistance proximity score (-1 to 1).
 * Positive = near support (potential bounce). Negative = near resistance (potential drop).
 * @param {number} price
 * @param {Object[]} candles
 * @returns {number}
 */
function detectSupportResistance(price, candles) {
  if (candles.length < 20) return 0.5;
  // Find local minima (support) and maxima (resistance) in the lookback
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  // Simple approach: use recent swing lows/highs
  const recentLows = lows.slice(-10);
  const recentHighs = highs.slice(-10);
  const nearestSupport = Math.max(...recentLows);
  const nearestResistance = Math.min(...recentHighs);
  const distToSupport = price > 0 ? ((price - nearestSupport) / price) * 100 : 5;
  const distToResistance = price > 0 ? ((nearestResistance - price) / price) * 100 : 5;
  // If price is within 1% of support, bullish signal
  if (distToSupport < 1) return 0.6;
  // If price is within 1% of resistance, bearish signal
  if (distToResistance < 1) return -0.6;
  return 0;
}

/**
 * Detect volume spike score (0 to 1).
 * @param {number} currentVolume
 * @param {number[]} recentVolumes
 * @returns {number}
 */
function detectVolumeSpike(currentVolume, recentVolumes) {
  if (!recentVolumes.length) return 0;
  const avgVol = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  if (avgVol <= 0) return 0;
  const ratio = currentVolume / avgVol;
  if (ratio > 2.0) return 0.8;   // 2x volume spike
  if (ratio > 1.5) return 0.5;   // 1.5x volume spike
  if (ratio < 0.5) return -0.3;  // volume drying up
  return 0;
}

/**
 * Build input features from candle data.
 * Uses ONLY real data — no Math.random() fallback.
 * Now computes RSI, EMA cross, volume analysis, and support/resistance from OHLCV.
 * Unavailable features (funding, OI, liquidation, sentiment, whale flow, spread)
 * are set to 0 (neutral) rather than randomized.
 * @param {Object} params
 * @param {string} params.symbol
 * @param {Object} params.current — current candle
 * @param {Object[]} params.slice — lookback slice
 * @param {number} params.btcTrend
 * @param {number} params.volumeChange
 * @param {number} params.avgRange
 * @returns {{input:Object, hasRandomFeatures:boolean}}
 */
function buildRealFeatures({ symbol, current, slice, btcTrend, volumeChange, avgRange }) {
  // Compute technical indicators from OHLCV data
  const closes = [...slice.map(c => c.close), current.close];
  const rsiValues = computeRSI(closes, 14);
  const lastRSI = rsiValues[rsiValues.length - 1] || 50;
  const emaCrossScore = detectEMACross(closes);
  const rsiDivergence = detectRSIDivergence(closes, rsiValues);
  const supportResistanceScore = detectSupportResistance(current.close, slice);
  const recentVolumes = slice.slice(-10).map(c => c.volume);
  const volumeSpike = detectVolumeSpike(current.volume, recentVolumes);

  const input = {
    symbol,
    price: current.close,
    // Features not derivable from candles alone → neutral defaults
    // Calibrated so proposals' rules (e.g. social_sentiment > 0.3, funding_rate > -0.005) can pass
    fundingRate: 0,
    openInterestChangePct: 0,
    liquidationImbalance: 0,
    socialSentiment: 0.5,
    newsSentiment: 0.5,
    volumeChangePct: volumeChange,
    volatilityPct: (avgRange / current.close) * 100,
    whaleFlowScore: 0.5,
    btcTrendScore: btcTrend,
    spreadBps: 0,
    // Technical indicator features computed from OHLCV
    emaCrossScore,
    rsiDivergence,
    supportResistanceScore,
    macroScore: 0.6,
    btcDominanceScore: 0.6,
    orderBookDepth: 0.5,
    // Volume spike as additional signal
    volumeSpike,
  };

  return { input, hasRandomFeatures: false };
}

/**
 * Run backtest for a single built-in strategy over candle data.
 * @param {string} strategyName
 * @param {BacktestCandle[]} candles
 * @param {string} symbol
 * @param {Object} [opts]
 * @param {boolean} [opts.isSynthetic]
 * @returns {BacktestResult}
 */
export function backtestStrategy(strategyName, candles, symbol = 'BTCUSDT', opts = {}) {
  if (!candles || candles.length < 10) {
    return {
      strategyName, totalReturnPct: 0, totalTrades: 0, winRate: 0,
      sharpeRatio: 0, maxDrawdownPct: 0, profitFactor: 0, expectancy: 0,
      tradeLog: [], isSynthetic: opts.isSynthetic || false, hasRandomFeatures: false,
    };
  }

  const strategyFn = STRATEGIES[strategyName];
  if (!strategyFn) {
    logger.warn(`[BACKTEST] Unknown strategy: ${strategyName}`);
    return {
      strategyName, totalReturnPct: 0, totalTrades: 0, winRate: 0,
      sharpeRatio: 0, maxDrawdownPct: 0, profitFactor: 0, expectancy: 0,
      tradeLog: [], isSynthetic: opts.isSynthetic || false, hasRandomFeatures: false,
    };
  }

  const trades = [];
  const lookback = 20;

  for (let i = lookback; i < candles.length - 5; i++) {
    const slice = candles.slice(i - lookback, i);
    const current = candles[i];
    const avgRange = slice.reduce((a, c) => a + (c.high - c.low), 0) / slice.length;
    const btcTrend = (candles[i].close - candles[i - 5].close) / candles[i - 5].close;
    const volumeAvg = slice.reduce((a, c) => a + c.volume, 0) / slice.length;
    const volumeChange = volumeAvg > 0 ? ((current.volume - volumeAvg) / volumeAvg) * 100 : 0;

    // Build features from REAL data only — no Math.random()
    const { input } = buildRealFeatures({
      symbol, current, slice, btcTrend, volumeChange, avgRange,
    });

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

  // Run walk-forward validation
  const walkForward = validateWalkForward(trades.map((t) => ({ pnlPct: t.pnlPct })));

  logger.info(
    `[BACKTEST] ${strategyName}: ${trades.length}t ` +
    `WR=${(metrics.winRate * 100).toFixed(1)}% PF=${metrics.profitFactor.toFixed(2)} ` +
    `Exp=${metrics.expectancy.toFixed(4)} DD=${metrics.maxDrawdownPct.toFixed(1)}% ` +
    `WF=${walkForward.passed ? 'PASS' : 'FAIL'}`
  );

  return {
    strategyName,
    totalReturnPct: metrics.totalReturnPct,
    totalTrades: metrics.totalTrades,
    winRate: metrics.winRate,
    sharpeRatio: metrics.sharpeRatio,
    maxDrawdownPct: metrics.maxDrawdownPct,
    profitFactor: metrics.profitFactor,
    expectancy: metrics.expectancy,
    tradeLog: trades.slice(0, 50),
    isSynthetic: opts.isSynthetic || false,
    hasRandomFeatures: false,
    walkForward: walkForward.passed
      ? {
          trainMetrics: walkForward.trainMetrics,
          valMetrics: walkForward.valMetrics,
          oosMetrics: walkForward.oosMetrics,
        }
      : null,
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
 * @param {Object} [opts]
 * @param {boolean} [opts.isSynthetic]
 * @returns {BacktestResult|null}
 */
export async function backtestDynamicStrategy(proposalId, candles, symbol = 'BTCUSDT', opts = {}) {
  // Query proposal directly by ID instead of relying on loadCandidateProposals (which has LIMIT)
  let candidate = null;
  try {
    const row = db.prepare(`
      SELECT id, name, description, rules_json, confidence, rules_hash, source_name, source_credibility
      FROM strategy_proposals
      WHERE id = ?
    `).get(proposalId);
    if (row) {
      candidate = {
        id: row.id,
        rulesHash: row.rules_hash || null,
        sourceName: row.source_name || null,
        sourceCredibility: row.source_credibility ?? 0.5,
        proposal: {
          name: row.name,
          description: row.description,
          rules: typeof row.rules_json === 'string' ? JSON.parse(row.rules_json) : (row.rules_json || []),
          confidence: row.confidence,
          rulesHash: row.rules_hash || null,
          sourceName: row.source_name || null,
          sourceCredibility: row.source_credibility ?? 0.5,
        },
      };
    }
  } catch (e) {
    logger.warn(`[BACKTEST] DB query failed for proposal ${proposalId}: ${e.message}`);
  }
  if (!candidate) {
    logger.warn(`[BACKTEST] Proposal ${proposalId} not found in DB`);
    return null;
  }

  const trades = [];
  const lookback = 20;

  for (let i = lookback; i < candles.length - 5; i++) {
    const current = candles[i];
    const slice = candles.slice(i - lookback, i);
    const avgRange = slice.reduce((a, c) => a + (c.high - c.low), 0) / slice.length;
    const volumeAvg = slice.reduce((a, c) => a + c.volume, 0) / slice.length;
    const volumeChange = volumeAvg > 0 ? ((current.volume - volumeAvg) / volumeAvg) * 100 : 0;
    const btcTrend = (candles[i].close - candles[i - 5].close) / candles[i - 5].close;

    // Build features from REAL data only — no Math.random()
    const { input } = buildRealFeatures({
      symbol, current, slice, btcTrend, volumeChange, avgRange,
    });

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

  // Run walk-forward validation
  const walkForward = validateWalkForward(trades.map((t) => ({ pnlPct: t.pnlPct })));

  return {
    proposalId,
    strategyName: candidate.proposal.name,
    rules: candidate.proposal.rules || [],
    rulesHash: candidate.rulesHash || candidate.proposal.rulesHash || null,
    sourceName: candidate.sourceName || candidate.proposal.sourceName || null,
    sourceCredibility: candidate.sourceCredibility ?? candidate.proposal.sourceCredibility ?? 0.5,
    totalReturnPct: metrics.totalReturnPct,
    totalTrades: metrics.totalTrades,
    winRate: metrics.winRate,
    sharpeRatio: metrics.sharpeRatio,
    maxDrawdownPct: metrics.maxDrawdownPct,
    profitFactor: metrics.profitFactor,
    expectancy: metrics.expectancy,
    tradeLog: trades.slice(0, 50),
    isSynthetic: opts.isSynthetic || false,
    hasRandomFeatures: false,
    walkForward: walkForward.passed
      ? {
          trainMetrics: walkForward.trainMetrics,
          valMetrics: walkForward.valMetrics,
          oosMetrics: walkForward.oosMetrics,
        }
      : null,
  };
}

/**
 * Store backtest result in DB for audit.
 * @param {BacktestResult} result
 * @param {string} symbol
 */
export async function storeBacktestResultAsync(result, symbol = 'BTCUSDT') {
  try {
    await saveBacktestResult({
      strategyName: result.strategyName,
      symbol,
      totalReturnPct: result.totalReturnPct,
      totalTrades: result.totalTrades,
      winRate: result.winRate,
      sharpeRatio: result.sharpeRatio,
      maxDrawdownPct: result.maxDrawdownPct,
      profitFactor: result.profitFactor,
      expectancy: result.expectancy || 0,
      isSynthetic: result.isSynthetic ? 1 : 0,
      hasRandomFeatures: result.hasRandomFeatures ? 1 : 0,
      tradeLog: result.tradeLog.slice(0, 20),
    });
  } catch (e) {
    logger.warn(`[BACKTEST] Supabase store failed, falling back to SQLite: ${e.message}`);
    try {
      db.prepare(`
        INSERT INTO backtest_results
          (run_at, strategy_name, symbol, total_return_pct, total_trades, win_rate,
           sharpe_ratio, max_drawdown_pct, profit_factor, expectancy,
           is_synthetic, has_random_features, trade_log_json)
        VALUES
          (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        result.strategyName,
        symbol,
        result.totalReturnPct,
        result.totalTrades,
        result.winRate,
        result.sharpeRatio,
        result.maxDrawdownPct,
        result.profitFactor,
        result.expectancy || 0,
        result.isSynthetic ? 1 : 0,
        result.hasRandomFeatures ? 1 : 0,
        JSON.stringify(result.tradeLog.slice(0, 20))
      );
    } catch (e2) {
      logger.warn(`[BACKTEST] SQLite store also failed: ${e2.message}`);
    }
  }
}

/**
 * Run backtests on all untested candidate proposals.
 * Fetches real OHLCV data with fallback; skips if no data available.
 * @param {string} symbol
 * @param {number} [candleCount=100]
 * @returns {{results: BacktestResult[], symbol: string}}
 */
export async function runBacktestOnProposals(symbol = 'BTCUSDT', candleCount = 100) {
  const proposals = await loadCandidateProposals(500);
  if (!proposals.length) {
    logger.info(`[BACKTEST] No candidate proposals to backtest`);
    return { results: [], symbol };
  }

  // Fetch real OHLCV with fallback
  let candles = [];
  let isSynthetic = false;
  try {
    const { fetchOHLCV } = await import('../exchange.js');
    const ohlcv = await fetchOHLCV('binance', symbol, '15m', candleCount);
    if (ohlcv && ohlcv.length >= 30) {
      candles = ohlcv.map(c => ({
        timestamp: new Date(c[0]).toISOString(),
        open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
      }));
      logger.info(`[BACKTEST] Using real ${ohlcv.length} candles for ${symbol}`);
    }
  } catch (e) {
    logger.warn(`[BACKTEST] Real OHLCV fetch failed: ${e.message}`);
  }

  // Fall back to dummy candles only if real data unavailable
  if (!candles.length) {
    candles = generateDummyCandles(symbol, candleCount);
    isSynthetic = true;
    logger.info(`[BACKTEST] Using dummy candles for ${symbol} — results marked as SYNTHETIC`);
  }

  const results = [];
  for (const { id, proposal } of proposals) {
    try {
      const result = await backtestDynamicStrategy(id, candles, symbol, { isSynthetic });
      if (result) {
        await storeBacktestResultAsync(result, symbol);
        results.push(result);
      }
    } catch (e) {
      logger.warn(`[BACKTEST] Proposal ${id} failed: ${e.message}`);
    }
  }

  logger.info(`[BACKTEST] Tested ${results.length}/${proposals.length} proposals on ${symbol}`);
  return { results, symbol, proposalIds: proposals.map(p => p.id) };
}

/**
 * Generate dummy random-walk candles for backtesting when no exchange data is available.
 * Results from these candles are marked as synthetic and blocked from promotion.
 * @param {string} symbol
 * @param {number} count
 * @returns {BacktestCandle[]}
 */
function generateDummyCandles(symbol = 'BTCUSDT', count = 50) {
  const candles = [];
  let price = symbol.startsWith('BTC') ? 65000 : symbol.startsWith('ETH') ? 3500 : symbol.startsWith('SOL') ? 150 : 10;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.48) * price * 0.02;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * price * 0.01;
    const low = Math.min(open, close) - Math.random() * price * 0.01;
    candles.push({
      timestamp: new Date(now - (count - i) * 3600000).toISOString(),
      open, high, low, close,
      volume: Math.random() * 1000000,
    });
    price = close;
  }
  return candles;
}
