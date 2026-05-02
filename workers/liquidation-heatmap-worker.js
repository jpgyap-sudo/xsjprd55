// ============================================================
// Liquidation Heatmap Worker
// Fetches liquidation cluster data and saves to Supabase.
// Runs every 5 minutes.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { fetchWithFallback } from '../lib/fetch-with-fallback.js';
import { estimateProbableDirection, buildHeatmapResponse } from '../lib/liquidation-engine.js';
import { crawlLiquidationHeatmap } from '../crawler/playwright-crawler.js';
import { isMainModule } from '../lib/entrypoint.js';

const SYMBOLS = config.DEFAULT_PAIRS.map(p => p.replace('/', ''));
const INTERVAL_MS = 5 * 60 * 1000;

async function fetchJson(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function fetchLiquidationFromAPI(symbol) {
  // Use Binance public futures API directly (no auth needed)
  const url = `https://fapi.binance.com/fapi/v1/forceOrders?symbol=${symbol}&limit=100`;
  const orders = await fetchJson(url, 7000);
  const longLiqs = [];
  const shortLiqs = [];
  for (const o of (orders || [])) {
    const vol = Number(o.executedQty || 0) * Number(o.avgPrice || 0);
    const item = { price: Number(o.avgPrice || 0), estimatedVolume: vol };
    if (o.side === 'SELL') longLiqs.push(item); // SELL liquidation = longs getting rekt
    else shortLiqs.push(item);
  }
  return { longLiquidations: longLiqs, shortLiquidations: shortLiqs };
}

export async function runLiquidationHeatmapWorker() {
  if (!config.ENABLE_LIQUIDATION_WORKER) {
    logger.debug('[LIQ-WORKER] Disabled by config');
    return;
  }

  for (const symbol of SYMBOLS) {
    try {
      const result = await fetchWithFallback({
        source: 'binance',
        dataType: 'liquidation',
        apiFn: () => fetchLiquidationFromAPI(symbol),
        crawlerFn: () => crawlLiquidationHeatmap(symbol),
      });

      if (!result.data) {
        logger.warn(`[LIQ-WORKER] No data for ${symbol}`);
        continue;
      }

      const { longLiquidations, shortLiquidations } = result.data;

      // Fetch latest price for context
      let currentPrice = null;
      try {
        const ex = createExchange('binance');
        const ticker = await ex.fetchTicker(symbol.replace('USDT', '/USDT'));
        currentPrice = ticker.last;
      } catch (_) {}

      // Fetch latest OI snapshot for trend
      let oiTrend = 'flat';
      let fundingRate = 0;
      try {
        const { data: oiRow } = await supabase
          .from('open_interest_snapshots')
          .select('open_interest, funding_rate')
          .eq('symbol', symbol)
          .eq('exchange', 'binance')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (oiRow) {
          fundingRate = oiRow.funding_rate || 0;
          // Compare with previous snapshot for trend
          const { data: prev } = await supabase
            .from('open_interest_snapshots')
            .select('open_interest')
            .eq('symbol', symbol)
            .eq('exchange', 'binance')
            .order('created_at', { ascending: false })
            .limit(1)
            .offset(1)
            .single();
          if (prev && oiRow.open_interest > prev.open_interest) oiTrend = 'rising';
          else if (prev && oiRow.open_interest < prev.open_interest) oiTrend = 'falling';
        }
      } catch (_) {}

      const direction = estimateProbableDirection({
        currentPrice,
        longLiquidations,
        shortLiquidations,
        oiTrend,
        fundingRate,
      });

      const heatmap = buildHeatmapResponse({
        symbol,
        currentPrice,
        longLiquidations,
        shortLiquidations,
        probableDirection: direction.probableDirection,
        confidence: direction.confidence,
        dataSource: result.source,
        fallbackUsed: result.fallbackUsed,
      });

      await supabase.from('liquidation_heatmaps').insert({
        symbol,
        exchange: 'binance',
        timeframe: '5m',
        current_price: currentPrice,
        heatmap_data: heatmap,
        long_liquidation_levels: longLiquidations,
        short_liquidation_levels: shortLiquidations,
        probable_direction: direction.probableDirection,
        confidence_score: direction.confidence,
        data_source: result.method,
        fallback_used: result.fallbackUsed,
      });

      logger.info(`[LIQ-WORKER] ${symbol} direction=${direction.probableDirection} confidence=${direction.confidence}`);
    } catch (err) {
      logger.error(`[LIQ-WORKER] ${symbol} error: ${err.message}`);
    }
  }
}

if (isMainModule(import.meta.url)) {
  logger.info('[LIQ-WORKER] Starting loop...');
  await runLiquidationHeatmapWorker();
  setInterval(runLiquidationHeatmapWorker, INTERVAL_MS);
}
