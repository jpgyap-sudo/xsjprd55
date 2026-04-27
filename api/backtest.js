// ============================================================
// Backtest API — Full Engine with Probability Scoring
// GET /api/backtest?symbol=BTCUSDT&strategy=ema_cross&timeframe=1h&days=30
// POST /api/backtest  (body: { symbol, strategy, timeframe, days, leverage, stopLossPct, takeProfitPct })
// ============================================================

import { createExchange } from '../lib/trading.js';
import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { calculateProbability } from '../lib/scoring/probability-engine.js';
import { simulateTrade, runBacktest, optimizeRiskSettings } from '../lib/backtest/backtest-engine.js';

const STRATEGIES = {
  ema_cross: runEmaCross,
  rsi_bounce: runRsiBounce,
};

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const symbol = (req.query?.symbol || body.symbol || 'BTC/USDT').toUpperCase();
  const strategy = req.query?.strategy || body.strategy || 'ema_cross';
  const timeframe = req.query?.timeframe || body.timeframe || '1h';
  const days = Number(req.query?.days || body.days || 30);
  const initialCapital = Number(req.query?.capital || body.capital || 1000);
  const leverage = Number(req.query?.leverage || body.leverage || 1);
  const stopLossPct = Number(req.query?.stopLossPct || body.stopLossPct || 1.2);
  const takeProfitPct = Number(req.query?.takeProfitPct || body.takeProfitPct || 2.5);
  const optimize = (req.query?.optimize || body.optimize || 'false') === 'true';

  if (!STRATEGIES[strategy]) {
    return res.status(400).json({ error: `Unknown strategy: ${strategy}. Choose: ${Object.keys(STRATEGIES).join(', ')}` });
  }

  try {
    const ex = createExchange('binance');
    const since = ex.milliseconds() - days * 24 * 60 * 60 * 1000;
    const ohlcv = await ex.fetchOHLCV(symbol, timeframe, since);

    if (!ohlcv || ohlcv.length < 50) {
      return res.status(400).json({ error: 'Not enough historical data for backtest.' });
    }

    // Build probability scores from available context
    const { data: liqRow } = await supabase
      .from('liquidation_heatmaps').select('*').eq('symbol', symbol.replace('/', '')).order('created_at', { ascending: false }).limit(1).single();
    const { data: oiRow } = await supabase
      .from('open_interest_snapshots').select('*').eq('symbol', symbol.replace('/', '')).order('created_at', { ascending: false }).limit(1).single();

    const scores = {
      market: 55,
      liquidation: liqRow ? (liqRow.confidence_score || 50) : 50,
      social: 50,
      fundingOi: oiRow ? computeOiFundingScore(oiRow) : 50,
      liquidity: 55,
      strategyHistory: 50,
    };

    const probability = calculateProbability(scores, { sampleSize: 0, dataQuality: 70 });

    // Run strategy backtest
    const result = STRATEGIES[strategy](ohlcv, initialCapital, { leverage, stopLossPct, takeProfitPct });

    // Optionally optimize risk settings for the last signal
    let optimized = null;
    if (optimize && result.trades.length) {
      const lastSignal = result.trades[result.trades.length - 1];
      const forwardCandles = ohlcv.slice(-50).map(c => ({ open: c[1], high: c[2], low: c[3], close: c[4], time: c[0] }));
      optimized = optimizeRiskSettings({
        signal: { price: lastSignal.entryPrice, side: lastSignal.side },
        candles: forwardCandles,
      });
    }

    // Save backtest run
    await supabase.from('backtest_runs').insert({
      strategy_name: strategy,
      symbol,
      timeframe,
      total_trades: result.totalTrades,
      win_rate: result.winRate,
      profit_factor: result.profitFactor,
      max_drawdown: result.maxDrawdownPct,
      avg_pnl: result.avgPnl,
      best_leverage: optimized?.leverage,
      best_stop_loss: optimized?.stopLossPct,
      best_take_profit: optimized?.takeProfitPct,
      config: { leverage, stopLossPct, takeProfitPct, days, initialCapital },
    });

    logger.info(`[BACKTEST] ${strategy} ${symbol} ${timeframe} ${days}d — return=${result.totalReturnPct}% trades=${result.totalTrades}`);
    return res.status(200).json({
      symbol,
      strategy,
      timeframe,
      days,
      initialCapital,
      probability,
      optimized,
      ...result,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`[BACKTEST] ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}

// ── Strategies ──────────────────────────────────────────────
function runEmaCross(ohlcv, initialCapital, riskConfig) {
  const closes = ohlcv.map(c => c[4]);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);

  let capital = initialCapital;
  let position = null;
  const trades = [];

  for (let i = 26; i < ohlcv.length; i++) {
    const price = closes[i];
    const prevDiff = ema12[i - 1] - ema26[i - 1];
    const currDiff = ema12[i] - ema26[i];

    if (!position && prevDiff <= 0 && currDiff > 0) {
      position = { side: 'long', entryIndex: i, entryPrice: price };
    } else if (position && position.side === 'long' && prevDiff >= 0 && currDiff < 0) {
      const result = simulateTrade({
        signal: { price: position.entryPrice, side: position.side },
        candles: ohlcv.slice(position.entryIndex, i + 1).map(c => ({ open: c[1], high: c[2], low: c[3], close: c[4], time: c[0] })),
        leverage: riskConfig.leverage,
        stopLossPct: riskConfig.stopLossPct,
        takeProfitPct: riskConfig.takeProfitPct,
        positionSizeUsd: capital,
      });
      capital += result.pnlUsd;
      trades.push({ side: 'long', entryPrice: position.entryPrice, exitPrice: result.exitPrice, pnlPct: result.pnlPct, pnlUsd: result.pnlUsd, result: result.result, exitReason: result.exitReason, exitTime: result.exitTime });
      position = null;
    }
  }

  return summarize(trades, capital, initialCapital, ohlcv);
}

function runRsiBounce(ohlcv, initialCapital, riskConfig) {
  const closes = ohlcv.map(c => c[4]);
  const rsiValues = rsi(closes, 14);

  let capital = initialCapital;
  let position = null;
  const trades = [];

  for (let i = 14; i < ohlcv.length; i++) {
    const price = closes[i];
    const r = rsiValues[i];
    const prevR = rsiValues[i - 1];

    if (!position && prevR < 30 && r >= 30) {
      position = { side: 'long', entryIndex: i, entryPrice: price };
    } else if (position && position.side === 'long' && prevR > 70 && r <= 70) {
      const result = simulateTrade({
        signal: { price: position.entryPrice, side: position.side },
        candles: ohlcv.slice(position.entryIndex, i + 1).map(c => ({ open: c[1], high: c[2], low: c[3], close: c[4], time: c[0] })),
        leverage: riskConfig.leverage,
        stopLossPct: riskConfig.stopLossPct,
        takeProfitPct: riskConfig.takeProfitPct,
        positionSizeUsd: capital,
      });
      capital += result.pnlUsd;
      trades.push({ side: 'long', entryPrice: position.entryPrice, exitPrice: result.exitPrice, pnlPct: result.pnlPct, pnlUsd: result.pnlUsd, result: result.result, exitReason: result.exitReason, exitTime: result.exitTime });
      position = null;
    }
  }

  return summarize(trades, capital, initialCapital, ohlcv);
}

// ── Indicators ──────────────────────────────────────────────
function ema(data, period) {
  const k = 2 / (period + 1);
  let e = data[0];
  const out = [e];
  for (let i = 1; i < data.length; i++) {
    e = data[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

function rsi(closes, period = 14) {
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

// ── Summary ─────────────────────────────────────────────────
function summarize(trades, finalCapital, initialCapital, ohlcv) {
  const wins = trades.filter(t => t.result === 'win');
  const losses = trades.filter(t => t.result === 'loss');
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;

  let maxDrawdown = 0;
  let peak = initialCapital;
  let running = initialCapital;
  for (const t of trades) {
    running += t.pnlUsd;
    if (running > peak) peak = running;
    const dd = (peak - running) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const equityCurve = [];
  let eq = initialCapital;
  for (const t of trades) {
    eq += t.pnlUsd;
    equityCurve.push({ ts: t.exitTime, equity: eq });
  }

  const totalPnl = trades.reduce((s, t) => s + t.pnlUsd, 0);

  return {
    totalReturnPct: ((finalCapital - initialCapital) / initialCapital) * 100,
    finalCapital,
    totalTrades: trades.length,
    winRate,
    avgWinPct: wins.length ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0,
    avgLossPct: losses.length ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0,
    maxDrawdownPct: maxDrawdown * 100,
    profitFactor: losses.length ? wins.reduce((s, t) => s + t.pnlUsd, 0) / Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0)) : 0,
    avgPnl: trades.length ? totalPnl / trades.length : 0,
    trades,
    equityCurve,
    candleCount: ohlcv.length,
  };
}

function computeOiFundingScore(oi) {
  if (!oi) return 50;
  let score = 50;
  if (oi.funding_rate > 0.01) score -= 10;
  if (oi.funding_rate < -0.01) score += 10;
  return Math.min(100, Math.max(0, score));
}
