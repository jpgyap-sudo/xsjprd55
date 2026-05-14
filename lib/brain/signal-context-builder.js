// ============================================================
// Signal Context Builder — Gathers market, liquidation, and
// news context in parallel for a given symbol+timeframe.
// ============================================================

import { getMarketSnapshot } from './market-memory.js';
import { getLiquidationContext } from './liquidation-agent.js';
import { getNewsSentiment } from './news-sentiment-agent.js';

/**
 * Build the full signal context by fetching market, liquidation,
 * and news data in parallel.
 */
export async function buildSignalContext({ symbol, timeframe, mode }) {
  const [market, liquidation, news] = await Promise.all([
    getMarketSnapshot({ symbol, timeframe }),
    getLiquidationContext({ symbol, timeframe }),
    getNewsSentiment({ symbol })
  ]);

  return {
    symbol,
    timeframe,
    mode: mode || 'paper',
    market,
    liquidation,
    news,
    freshness: {
      market_age_seconds: market?.data?.fetched_at
        ? (Date.now() - new Date(market.data.fetched_at).getTime()) / 1000
        : Infinity
    },
    fetched_at: new Date().toISOString()
  };
}
