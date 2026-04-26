// ============================================================
// Market Data Cache — /api/market
// GET : cron-triggered hourly cache refresh
// POST: manual symbol/timeframe override
// ============================================================

import { supabase } from '../lib/supabase.js';
import { fetchOHLCV } from '../lib/exchange.js';

const DEFAULT_PAIRS = ['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','XRP/USDT'];
const TIMEFRAMES = ['1h'];
const DEFAULT_EXCHANGE = process.env.DEFAULT_EXCHANGE || 'binance';

export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isManual = req.method === 'POST';

  // Cron protection: GET requests require x-cron-secret header
  if (!isManual) {
    const cronSecret = process.env.CRON_SECRET;
    const provided = req.headers['x-cron-secret'];
    if (cronSecret && provided !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized cron request' });
    }
  }

  const pairs    = req.body?.pairs || DEFAULT_PAIRS;
  const tfs      = req.body?.timeframes || TIMEFRAMES;
  const exchange = req.body?.exchange || DEFAULT_EXCHANGE;

  const results = { cached: 0, errors: [] };

  try {
    for (const pair of pairs) {
      for (const tf of tfs) {
        try {
          const ohlcv = await fetchOHLCV(exchange, pair, tf, 100);
          if (!ohlcv || !ohlcv.length) continue;

          const rows = ohlcv.map(c => ({
            symbol: pair.replace('/',''),
            exchange,
            timeframe: tf,
            timestamp: new Date(c[0]).toISOString(),
            open: c[1], high: c[2], low: c[3],
            close: c[4], volume: c[5]
          }));

          // Upsert in batches of 50 to avoid payload limits
          for (let i = 0; i < rows.length; i += 50) {
            const batch = rows.slice(i, i + 50);
            const { error } = await supabase.from('market_data').upsert(batch, {
              onConflict: 'symbol,exchange,timeframe,timestamp'
            });
            if (error) throw error;
          }

          results.cached += rows.length;
        } catch (innerErr) {
          results.errors.push({ pair, tf, error: innerErr.message });
        }
      }
    }

    return res.status(200).json({ ok: true, cached: results.cached, errors: results.errors });
  } catch (err) {
    console.error('Market cache fatal error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
