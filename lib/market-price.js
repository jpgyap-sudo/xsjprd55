import fetch from 'node-fetch';
import { config } from './config.js';
import { logger } from './logger.js';

const DEFAULT_SOURCE_ORDER = 'hyperliquid,binance,bybit,okx';

function normalizeSymbol(symbol) {
  const raw = String(symbol || '').trim().toUpperCase();
  const compactInput = raw.replace(/[^A-Z0-9]/g, '');
  const base = compactInput
    .replace(/USDT$/, '')
    .replace(/USDC$/, '')
    .replace(/USD$/, '');
  const compact = compactInput.endsWith('USDT') || compactInput.endsWith('USDC') || compactInput.endsWith('USD')
    ? compactInput
    : `${compactInput}USDT`;

  return {
    raw,
    compact,
    base,
    slash: `${base}/USDT`,
    okxSwap: `${base}-USDT-SWAP`,
  };
}

async function fetchJson(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHyperliquidPrice(symbolInfo) {
  const data = await fetchJson('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' }),
  }, 7000);

  const price = Number(data?.[symbolInfo.base]);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`No Hyperliquid mid for ${symbolInfo.base}`);
  }
  return price;
}

async function fetchBinancePrice(symbolInfo) {
  const data = await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${symbolInfo.compact}`, {}, 7000);
  const price = Number(data?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid Binance price');
  return price;
}

async function fetchBybitPrice(symbolInfo) {
  const data = await fetchJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbolInfo.compact}`, {}, 7000);
  const price = Number(data?.result?.list?.[0]?.lastPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid Bybit price');
  return price;
}

async function fetchOkxPrice(symbolInfo) {
  const data = await fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${symbolInfo.okxSwap}`, {}, 7000);
  const price = Number(data?.data?.[0]?.last);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid OKX price');
  return price;
}

const PRICE_FETCHERS = {
  hyperliquid: fetchHyperliquidPrice,
  binance: fetchBinancePrice,
  bybit: fetchBybitPrice,
  okx: fetchOkxPrice,
};

export function getPriceSourceOrder() {
  return String(config.PRICE_SOURCE_ORDER || DEFAULT_SOURCE_ORDER)
    .split(',')
    .map((source) => source.trim().toLowerCase())
    .filter((source) => PRICE_FETCHERS[source]);
}

export async function fetchPublicPrice(symbol, options = {}) {
  const symbolInfo = normalizeSymbol(symbol);
  const sourceOrder = options.sources || getPriceSourceOrder();
  const errors = [];

  for (const source of sourceOrder) {
    try {
      const price = await PRICE_FETCHERS[source](symbolInfo);
      return { price, source, symbol: symbolInfo.compact };
    } catch (err) {
      errors.push(`${source}: ${err.message}`);
    }
  }

  const detail = errors.length ? errors.join('; ') : 'no configured price sources';
  throw new Error(`Price unavailable for ${symbol}: ${detail}`);
}

export async function fetchPublicPriceValue(symbol, options = {}) {
  try {
    const result = await fetchPublicPrice(symbol, options);
    return result.price;
  } catch (err) {
    logger.warn(`[PRICE] ${err.message}`);
    return null;
  }
}

export async function fetchHyperliquidPerpSymbols() {
  const data = await fetchJson('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'meta' }),
  }, 10000);

  const symbols = (data?.universe || [])
    .filter((market) => market?.name && !market?.isDelisted)
    .map((market) => `${String(market.name).toUpperCase()}USDT`)
    .sort();

  if (!symbols.length) throw new Error('No Hyperliquid perp symbols returned');
  return symbols;
}
