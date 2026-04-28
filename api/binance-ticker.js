// ============================================================
// Binance 24h Ticker Proxy — /api/binance-ticker
// Proxies Binance 24h ticker API to bypass browser CORS.
// Returns top movers from all USDT perpetual pairs.
// ============================================================

import { config } from '../lib/config.js';

const BINANCE_TICKER_URL = 'https://api.binance.com/api/v3/ticker/24hr';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const limit = Math.min(200, parseInt(req.query.limit || '70', 10));
  const sortBy = req.query.sort || 'absChange'; // absChange, volume, price

  try {
    const response = await fetch(BINANCE_TICKER_URL, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return res.status(502).json({ ok: false, error: `Binance API returned ${response.status}` });
    }

    const data = await response.json();

    // Filter USDT perpetuals (no underscore, ends with USDT)
    const perps = data.filter(t => {
      const sym = t.symbol;
      return sym.endsWith('USDT') && !sym.includes('_') && !sym.includes('UP') && !sym.includes('DOWN');
    });

    // Sort
    let sorted;
    if (sortBy === 'absChange') {
      sorted = perps.sort((a, b) => Math.abs(Number(b.priceChangePercent)) - Math.abs(Number(a.priceChangePercent)));
    } else if (sortBy === 'volume') {
      sorted = perps.sort((a, b) => Number(b.volume) * Number(b.lastPrice) - Number(a.volume) * Number(a.lastPrice));
    } else {
      sorted = perps.sort((a, b) => Number(b.lastPrice) - Number(a.lastPrice));
    }

    const sliced = sorted.slice(0, limit);

    const result = sliced.map(t => ({
      symbol: t.symbol,
      price: Number(t.lastPrice),
      changePct: Number(t.priceChangePercent),
      volume: Number(t.volume),
      volumeQuote: Number(t.quoteVolume),
      high: Number(t.highPrice),
      low: Number(t.lowPrice),
    }));

    return res.status(200).json({
      ok: true,
      count: result.length,
      totalPairs: perps.length,
      data: result,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
