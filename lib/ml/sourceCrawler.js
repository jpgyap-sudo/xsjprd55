// ============================================================
// Source Crawler — Assello Research Agent Extension
// Crawls multiple data sources and feeds research items.
// ============================================================

import { storeResearchItem } from './researchAgent.js';
import { logger } from '../logger.js';

/**
 * @typedef {Object} CrawledSource
 * @property {string} name
 * @property {string} url
 * @property {string} content
 * @property {number} relevanceScore
 */

const CRAWL_TIMEOUT_MS = 8000;

/**
 * Fetch with timeout.
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

/**
 * Crawl CryptoPanic news API (public, no key needed for limited use).
 * @returns {Promise<CrawledSource[]>}
 */
async function crawlCryptoPanic() {
  try {
    const res = await fetchWithTimeout('https://cryptopanic.com/api/v1/posts/?auth_token=demo&public=true');
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).slice(0, 10).map((post) => ({
      name: 'cryptopanic',
      url: post.url || 'https://cryptopanic.com',
      content: `${post.title}. ${post.domain || ''}`,
      relevanceScore: post.votes?.positive ? post.votes.positive * 0.1 : 0.5,
    }));
  } catch (e) {
    logger.warn(`[SOURCE-CRAWLER] CryptoPanic error: ${e.message}`);
    return [];
  }
}

/**
 * Crawl CoinGecko global market data as a macro source.
 * @returns {Promise<CrawledSource[]>}
 */
async function crawlCoinGeckoGlobal() {
  try {
    const res = await fetchWithTimeout('https://api.coingecko.com/api/v3/global');
    if (!res.ok) return [];
    const data = await res.json();
    const d = data.data || {};
    const content = `Market cap: $${(d.total_market_cap?.usd / 1e12).toFixed(2)}T. ` +
      `BTC dominance: ${d.market_cap_percentage?.btc?.toFixed(1)}%. ` +
      `Fear index: ${d.market_cap_change_percentage_24h_usd?.toFixed(2)}% 24h change.`;
    return [{
      name: 'coingecko_global',
      url: 'https://www.coingecko.com',
      content,
      relevanceScore: 0.7,
    }];
  } catch (e) {
    logger.warn(`[SOURCE-CRAWLER] CoinGecko error: ${e.message}`);
    return [];
  }
}

/**
 * Crawl Binance funding rate as a microstructure source.
 * @returns {Promise<CrawledSource[]>}
 */
async function crawlBinanceFunding() {
  try {
    const res = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/premiumIndex');
    if (!res.ok) return [];
    const data = await res.json();
    const top = data
      .filter((d) => d.symbol.endsWith('USDT'))
      .sort((a, b) => Math.abs(parseFloat(b.lastFundingRate)) - Math.abs(parseFloat(a.lastFundingRate)))
      .slice(0, 5);
    const content = top.map((t) =>
      `${t.symbol}: funding=${(parseFloat(t.lastFundingRate) * 100).toFixed(4)}%, mark=${t.markPrice}`
    ).join('. ');
    return [{
      name: 'binance_funding',
      url: 'https://www.binance.com',
      content,
      relevanceScore: 0.8,
    }];
  } catch (e) {
    logger.warn(`[SOURCE-CRAWLER] Binance funding error: ${e.message}`);
    return [];
  }
}

/**
 * Crawl all sources and store research items.
 * @returns {Promise<{stored:number, sources:string[]}>}
 */
export async function crawlAllSources() {
  const sources = await Promise.all([
    crawlCryptoPanic(),
    crawlCoinGeckoGlobal(),
    crawlBinanceFunding(),
  ]);

  const flat = sources.flat();
  let stored = 0;
  const sourceNames = [];

  for (const src of flat) {
    try {
      storeResearchItem({
        sourceName: src.name,
        sourceUrl: src.url,
        content: src.content,
      });
      stored++;
      sourceNames.push(src.name);
    } catch (e) {
      logger.warn(`[SOURCE-CRAWLER] Store failed for ${src.name}: ${e.message}`);
    }
  }

  logger.info(`[SOURCE-CRAWLER] Stored ${stored} research items from ${[...new Set(sourceNames)].join(', ')}`);
  return { stored, sources: [...new Set(sourceNames)] };
}
