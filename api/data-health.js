// ============================================================
// Data Health Dashboard — /api/data-health
// Returns real-time status of all data feeds used by the bot.
// Includes: exchange APIs, news freshness, liquidation/funding
// freshness, crawler fallback usage, and Hyperliquid status.
// ============================================================

import { createExchange } from '../lib/exchange.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

const EXCHANGES = ['binance', 'bybit', 'okx', 'hyperliquid'];
const MAX_AGE_MINUTES = {
  market_data: 30,
  news: 120,
  liquidation: 60,
  funding: 60,
};

async function checkExchange(name) {
  const start = Date.now();
  try {
    const ex = createExchange(name);
    await ex.loadMarkets();
    // Try a lightweight ticker fetch
    const ticker = await ex.fetchTicker('BTC/USDT');
    return {
      name,
      status: 'online',
      latencyMs: Date.now() - start,
      lastPrice: ticker?.last || null,
      error: null,
    };
  } catch (e) {
    return {
      name,
      status: 'error',
      latencyMs: Date.now() - start,
      lastPrice: null,
      error: e.message,
    };
  }
}

async function checkDataFreshness(table, timestampColumn, maxAgeMinutes) {
  try {
    const { data, error } = await supabase
      .from(table)
      .select(timestampColumn)
      .order(timestampColumn, { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return { status: 'missing', ageMinutes: null, lastAt: null, error: error?.message || 'No data' };
    }

    const lastAt = new Date(data[timestampColumn]);
    const ageMinutes = (Date.now() - lastAt.getTime()) / 60000;
    const status = ageMinutes <= maxAgeMinutes ? 'fresh' : 'stale';

    return { status, ageMinutes: Math.round(ageMinutes), lastAt: lastAt.toISOString(), error: null };
  } catch (e) {
    return { status: 'error', ageMinutes: null, lastAt: null, error: e.message };
  }
}

async function checkCrawlerFallback() {
  try {
    // Count how many times crawler fallback was used in last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('data_source_health')
      .select('*')
      .eq('fallback_used', true)
      .gte('last_success_at', since);

    if (error) return { used24h: null, error: error.message };
    return { used24h: data?.length || 0, error: null };
  } catch (e) {
    return { used24h: null, error: e.message };
  }
}

async function checkNewsFreshness() {
  return checkDataFreshness('news_events', 'published_at', MAX_AGE_MINUTES.news);
}

async function checkLiquidationFreshness() {
  return checkDataFreshness('liquidation_heatmap', 'generated_at', MAX_AGE_MINUTES.liquidation);
}

async function checkMarketDataFreshness() {
  return checkDataFreshness('market_data', 'timestamp', MAX_AGE_MINUTES.market_data);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const start = Date.now();

    const [exchanges, marketData, news, liquidation, crawler] = await Promise.all([
      Promise.all(EXCHANGES.map(checkExchange)),
      checkMarketDataFreshness(),
      checkNewsFreshness(),
      checkLiquidationFreshness(),
      checkCrawlerFallback(),
    ]);

    const allOnline = exchanges.every(e => e.status === 'online');
    const anyStale = [marketData, news, liquidation].some(d => d.status === 'stale');

    const overallStatus = allOnline && !anyStale ? 'healthy'
      : !allOnline ? 'degraded'
      : 'stale_data';

    const result = {
      ok: true,
      overallStatus,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      exchanges: exchanges.reduce((acc, e) => {
        acc[e.name] = {
          status: e.status,
          latencyMs: e.latencyMs,
          lastPrice: e.lastPrice,
          error: e.error,
        };
        return acc;
      }, {}),
      freshness: {
        marketData: {
          status: marketData.status,
          maxAgeMinutes: MAX_AGE_MINUTES.market_data,
          actualAgeMinutes: marketData.ageMinutes,
          lastAt: marketData.lastAt,
        },
        news: {
          status: news.status,
          maxAgeMinutes: MAX_AGE_MINUTES.news,
          actualAgeMinutes: news.ageMinutes,
          lastAt: news.lastAt,
        },
        liquidation: {
          status: liquidation.status,
          maxAgeMinutes: MAX_AGE_MINUTES.liquidation,
          actualAgeMinutes: liquidation.ageMinutes,
          lastAt: liquidation.lastAt,
        },
      },
      crawlerFallback: {
        usedInLast24h: crawler.used24h,
        status: crawler.used24h > 0 ? 'fallback_active' : 'api_only',
      },
      alerts: [],
    };

    // Generate alerts
    exchanges.filter(e => e.status !== 'online').forEach(e => {
      result.alerts.push({
        level: 'critical',
        source: e.name,
        message: `${e.name} API offline: ${e.error}`,
      });
    });

    if (marketData.status === 'stale') {
      result.alerts.push({
        level: 'warning',
        source: 'market_data',
        message: `Market data is ${marketData.ageMinutes} min old (max ${MAX_AGE_MINUTES.market_data})`,
      });
    }

    if (news.status === 'stale') {
      result.alerts.push({
        level: 'warning',
        source: 'news',
        message: `News data is ${news.ageMinutes} min old (max ${MAX_AGE_MINUTES.news})`,
      });
    }

    if (crawler.used24h > 5) {
      result.alerts.push({
        level: 'warning',
        source: 'crawler',
        message: `Crawler fallback used ${crawler.used24h} times in last 24h — primary APIs may be unstable`,
      });
    }

    logger.info(`[DATA-HEALTH] status=${overallStatus} exchanges=${exchanges.map(e => `${e.name}:${e.status}`).join(',')}`);
    return res.status(200).json(result);
  } catch (err) {
    logger.error(`[DATA-HEALTH] fatal: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
