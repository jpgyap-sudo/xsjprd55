// ============================================================
// Enhanced Source Crawler — With Clickable Links & Snapshots
// Crawls multiple data sources with rich metadata and descriptions
// ============================================================

import { storeResearchItem } from './researchAgent.js';
import { logger } from '../logger.js';

const CRAWL_TIMEOUT_MS = 15000;

/**
 * @typedef {Object} EnhancedCrawledSource
 * @property {string} name - Source identifier
 * @property {string} displayName - Human-readable name
 * @property {string} url - Clickable URL to source
 * @property {string} content - Content summary
 * @property {string} description - Detailed description of the source
 * @property {string} category - Category: news, onchain, funding, sentiment, technical
 * @property {number} relevanceScore - 0-1 relevance score
 * @property {string} [snapshotUrl] - Screenshot/chart URL if available
 * @property {Object} metadata - Additional metadata
 */

const SOURCES_CONFIG = {
  cryptopanic: {
    name: 'cryptopanic',
    displayName: 'CryptoPanic News',
    category: 'news',
    description: 'Real-time cryptocurrency news aggregator with sentiment votes',
    baseUrl: 'https://cryptopanic.com',
    icon: '📰'
  },
  coingecko_global: {
    name: 'coingecko_global',
    displayName: 'CoinGecko Global Market',
    category: 'onchain',
    description: 'Global crypto market metrics including market cap and dominance',
    baseUrl: 'https://www.coingecko.com',
    icon: '🌍'
  },
  binance_funding: {
    name: 'binance_funding',
    displayName: 'Binance Funding Rates',
    category: 'funding',
    description: 'Perpetual futures funding rates indicating market sentiment',
    baseUrl: 'https://www.binance.com/en/futures/funding-history',
    icon: '💰'
  },
  lunarcrush: {
    name: 'lunarcrush',
    displayName: 'LunarCrush Social Data',
    category: 'sentiment',
    description: 'Social media sentiment and engagement metrics for crypto',
    baseUrl: 'https://lunarcrush.com',
    icon: '📊'
  },
  tradingview_ideas: {
    name: 'tradingview_ideas',
    displayName: 'TradingView Ideas',
    category: 'technical',
    description: 'Community-shared trading ideas with charts and analysis',
    baseUrl: 'https://www.tradingview.com/ideas/cryptocurrency',
    icon: '📈'
  }
};

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
 * Crawl CryptoPanic news API
 * @returns {Promise<EnhancedCrawledSource[]>}
 */
async function crawlCryptoPanic() {
  const config = SOURCES_CONFIG.cryptopanic;
  try {
    const res = await fetchWithTimeout('https://cryptopanic.com/api/v1/posts/?auth_token=demo&public=true');
    if (!res.ok) return [];
    const data = await res.json();
    
    return (data.results || []).slice(0, 10).map((post) => ({
      name: config.name,
      displayName: config.displayName,
      url: post.url || config.baseUrl,
      content: `${post.title}. ${post.domain || ''}`,
      description: `${config.description}\n\nTitle: ${post.title}\nDomain: ${post.domain || 'N/A'}\nVotes: ${JSON.stringify(post.votes || {})}`,
      category: config.category,
      relevanceScore: post.votes?.positive ? Math.min(post.votes.positive * 0.1, 1) : 0.5,
      snapshotUrl: null,
      metadata: {
        domain: post.domain,
        votes: post.votes,
        published_at: post.published_at,
        source_type: 'news'
      }
    }));
  } catch (e) {
    logger.warn(`[ENHANCED-CRAWLER] CryptoPanic error: ${e.message}`);
    return [];
  }
}

/**
 * Crawl CoinGecko global market data
 * @returns {Promise<EnhancedCrawledSource[]>}
 */
async function crawlCoinGeckoGlobal() {
  const config = SOURCES_CONFIG.coingecko_global;
  try {
    const res = await fetchWithTimeout('https://api.coingecko.com/api/v3/global');
    if (!res.ok) return [];
    const data = await res.json();
    const d = data.data || {};
    
    const marketCap = d.total_market_cap?.usd || 0;
    const btcDominance = d.market_cap_percentage?.btc || 0;
    const change24h = d.market_cap_change_percentage_24h_usd || 0;
    
    const content = `Market cap: $${(marketCap / 1e12).toFixed(2)}T. BTC dominance: ${btcDominance.toFixed(1)}%. 24h change: ${change24h.toFixed(2)}%`;
    
    return [{
      name: config.name,
      displayName: config.displayName,
      url: `${config.baseUrl}/en/global-charts`,
      content,
      description: `${config.description}\n\nCurrent market conditions:\n• Total Market Cap: $${(marketCap / 1e12).toFixed(2)} Trillion\n• Bitcoin Dominance: ${btcDominance.toFixed(1)}%\n• 24h Change: ${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}%\n• Active Cryptocurrencies: ${d.active_cryptocurrencies || 'N/A'}`,
      category: config.category,
      relevanceScore: Math.abs(change24h) > 5 ? 0.9 : 0.7,
      snapshotUrl: 'https://www.coingecko.com/en/global-charts',
      metadata: {
        market_cap_usd: marketCap,
        btc_dominance: btcDominance,
        change_24h_pct: change24h,
        active_cryptocurrencies: d.active_cryptocurrencies,
        market_cap_change_24h: d.market_cap_change_24h,
        source_type: 'macro'
      }
    }];
  } catch (e) {
    logger.warn(`[ENHANCED-CRAWLER] CoinGecko error: ${e.message}`);
    return [];
  }
}

/**
 * Crawl Binance funding rates
 * @returns {Promise<EnhancedCrawledSource[]>}
 */
async function crawlBinanceFunding() {
  const config = SOURCES_CONFIG.binance_funding;
  try {
    const res = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/premiumIndex');
    if (!res.ok) return [];
    const data = await res.json();
    
    const top = data
      .filter((d) => d.symbol.endsWith('USDT'))
      .sort((a, b) => Math.abs(parseFloat(b.lastFundingRate)) - Math.abs(parseFloat(a.lastFundingRate)))
      .slice(0, 5);
    
    const fundingDetails = top.map((t) => {
      const rate = parseFloat(t.lastFundingRate);
      return {
        symbol: t.symbol,
        rate: rate,
        ratePct: (rate * 100).toFixed(4),
        markPrice: t.markPrice,
        signal: rate > 0.0001 ? 'bearish' : rate < -0.0001 ? 'bullish' : 'neutral'
      };
    });
    
    const content = fundingDetails.map(d => 
      `${d.symbol}: ${d.ratePct}% (${d.signal})`
    ).join('. ');
    
    const description = `${config.description}\n\nTop Funding Rate Signals:\n${fundingDetails.map(d => 
      `• ${d.symbol}: ${d.ratePct}% (${d.signal.toUpperCase()}) - Mark: $${parseFloat(d.markPrice).toFixed(2)}`
    ).join('\n')}\n\nInterpretation:\n• Positive funding = Shorts pay longs (bearish sentiment)\n• Negative funding = Longs pay shorts (bullish sentiment)`;
    
    return [{
      name: config.name,
      displayName: config.displayName,
      url: config.baseUrl,
      content,
      description,
      category: config.category,
      relevanceScore: Math.max(...fundingDetails.map(d => Math.abs(d.rate))) > 0.001 ? 0.85 : 0.7,
      snapshotUrl: null,
      metadata: {
        funding_details: fundingDetails,
        average_rate: fundingDetails.reduce((a, b) => a + b.rate, 0) / fundingDetails.length,
        source_type: 'funding'
      }
    }];
  } catch (e) {
    logger.warn(`[ENHANCED-CRAWLER] Binance funding error: ${e.message}`);
    return [];
  }
}

/**
 * Crawl LunarCrush social data (if API key available)
 * @returns {Promise<EnhancedCrawledSource[]>}
 */
async function crawlLunarCrush() {
  const config = SOURCES_CONFIG.lunarcrush;
  const apiKey = process.env.LUNARCRUSH_API_KEY;
  
  if (!apiKey) {
    logger.debug('[ENHANCED-CRAWLER] LunarCrush API key not configured');
    return [];
  }
  
  try {
    const res = await fetchWithTimeout(
      `https://lunarcrush.com/api3/coins?data_points=1&key=${apiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    
    const topCoins = (data.data || []).slice(0, 5);
    
    const content = topCoins.map(c => 
      `${c.symbol}: Social score ${c.social_score || 'N/A'}, Sentiment ${c.average_sentiment || 'N/A'}`
    ).join('. ');
    
    return [{
      name: config.name,
      displayName: config.displayName,
      url: `${config.baseUrl}/discover`,
      content,
      description: `${config.description}\n\nTop Social Signals:\n${topCoins.map(c => 
        `• ${c.symbol}: Social Score ${c.social_score || 'N/A'}, Galaxy Score ${c.galaxy_score || 'N/A'}`
      ).join('\n')}`,
      category: config.category,
      relevanceScore: 0.75,
      snapshotUrl: null,
      metadata: {
        top_coins: topCoins.map(c => ({
          symbol: c.symbol,
          social_score: c.social_score,
          galaxy_score: c.galaxy_score,
          sentiment: c.average_sentiment
        })),
        source_type: 'sentiment'
      }
    }];
  } catch (e) {
    logger.warn(`[ENHANCED-CRAWLER] LunarCrush error: ${e.message}`);
    return [];
  }
}

/**
 * Generate a snapshot URL for TradingView chart
 * @param {string} symbol - Trading pair symbol
 * @param {string} timeframe - Chart timeframe
 * @returns {string} TradingView chart URL
 */
export function generateTradingViewSnapshotUrl(symbol = 'BTCUSDT', timeframe = '1h') {
  const tvSymbol = symbol.replace('USDT', '').replace('USD', '') + 'USDT';
  const interval = timeframe === '15m' ? '15' : timeframe === '1h' ? '60' : timeframe === '4h' ? '240' : 'D';
  return `https://www.tradingview.com/chart/?symbol=BINANCE:${tvSymbol}&interval=${interval}`;
}

/**
 * Crawl all enhanced sources
 * @returns {Promise<{stored:number, sources:EnhancedCrawledSource[]}>}
 */
export async function crawlAllEnhancedSources() {
  const sources = await Promise.all([
    crawlCryptoPanic(),
    crawlCoinGeckoGlobal(),
    crawlBinanceFunding(),
    crawlLunarCrush(),
  ]);

  const flat = sources.flat();
  let stored = 0;

  for (const src of flat) {
    try {
      await storeResearchItem({
        sourceName: src.name,
        sourceUrl: src.url,
        content: src.content,
        metadata: {
          displayName: src.displayName,
          description: src.description,
          category: src.category,
          relevanceScore: src.relevanceScore,
          snapshotUrl: src.snapshotUrl,
          ...src.metadata
        }
      });
      stored++;
    } catch (e) {
      logger.warn(`[ENHANCED-CRAWLER] Store failed for ${src.name}: ${e.message}`);
    }
  }

  logger.info(`[ENHANCED-CRAWLER] Stored ${stored} research items from ${flat.length} sources`);
  return { stored, sources: flat };
}

/**
 * Get source config by name
 * @param {string} name 
 * @returns {Object|null}
 */
export function getSourceConfig(name) {
  return SOURCES_CONFIG[name] || null;
}

/**
 * Get all source configs
 * @returns {Object}
 */
export function getAllSourceConfigs() {
  return SOURCES_CONFIG;
}
