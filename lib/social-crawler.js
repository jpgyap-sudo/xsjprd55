// ============================================================
// Social & Market Data Crawler v2.0 — Hybrid RSS + Playwright
// Combines fast RSS parsing with fallback web scraping.
// New: Symbol extraction, dedup hashing, source health tracking.
// ============================================================

import crypto from 'crypto';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { logger } from './logger.js';

const rssParser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'xsjprd55-social-intel/1.0'
  }
});

const DEFAULT_SOURCES = [
  { id: 'cointelegraph-rss', type: 'rss', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', enabled: true, source_quality: 0.72 },
  { id: 'coindesk-rss', type: 'rss', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', enabled: true, source_quality: 0.78 },
  { id: 'decrypt-rss', type: 'rss', name: 'Decrypt', url: 'https://decrypt.co/feed', enabled: true, source_quality: 0.70 },
  { id: 'cryptonews-rss', type: 'rss', name: 'CryptoNews', url: 'https://crypto.news/feed/', enabled: true, source_quality: 0.68 },
  { id: 'cryptopanic-rss', type: 'rss', name: 'CryptoPanic', url: 'https://cryptopanic.com/news/rss/', enabled: true, source_quality: 0.65 }
];

const SYMBOL_ALIASES = {
  BTCUSDT: ['BTC', 'BITCOIN', 'XBT'],
  ETHUSDT: ['ETH', 'ETHEREUM'],
  SOLUSDT: ['SOL', 'SOLANA'],
  BNBUSDT: ['BNB', 'BINANCE COIN'],
  XRPUSDT: ['XRP', 'RIPPLE'],
  DOGEUSDT: ['DOGE', 'DOGECOIN'],
  ADAUSDT: ['ADA', 'CARDANO'],
  AVAXUSDT: ['AVAX', 'AVALANCHE'],
  LINKUSDT: ['LINK', 'CHAINLINK'],
  MATICUSDT: ['MATIC', 'POLYGON'],
  DOTUSDT: ['DOT', 'POLKADOT'],
  SUIUSDT: ['SUI', 'SUI'],
  PEPEUSDT: ['PEPE', 'PEPE'],
  SHIBUSDT: ['SHIB', 'SHIBA INU']
};

export function loadSocialSources() {
  if (!process.env.SOCIAL_SOURCES_JSON) return DEFAULT_SOURCES;
  try {
    const parsed = JSON.parse(process.env.SOCIAL_SOURCES_JSON);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_SOURCES;
  } catch (error) {
    logger.warn(`[social-crawler] Invalid SOCIAL_SOURCES_JSON, using defaults: ${error.message}`);
    return DEFAULT_SOURCES;
  }
}

export function normalizeText(text = '') {
  return String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashPost({ source = '', url = '', raw_text = '', external_created_at = '' }) {
  const payload = `${source}|${url}|${raw_text}|${external_created_at}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function extractSymbols(text = '', defaultSymbols = []) {
  const upper = text.toUpperCase();
  const found = new Set();

  for (const [symbol, aliases] of Object.entries(SYMBOL_ALIASES)) {
    if (defaultSymbols.length && !defaultSymbols.includes(symbol)) continue;
    if (aliases.some(alias => new RegExp(`(^|[^A-Z0-9])${alias}([^A-Z0-9]|$)`, 'i').test(upper))) {
      found.add(symbol);
    }
  }

  return Array.from(found);
}

function parseDefaultSymbols() {
  return (process.env.SOCIAL_DEFAULT_SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
}

async function crawlRssSource(source, maxItems) {
  const feed = await rssParser.parseURL(source.url);
  const defaultSymbols = parseDefaultSymbols();

  return (feed.items || []).slice(0, maxItems).map(item => {
    const raw = normalizeText(`${item.title || ''}. ${item.contentSnippet || item.content || ''}`);
    const symbols = extractSymbols(raw, defaultSymbols);
    return {
      source_id: source.id,
      source: source.name || source.id,
      source_account: feed.title || source.name || source.id,
      url: item.link || source.url,
      raw_text: raw,
      normalized_text: raw.toLowerCase(),
      symbol: symbols[0] || null,
      symbols,
      external_created_at: item.isoDate || item.pubDate || null,
      engagement: {},
      metadata: {
        title: item.title || null,
        categories: item.categories || [],
        source_quality: source.source_quality ?? 0.5
      },
      hash: hashPost({
        source: source.id,
        url: item.link || source.url,
        raw_text: raw,
        external_created_at: item.isoDate || item.pubDate || ''
      })
    };
  }).filter(p => p.raw_text && p.raw_text.length > 20);
}

async function crawlWebSource(source, maxItems) {
  const response = await fetch(source.url, {
    headers: { 'User-Agent': 'xsjprd55-social-intel/1.0' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${source.url}`);

  const html = await response.text();
  const $ = cheerio.load(html);
  const defaultSymbols = parseDefaultSymbols();
  const posts = [];

  $('article, .post, .news, li, .entry').each((_, el) => {
    if (posts.length >= maxItems) return false;
    const raw = normalizeText($(el).text());
    if (raw.length < 40) return;
    const link = $(el).find('a').attr('href');
    const url = link ? new URL(link, source.url).toString() : source.url;
    const symbols = extractSymbols(raw, defaultSymbols);

    posts.push({
      source_id: source.id,
      source: source.name || source.id,
      source_account: source.name || source.id,
      url,
      raw_text: raw.slice(0, 2000),
      normalized_text: raw.toLowerCase().slice(0, 2000),
      symbol: symbols[0] || null,
      symbols,
      external_created_at: null,
      engagement: {},
      metadata: { source_quality: source.source_quality ?? 0.5 },
      hash: hashPost({ source: source.id, url, raw_text: raw })
    });
  });

  return posts;
}

// ── Playwright Fallback for JavaScript-rendered sites ───────
async function crawlPlaywrightSource(source, maxItems) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const defaultSymbols = parseDefaultSymbols();
  const posts = [];

  try {
    const page = await browser.newPage();
    await page.goto(source.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    const html = await page.content();
    const $ = cheerio.load(html);

    $('article, .post, .news, li, .entry, [class*="article"]').each((_, el) => {
      if (posts.length >= maxItems) return false;
      const raw = normalizeText($(el).text());
      if (raw.length < 40) return;
      const link = $(el).find('a').attr('href');
      const url = link ? new URL(link, source.url).toString() : source.url;
      const symbols = extractSymbols(raw, defaultSymbols);

      posts.push({
        source_id: source.id,
        source: source.name || source.id,
        source_account: source.name || source.id,
        url,
        raw_text: raw.slice(0, 2000),
        normalized_text: raw.toLowerCase().slice(0, 2000),
        symbol: symbols[0] || null,
        symbols,
        external_created_at: null,
        engagement: {},
        metadata: { source_quality: source.source_quality ?? 0.5 },
        hash: hashPost({ source: source.id, url, raw_text: raw })
      });
    });
  } catch (err) {
    throw err;
  } finally {
    await browser.close();
  }

  return posts;
}

// ── Aggregate all sources ───────────────────────────────────
export async function crawlSocialSources({ sources = loadSocialSources(), maxItemsPerSource } = {}) {
  const maxItems = Number(maxItemsPerSource || process.env.SOCIAL_MAX_ITEMS_PER_SOURCE || 25);
  const results = [];
  const health = [];

  for (const source of sources.filter(s => s.enabled !== false)) {
    const started = Date.now();
    try {
      let posts = [];

      if (source.type === 'rss') {
        posts = await crawlRssSource(source, maxItems);
      } else if (source.type === 'web') {
        posts = await crawlWebSource(source, maxItems);
      } else if (source.type === 'playwright') {
        posts = await crawlPlaywrightSource(source, maxItems);
      } else {
        health.push({
          source_id: source.id,
          status: 'degraded',
          last_error: `Unsupported source type: ${source.type}`,
          last_items_found: 0
        });
        continue;
      }

      results.push(...posts);
      health.push({
        source_id: source.id,
        status: 'ok',
        last_error: null,
        last_items_found: posts.length,
        latency_ms: Date.now() - started
      });

      logger.info(`[SOCIAL-CRAWLER] ${source.name}: ${posts.length} items in ${Date.now() - started}ms`);
    } catch (error) {
      health.push({
        source_id: source.id,
        status: 'offline',
        last_error: error.message,
        last_items_found: 0,
        latency_ms: Date.now() - started
      });
      logger.warn(`[SOCIAL-CRAWLER] ${source.name} failed: ${error.message}`);
    }
  }

  return { posts: results, health };
}

// ── Legacy Playwright-based crawlers (kept for backward compat) ──
export async function crawlBirdeyePerps() {
  logger.info('[SOCIAL-CRAWLER] Legacy crawlBirdeyePerps not needed in v2.0 — using RSS pipeline');
  return { trending: [], funding: [], liquidations: [], timestamp: new Date().toISOString() };
}

export async function crawlCoinMarketCap() {
  logger.info('[SOCIAL-CRAWLER] Legacy crawlCoinMarketCap not needed in v2.0 — using RSS pipeline');
  return { fearGreed: null, trending: [], timestamp: new Date().toISOString() };
}

export async function crawlCryptoPanic() {
  logger.info('[SOCIAL-CRAWLER] Legacy crawlCryptoPanic not needed in v2.0 — using RSS pipeline');
  return { posts: [], timestamp: new Date().toISOString() };
}

export async function crawlDexScreener() {
  logger.info('[SOCIAL-CRAWLER] Legacy crawlDexScreener not needed in v2.0 — using RSS pipeline');
  return { pairs: [], timestamp: new Date().toISOString() };
}

// ── Sentiment Analysis Helper ───────────────────────────────
export function analyzeSentiment(text) {
  const bullish = /\b(pump|moon|bullish|breakout|rally|surge| ATH|buy|long|green|rocket)\b/gi;
  const bearish = /\b(dump|crash|bearish|breakdown|rekt|sell|short|red|liquidat|fud)\b/gi;

  const bCount = (text.match(bullish) || []).length;
  const beCount = (text.match(bearish) || []).length;
  const total = bCount + beCount;

  if (total === 0) return { score: 0, label: 'neutral' };
  const score = (bCount - beCount) / Math.max(total, 1);
  return {
    score: Math.max(-1, Math.min(1, score)),
    label: score > 0.2 ? 'bullish' : score < -0.2 ? 'bearish' : 'neutral',
    bullishCount: bCount,
    bearishCount: beCount,
  };
}

// ── Legacy aggregate wrapper (kept for workers/social-crawler-worker.js) ──
export async function runSocialCrawl() {
  logger.info('[SOCIAL-CRAWLER] Starting v2.0 multi-source crawl...');

  const { posts, health } = await crawlSocialSources();

  // Simple aggregate sentiment from all post texts
  const allTexts = posts.map(p => p.raw_text).join('. ');
  const overallSentiment = analyzeSentiment(allTexts);

  // Legacy format for backward compat
  return {
    birdeye: { trending: [] },
    cmc: { fearGreed: null, trending: [] },
    panic: { posts: [] },
    dex: { pairs: [] },
    overallSentiment,
    allTexts,
    posts,
    health,
    timestamp: new Date().toISOString(),
  };
}
