// ============================================================
// TradingView TA Crawler — Research Agent Integration
// Scans all Binance perpetuals on TV for BUY/SELL/NEUTRAL consensus.
// Stores results as research items for strategy extraction.
// ============================================================

import { fetchTvAnalysis } from '../tradingview-ta.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { storeResearchItem } from '../ml/researchAgent.js';

const INTERVAL = '15m';
const BATCH_SIZE = 10;
const DELAY_MS = 1200; // Respect TV rate limits

export async function crawlTradingViewForAllPairs() {
  const pairs = config.DEFAULT_PAIRS || [];
  let scanned = 0;
  let stored = 0;

  logger.info(`[TV-CRAWLER] Starting scan of ${pairs.length} pairs…`);

  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (pair) => {
        const symbol = pair.replace('/', '');
        try {
          const tv = await fetchTvAnalysis(symbol, 'BINANCE', INTERVAL);
          return { symbol, tv };
        } catch (e) {
          return { symbol, error: e.message };
        }
      })
    );

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const { symbol, tv, error } = r.value;
      scanned++;
      if (error) {
        logger.debug(`[TV-CRAWLER] ${symbol} failed: ${error}`);
        continue;
      }
      if (!tv || tv.overall === 'neutral') continue;

      const content = `
TradingView technical analysis for ${symbol} (${INTERVAL}):
Overall recommendation: ${tv.overall.toUpperCase()}.
Oscillator score: ${tv.oscillator || 'N/A'}.
MA score: ${tv.ma || 'N/A'}.
Key levels — RSI: ${tv.rsi?.toFixed(1) || 'N/A'}, MACD: ${tv.macd?.toFixed(4) || 'N/A'}, ADX: ${tv.adx?.toFixed(1) || 'N/A'}.
EMA alignment: ${tv.ema10 > tv.ema20 ? 'bullish' : 'bearish'} (EMA10=${tv.ema10?.toFixed(2)||'N/A'} vs EMA20=${tv.ema20?.toFixed(2)||'N/A'}).
      `.trim();

      try {
        await storeResearchItem({
          sourceName: 'tradingview_ta_scanner',
          sourceUrl: `https://www.tradingview.com/symbols/BINANCE-${symbol}/`,
          content,
        });
        stored++;
      } catch (e) {
        logger.warn(`[TV-CRAWLER] Store failed for ${symbol}: ${e.message}`);
      }
    }

    if (i + BATCH_SIZE < pairs.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  logger.info(`[TV-CRAWLER] Done — scanned=${scanned}, stored=${stored}`);
  return { scanned, stored };
}
