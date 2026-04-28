// ============================================================
// LunarCrush API Endpoint
// GET /api/lunarcrush?symbol=BTC&limit=20
// Returns social metrics + computed analysis for a coin or top list.
// ============================================================

import {
  getCoinData,
  getTopCoins,
  getCoinTimeSeries,
  analyzeSocialMetrics
} from '../lib/lunarcrush.js';
import { createExchange } from '../lib/trading.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const symbol = req.query?.symbol;
  const limit  = Math.min(Number(req.query?.limit || 20), 50);
  const withMarket = req.query?.market !== 'false';

  try {
    // Single coin deep-dive
    if (symbol) {
      const coin = await getCoinData(symbol);
      if (!coin) {
        return res.status(404).json({ error: `Coin not found: ${symbol}` });
      }

      const analysis = analyzeSocialMetrics(coin);
      let market = null;
      let timeSeries = null;

      if (withMarket) {
        try {
          const exchange = createExchange('binance', { options: { defaultType: 'future' } });
          const pair = `${coin.symbol}/USDT`;
          const ohlcv = await exchange.fetchOHLCV(pair, '1h', undefined, 24);
          if (ohlcv?.length) {
            const latest = ohlcv[ohlcv.length - 1];
            market = {
              pair,
              timestamp: new Date(latest[0]).toISOString(),
              open: latest[1],
              high: latest[2],
              low: latest[3],
              close: latest[4],
              volume: latest[5],
              change_24h: ((latest[4] - ohlcv[0][1]) / ohlcv[0][1] * 100).toFixed(2)
            };
          }
        } catch (mErr) {
          market = { error: mErr.message };
        }
      }

      try {
        timeSeries = await getCoinTimeSeries(coin.symbol, '1d', 14);
      } catch (tsErr) {
        timeSeries = [];
      }

      return res.status(200).json({
        coin,
        analysis,
        market,
        timeSeries,
        generated_at: new Date().toISOString()
      });
    }

    // Top coins leaderboard
    const coins = await getTopCoins(limit);
    const enriched = coins.map(c => {
      const a = analyzeSocialMetrics(c);
      return { ...c, analysis: { overall: a.overall, score: a.score, summary: a.summary } };
    });

    return res.status(200).json({
      coins: enriched,
      count: enriched.length,
      generated_at: new Date().toISOString()
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message,
      generated_at: new Date().toISOString()
    });
  }
}
