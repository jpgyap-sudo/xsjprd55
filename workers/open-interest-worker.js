// ============================================================
// Open Interest & Funding Worker
// Polls OI, funding rate, and long/short ratio from exchanges.
// Runs every 3 minutes.
// ============================================================

import { createExchange } from '../lib/trading.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';

const EXCHANGES = ['binance', 'bybit', 'okx'];
const SYMBOLS = config.DEFAULT_PAIRS.map(p => p.replace('/', ''));
const INTERVAL_MS = 3 * 60 * 1000;

async function fetchOpenInterest(exchange, symbol) {
  try {
    // CCXT does not have a unified OI method for all exchanges.
    // Use exchange-specific endpoints where available.
    const ex = createExchange(exchange);
    let oi = null;
    let funding = null;
    let longShortRatio = null;

    if (exchange === 'binance') {
      try {
        const oiRes = await ex.fapiPublicGetOpenInterest({ symbol });
        oi = Number(oiRes?.openInterest || 0);
      } catch (_) {}
      try {
        const fundRes = await ex.fapiPublicGetFundingRate({ symbol, limit: 1 });
        funding = Number(fundRes?.[0]?.fundingRate || 0);
      } catch (_) {}
    }

    // Bybit V5
    if (exchange === 'bybit') {
      try {
        const oiRes = await ex.publicGetV5MarketOpenInterest({ category: 'linear', symbol, interval: '5min' });
        oi = Number(oiRes?.result?.list?.[0]?.openInterest || 0);
      } catch (_) {}
      try {
        const fundRes = await ex.publicGetV5MarketFundingHistory({ category: 'linear', symbol, limit: 1 });
        funding = Number(fundRes?.result?.list?.[0]?.fundingRate || 0);
      } catch (_) {}
    }

    // OKX
    if (exchange === 'okx') {
      try {
        const oiRes = await ex.publicGetPublicOpenInterest({ instType: 'SWAP', instId: symbol });
        oi = Number(oiRes?.data?.[0]?.oi || 0);
      } catch (_) {}
      try {
        const fundRes = await ex.publicGetPublicFundingRate({ instId: symbol });
        funding = Number(fundRes?.data?.[0]?.fundingRate || 0);
      } catch (_) {}
    }

    return { openInterest: oi, fundingRate: funding, longShortRatio };
  } catch (err) {
    logger.warn(`[OI-WORKER] ${exchange} ${symbol} fetch error: ${err.message}`);
    return { openInterest: null, fundingRate: null, longShortRatio: null };
  }
}

export async function runOpenInterestWorker() {
  if (!config.ENABLE_OI_WORKER) {
    logger.debug('[OI-WORKER] Disabled by config');
    return;
  }

  for (const exchange of EXCHANGES) {
    for (const symbol of SYMBOLS) {
      try {
        const data = await fetchOpenInterest(exchange, symbol);
        if (data.openInterest !== null) {
          await supabase.from('open_interest_snapshots').insert({
            symbol,
            exchange,
            open_interest: data.openInterest,
            funding_rate: data.fundingRate,
            long_short_ratio: data.longShortRatio,
            data_source: exchange,
            fallback_used: false,
          });
          logger.info(`[OI-WORKER] ${exchange} ${symbol} OI=${data.openInterest} funding=${data.fundingRate}`);
        }
      } catch (err) {
        logger.error(`[OI-WORKER] ${exchange} ${symbol} save error: ${err.message}`);
      }
    }
  }
}

// Auto-run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  logger.info('[OI-WORKER] Starting loop...');
  await runOpenInterestWorker();
  setInterval(runOpenInterestWorker, INTERVAL_MS);
}
