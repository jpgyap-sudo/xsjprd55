// ============================================================
// CCXT Multi-Exchange Wrapper — xsjprd55
// Read-only keys recommended. Supports Binance, Bybit, OKX.
// ============================================================

import ccxt from 'ccxt';
import { fetchOHLCVWithFallback, fetchBinanceKlines } from './crawler-ohlcv.js';
import { logger } from './logger.js';

const EXCHANGE_CONFIGS = {
  binance: {
    keyEnv: 'BINANCE_API_KEY',
    secretEnv: 'BINANCE_API_SECRET',
    opts: { options: { defaultType: 'future' } }
  },
  bybit: {
    keyEnv: 'BYBIT_API_KEY',
    secretEnv: 'BYBIT_API_SECRET',
    opts: { options: { defaultType: 'swap' } }
  },
  okx: {
    keyEnv: 'OKX_API_KEY',
    secretEnv: 'OKX_API_SECRET',
    passphraseEnv: 'OKX_API_PASSPHRASE',
    opts: { options: { defaultType: 'swap' } }
  },
  hyperliquid: {
    keyEnv: null,
    secretEnv: null,
    opts: {}
  }
};

function looksLikeRealKey(val) {
  return val && val.length > 10 && !val.toLowerCase().startsWith('your') && !val.toLowerCase().includes('example');
}

export function createExchange(exchangeId = 'binance', overrides = {}) {
  const cfg = EXCHANGE_CONFIGS[exchangeId.toLowerCase()];
  if (!cfg) throw new Error(`Unsupported exchange: ${exchangeId}`);

  const config = {
    enableRateLimit: true,
    ...cfg.opts,
    ...overrides
  };

  const forcePublic = overrides.apiKey === null || overrides.apiKey === undefined;

  if (!forcePublic && cfg.keyEnv && cfg.secretEnv) {
    const apiKey = process.env[cfg.keyEnv];
    const secret = process.env[cfg.secretEnv];
    if (looksLikeRealKey(apiKey) && looksLikeRealKey(secret)) {
      config.apiKey = apiKey;
      config.secret = secret;
    }
  }

  if (!forcePublic && cfg.passphraseEnv && looksLikeRealKey(process.env[cfg.passphraseEnv])) {
    config.password = process.env[cfg.passphraseEnv];
  }

  const ExchangeClass = ccxt[exchangeId.toLowerCase()];
  if (!ExchangeClass) throw new Error(`CCXT does not support exchange: ${exchangeId}`);

  const exchange = new ExchangeClass(config);
  return exchange;
}

export async function fetchOHLCV(exchangeId, symbol, timeframe, limit = 100) {
  // ── Try public Binance klines FIRST (no API key needed) ──
  if (exchangeId.toLowerCase() === 'binance') {
    try {
      const data = await fetchBinanceKlines(symbol, timeframe, limit);
      if (data && data.length > 0) {
        logger.info(`[EXCHANGE] Fetched ${symbol} ${timeframe} via Binance public klines (${data.length} candles)`);
        return data;
      }
    } catch (pubErr) {
      logger.warn(`[EXCHANGE] Public klines failed: ${pubErr.message}`);
    }
  }

  // ── Fallback: CCXT with real API keys ──
  try {
    const ex = createExchange(exchangeId);
    const ohlcv = await ex.fetchOHLCV(symbol, timeframe, undefined, limit);
    return ohlcv;
  } catch (ccxtError) {
    const msg = ccxtError.message || '';
    if (msg.includes('Invalid Api-Key') || msg.includes('invalid api') || msg.includes('Authentication') || msg.includes('-2015') || msg.includes('-2008')) {
      logger.warn(`[EXCHANGE] API key rejected for ${exchangeId}, trying spot fallback...`);
      try {
        const exPublic = createExchange(exchangeId, {
          apiKey: undefined,
          secret: undefined,
          password: undefined,
          options: { defaultType: 'spot' }
        });
        const ohlcv = await exPublic.fetchOHLCV(symbol, timeframe, undefined, limit);
        return ohlcv;
      } catch (pubErr) {
        logger.warn(`[EXCHANGE] CCXT public spot ${exchangeId} also failed: ${pubErr.message}`);
      }
    }
    logger.warn(`[EXCHANGE] CCXT ${exchangeId} failed for ${symbol} ${timeframe}: ${ccxtError.message}`);
  }

  // ── Last resort: generic web crawler fallback ──
  const { data, source } = await fetchOHLCVWithFallback(symbol, timeframe, limit);
  logger.info(`[EXCHANGE] Fetched ${symbol} ${timeframe} via ${source} fallback (${data.length} candles)`);
  return data;
}
