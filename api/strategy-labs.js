// ============================================================
// API: Strategy Labs Dashboard (Enhanced with Assello extensions)
// GET  /api/strategy-labs                    — mock stats + ML model + rankings
// GET  /api/strategy-labs?action=rank        — full strategy ranking
// POST /api/strategy-labs                    — run strategies against input
// POST /api/strategy-labs?action=backtest    — run backtest on candle data
// ============================================================

import { runStrategyLab, STRATEGIES } from '../lib/ml/strategies.js';
import { runResearchStrategyLab } from '../lib/ml/dynamicStrategies.js';
import { getMockDashboard, openMockTrades } from '../lib/ml/mockTrader.js';
import { getPromotedStrategies } from '../lib/ml/feedbackLoop.js';
import { loadActiveModel } from '../lib/ml/model.js';
import { rankAllStrategies } from '../lib/ml/strategyEvaluator.js';
import { backtestAllStrategies, backtestDynamicStrategy, storeBacktestResult } from '../lib/ml/backtestEngine.js';
import { initMlDb } from '../lib/ml/db.js';

export default async function handler(req, res) {
  initMlDb();

  const action = req.query?.action || '';

  // ── GET /api/strategy-labs?action=rank ──────────────────────
  if (req.method === 'GET' && action === 'rank') {
    const ranked = rankAllStrategies();
    return res.status(200).json({ ranked, ts: new Date().toISOString() });
  }

  // ── POST /api/strategy-labs?action=backtest ─────────────────
  if (req.method === 'POST' && action === 'backtest') {
    const body = req.body || {};
    const { candles = [], symbol = 'BTCUSDT', proposalId } = body;

    if (!Array.isArray(candles) || candles.length < 20) {
      return res.status(400).json({ error: 'candles array required (min 20)' });
    }

    let results;
    if (proposalId) {
      const result = backtestDynamicStrategy(proposalId, candles, symbol);
      if (result) storeBacktestResult(result, symbol);
      results = [result];
    } else {
      results = backtestAllStrategies(candles, symbol);
      for (const r of results) storeBacktestResult(r, symbol);
    }

    return res.status(200).json({
      symbol,
      candleCount: candles.length,
      results,
      ts: new Date().toISOString(),
    });
  }

  // ── GET /api/strategy-labs ──────────────────────────────────
  if (req.method === 'GET') {
    const { symbol = 'BTCUSDT', price = 0, action: getAction } = req.query || {};

    if (getAction === 'open') {
      if (!price || price <= 0) {
        return res.status(400).json({ error: 'price required' });
      }
      const input = {
        symbol,
        timeframe: '1h',
        price: Number(price),
        side: 'LONG',
        fundingRate: 0,
        openInterestChangePct: 0,
        liquidationImbalance: 0,
        totalLiquidationsUsd: 0,
        volumeChangePct: 0,
        volatilityPct: 1.5,
        socialSentiment: 0,
        newsSentiment: 0,
        btcTrendScore: 0,
        whaleFlowScore: 0,
        spreadBps: 10,
      };
      const trades = openMockTrades(input, 3);
      return res.status(200).json({ opened: trades.length, trades });
    }

    const mock = getMockDashboard();
    const promoted = getPromotedStrategies();
    const model = loadActiveModel();
    const ranked = rankAllStrategies();

    return res.status(200).json({
      mock,
      promotedStrategies: promoted,
      rankedStrategies: ranked.slice(0, 10),
      mlModel: model ? { name: model.modelName, version: model.version, metrics: model.metrics } : null,
      strategies: Object.keys(STRATEGIES),
      ts: new Date().toISOString(),
    });
  }

  // ── POST /api/strategy-labs ─────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    const { symbol = 'BTCUSDT', price = 0, features = {} } = body;

    const input = {
      symbol,
      timeframe: '1h',
      price: Number(price),
      side: 'LONG',
      fundingRate: features.funding_rate ?? 0,
      openInterestChangePct: features.open_interest_change_pct ?? 0,
      liquidationImbalance: features.liquidation_imbalance ?? 0,
      totalLiquidationsUsd: features.total_liquidations_usd ?? 0,
      volumeChangePct: features.volume_change_pct ?? 0,
      volatilityPct: features.volatility_pct ?? 1.5,
      socialSentiment: features.social_sentiment ?? 0,
      newsSentiment: features.news_sentiment ?? 0,
      btcTrendScore: features.btc_trend_score ?? 0,
      whaleFlowScore: features.whale_flow_score ?? 0,
      spreadBps: features.spread_bps ?? 10,
    };

    const builtin = runStrategyLab(input);
    const dynamic = runResearchStrategyLab(input);
    const all = [...builtin, ...dynamic];

    return res.status(200).json({
      symbol,
      price,
      decisions: all,
      count: all.length,
      ts: new Date().toISOString(),
    });
  }

  res.status(405).send('Method Not Allowed');
}
