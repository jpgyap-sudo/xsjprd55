// ============================================================
// OHLCV Web Crawler Fallback
// Used when CCXT exchange APIs fail.
// Sources: Binance public klines → Hyperliquid candles → CoinGecko
// No API keys required for any source.
// ============================================================

import { logger } from './logger.js';

// ---------- Helpers ----------
async function fetchJson(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Normalize symbol for Binance (BTC/USDT → BTCUSDT)
function binanceSymbol(symbol) {
  return symbol.replace('/', '').replace('-', '');
}

// Convert timeframe to Binance interval string
function binanceInterval(tf) {
  const map = {
    '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '8h': '8h', '12h': '12h',
    '1d': '1d', '3d': '3d', '1w': '1w', '1M': '1M'
  };
  return map[tf] || '1h';
}

// ---------- Binance Public Klines (best free fallback) ----------
async function fetchBinanceKlines(symbol, timeframe, limit = 100) {
  const sym = binanceSymbol(symbol);
  const interval = binanceInterval(timeframe);
  const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;

  const data = await fetchJson(url, {}, 7000);
  // Binance klines format: [openTime, open, high, low, close, volume, closeTime, ...]
  return data.map(c => [
    c[0],             // timestamp
    parseFloat(c[1]), // open
    parseFloat(c[2]), // high
    parseFloat(c[3]), // low
    parseFloat(c[4]), // close
    parseFloat(c[5]), // volume
  ]);
}

// ---------- Hyperliquid Candle Snapshot ----------
async function fetchHyperliquidCandles(symbol, timeframe, limit = 100) {
  // Map CCXT timeframes to Hyperliquid granularity (seconds)
  const granularityMap = {
    '1m': 60, '5m': 300, '15m': 900, '1h': 3600,
    '4h': 14400, '1d': 86400, '1w': 604800
  };
  const granularity = granularityMap[timeframe] || 3600;
  const coin = symbol.replace('/USDT', '').replace('/USD', '').replace('-USD', '');

  const endTime = Date.now();
  const startTime = endTime - (limit * granularity * 1000);

  const data = await fetchJson('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      req: { coin, startTime, endTime, granularity }
    })
  }, 7000);

  if (!Array.isArray(data)) throw new Error('Invalid Hyperliquid response');

  // Hyperliquid candle format: { t: timestamp, T: closeTime, o: open, h: high, l: low, c: close, v: volume, n: trades }
  return data.map(c => [
    c.t || c.T,
    parseFloat(c.o),
    parseFloat(c.h),
    parseFloat(c.l),
    parseFloat(c.c),
    parseFloat(c.v),
  ]);
}

// ---------- CoinGecko Market Chart (last resort) ----------
// Maps common symbols to CoinGecko coin IDs
const COINGECKO_ID_MAP = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'BNB': 'binancecoin',
  'XRP': 'ripple', 'DOGE': 'dogecoin', 'ADA': 'cardano', 'AVAX': 'avalanche-2',
  'DOT': 'polkadot', 'MATIC': 'matic-network', 'LINK': 'chainlink',
  'LTC': 'litecoin', 'BCH': 'bitcoin-cash', 'ETC': 'ethereum-classic',
  'UNI': 'uniswap', 'ATOM': 'cosmos', 'XLM': 'stellar', 'ALGO': 'algorand',
  'VET': 'vechain', 'FIL': 'filecoin', 'TRX': 'tron', 'NEAR': 'near',
  'APT': 'aptos', 'ARB': 'arbitrum', 'OP': 'optimism', 'SUI': 'sui',
  'PEPE': 'pepe', 'SHIB': 'shiba-inu', 'FLOKI': 'floki', 'BONK': 'bonk',
  'WLD': 'worldcoin-wld', 'HYPE': 'hyperliquid'
};

function getCoinGeckoId(symbol) {
  const base = symbol.replace('/USDT', '').replace('/USD', '').replace('-USD', '').split('/')[0];
  return COINGECKO_ID_MAP[base.toUpperCase()];
}

async function fetchCoinGeckoOHLCV(symbol, _timeframe, limit = 100) {
  const id = getCoinGeckoId(symbol);
  if (!id) throw new Error(`No CoinGecko ID mapping for ${symbol}`);

  // CoinGecko free tier: /market_chart gives hourly data for 1 day
  const days = Math.max(1, Math.ceil(limit / 24));
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`;

  const data = await fetchJson(url, {}, 10000);
  const prices = data.prices || [];       // [[timestamp, price], ...]
  const volumes = data.total_volumes || []; // [[timestamp, volume], ...]

  if (!prices.length) throw new Error('No price data from CoinGecko');

  // CoinGecko returns ~hourly points. We need to fabricate OHLCV from price points
  // by grouping into chunks that approximate candles.
  const candles = [];
  const chunkSize = Math.max(1, Math.floor(prices.length / limit));

  for (let i = 0; i < prices.length; i += chunkSize) {
    const chunk = prices.slice(i, i + chunkSize);
    if (!chunk.length) continue;

    const open = chunk[0][1];
    const close = chunk[chunk.length - 1][1];
    const high = Math.max(...chunk.map(p => p[1]));
    const low = Math.min(...chunk.map(p => p[1]));
    const timestamp = chunk[0][0];
    const volEntry = volumes.find(v => Math.abs(v[0] - timestamp) < 3600000);
    const volume = volEntry ? volEntry[1] : 0;

    candles.push([timestamp, open, high, low, close, volume]);
  }

  return candles.slice(-limit);
}

// ---------- Main Fallback Router ----------
/**
 * Fetch OHLCV with automatic web fallback when CCXT fails.
 * @param {string} symbol      e.g. 'BTC/USDT'
 * @param {string} timeframe   e.g. '1h'
 * @param {number} limit       Number of candles
 * @returns {Promise<Array>}   CCXT-format OHLCV array
 */
export async function fetchOHLCVWithFallback(symbol, timeframe, limit = 100) {
  const sources = [
    { name: 'binance_public', fn: () => fetchBinanceKlines(symbol, timeframe, limit) },
    { name: 'hyperliquid', fn: () => fetchHyperliquidCandles(symbol, timeframe, limit) },
    { name: 'coingecko', fn: () => fetchCoinGeckoOHLCV(symbol, timeframe, limit) },
  ];

  let lastError;
  for (const source of sources) {
    try {
      logger.info(`[CRAWLER-OHLCV] Trying ${source.name} for ${symbol} ${timeframe}`);
      const data = await source.fn();
      if (data && data.length > 0) {
        logger.info(`[CRAWLER-OHLCV] ${source.name} success: ${data.length} candles for ${symbol}`);
        return { data, source: source.name };
      }
    } catch (err) {
      logger.warn(`[CRAWLER-OHLCV] ${source.name} failed: ${err.message}`);
      lastError = err;
    }
    // Small delay between sources to avoid rate limits
    await sleep(500);
  }

  throw new Error(`All OHLCV fallbacks failed for ${symbol} ${timeframe}. Last error: ${lastError?.message}`);
}
