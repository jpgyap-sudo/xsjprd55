// ============================================================
// CCXT Multi-Exchange Wrapper — xsjprd55
// Read-only keys recommended. Supports Binance, Bybit, OKX.
// ============================================================

import ccxt from 'ccxt';

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
  }
};

export function createExchange(exchangeId = 'binance', overrides = {}) {
  const cfg = EXCHANGE_CONFIGS[exchangeId.toLowerCase()];
  if (!cfg) throw new Error(`Unsupported exchange: ${exchangeId}`);

  const config = {
    enableRateLimit: true,
    ...cfg.opts,
    ...overrides
  };

  const apiKey = process.env[cfg.keyEnv];
  const secret = process.env[cfg.secretEnv];
  if (apiKey && secret) {
    config.apiKey = apiKey;
    config.secret = secret;
  }

  if (cfg.passphraseEnv && process.env[cfg.passphraseEnv]) {
    config.password = process.env[cfg.passphraseEnv];
  }

  const ExchangeClass = ccxt[exchangeId.toLowerCase()];
  if (!ExchangeClass) throw new Error(`CCXT does not support exchange: ${exchangeId}`);

  const exchange = new ExchangeClass(config);
  return exchange;
}

export async function fetchOHLCV(exchangeId, symbol, timeframe, limit = 100) {
  const ex = createExchange(exchangeId);
  const ohlcv = await ex.fetchOHLCV(symbol, timeframe, undefined, limit);
  return ohlcv;
}
