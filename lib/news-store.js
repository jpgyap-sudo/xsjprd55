// ============================================================
// News Store — Persistent news storage in Supabase
// Handles: ingest with dedupe, query by asset/age, freshness scoring
// Used by: /api/news-ingest (cron), /api/news-feed, /api/news-signal, /api/ask
// ============================================================

import { supabase } from './supabase.js';
import { fetchAllNews, SOURCES } from './news-aggregator.js';
import { scoreNewsItems, detectAssets, analyzeSentiment } from './news-sentiment.js';
import crypto from 'crypto';

const FRESHNESS_HALF_LIFE_MINUTES = 60; // 1 hour half-life for freshness score

function hashTitle(title) {
  return crypto.createHash('md5').update(title.toLowerCase().trim()).digest('hex');
}

function computeFreshness(ingestedAt) {
  const ageMinutes = (Date.now() - new Date(ingestedAt).getTime()) / 60000;
  return Math.max(0, Math.min(1, Math.exp(-ageMinutes / (FRESHNESS_HALF_LIFE_MINUTES / Math.LN2))));
}

function computeUrgency(title, summary) {
  const text = `${title} ${summary || ''}`.toUpperCase();
  const URGENCY_TERMS = ['JUST IN', 'BREAKING', 'URGENT', 'ALERT', 'FLASH', 'EXCLUSIVE', 'NOW:', 'DEVELOPING'];
  let score = 0;
  for (const term of URGENCY_TERMS) {
    if (text.includes(term)) score += 0.25;
  }
  return Math.min(1, score);
}

/**
 * Ingest fresh RSS news into Supabase with deduplication.
 * Call this from /api/news-ingest cron (every 5 min).
 */
export async function ingestNews(options = {}) {
  const maxAgeMinutes = options.maxAgeMinutes || 60;
  const results = { inserted: 0, duplicates: 0, errors: 0, sources: 0 };

  try {
    const newsItems = await fetchAllNews(maxAgeMinutes);
    if (newsItems.length === 0) return results;

    const scored = scoreNewsItems(newsItems);
    results.sources = new Set(newsItems.map(n => n.source)).size;

    for (const item of scored.items) {
      try {
        const titleHash = hashTitle(item.title);

        // Check for duplicate
        const { data: existing } = await supabase
          .from('news_events')
          .select('id')
          .eq('title_hash', titleHash)
          .maybeSingle();

        if (existing) {
          results.duplicates++;
          continue;
        }

        // Build record
        const assets = item.detectedAssets.map(a => a.symbol);
        const urgency = computeUrgency(item.title, item.summary);
        const sourceWeight = SOURCES.find(s => s.name === item.source)?.weight || 0.8;

        const record = {
          source: item.source,
          source_type: 'rss',
          source_url: item.url,
          title: item.title.slice(0, 500),
          body: item.summary ? item.summary.slice(0, 2000) : null,
          url: item.url,
          published_at: item.publishedAt,
          ingested_at: new Date().toISOString(),
          assets: assets.length ? assets : null,
          sentiment_score: item.sentimentScore,
          credibility_score: sourceWeight,
          freshness_score: 1.0,
          urgency_score: urgency,
          title_hash: titleHash,
          matched_keywords: item.matchedKeywords || [],
          raw_data: { impact: item.impact, hasUrgency: item.hasUrgency, weight: item.weight }
        };

        const { error } = await supabase.from('news_events').insert(record);
        if (error) {
          console.warn('[news-store] insert error:', error.message);
          results.errors++;
        } else {
          results.inserted++;
        }
      } catch (e) {
        console.warn('[news-store] item ingest error:', e.message);
        results.errors++;
      }
    }

    console.log(`[news-store] ingested ${results.inserted} new, ${results.duplicates} dupes, ${results.errors} errors`);
    return results;
  } catch (e) {
    console.error('[news-store] fatal ingest error:', e.message);
    results.errors++;
    return results;
  }
}

/**
 * Query news from Supabase by asset, age, and relevance.
 * Call this from /api/ask, /api/news-feed, /api/news-signal.
 */
export async function queryNews(opts = {}) {
  const {
    assets = [],      // e.g. ['BTCUSDT', 'LTCUSDT']
    hours = 6,        // max age in hours
    limit = 50,
    minFreshness = 0.1,
    minSentiment = null, // abs threshold, e.g. 0.3 for strong signals only
    keyword = null    // text search in title/body
  } = opts;

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('news_events')
    .select('*')
    .gte('ingested_at', since)
    .gte('freshness_score', minFreshness)
    .order('ingested_at', { ascending: false })
    .limit(limit);

  if (assets.length > 0) {
    query = query.overlaps('assets', assets);
  }

  if (minSentiment !== null) {
    query = query.or(`sentiment_score.gte.${minSentiment},sentiment_score.lte.${-minSentiment}`);
  }

  if (keyword) {
    query = query.or(`title.ilike.%${keyword}%,body.ilike.%${keyword}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Recalculate freshness on read (since it's time-dependent)
  const now = Date.now();
  return (data || []).map(item => ({
    ...item,
    freshness_score: Math.max(0, Math.min(1, Math.exp(-(now - new Date(item.ingested_at).getTime()) / 60000 / (FRESHNESS_HALF_LIFE_MINUTES / Math.LN2))))
  }));
}

/**
 * Get latest news relevant to a specific question/topic.
 * Smart asset detection + keyword matching for AI context.
 */
export async function getRelevantNewsForQuestion(question, opts = {}) {
  const qLower = question.toLowerCase();

  // Detect mentioned assets
  const ASSET_KEYWORDS = {
    btc: 'BTCUSDT', bitcoin: 'BTCUSDT', xbt: 'BTCUSDT',
    eth: 'ETHUSDT', ethereum: 'ETHUSDT',
    sol: 'SOLUSDT', solana: 'SOLUSDT',
    bnb: 'BNBUSDT',
    xrp: 'XRPUSDT', ripple: 'XRPUSDT',
    ada: 'ADAUSDT', cardano: 'ADAUSDT',
    avax: 'AVAXUSDT', avalanche: 'AVAXUSDT',
    doge: 'DOGEUSDT', dogecoin: 'DOGEUSDT',
    dot: 'DOTUSDT', polkadot: 'DOTUSDT',
    link: 'LINKUSDT', chainlink: 'LINKUSDT',
    matic: 'MATICUSDT', polygon: 'MATICUSDT',
    ltc: 'LTCUSDT', litecoin: 'LTCUSDT',
    bch: 'BCHUSDT', 'bitcoin cash': 'BCHUSDT',
    uni: 'UNIUSDT', uniswap: 'UNIUSDT',
    aave: 'AAVEUSDT',
    sui: 'SUIUSDT',
    sei: 'SEIUSDT',
    arb: 'ARBUSDT', arbitrum: 'ARBUSDT',
    op: 'OPUSDT', optimism: 'OPUSDT'
  };

  const mentionedAssets = [];
  for (const [kw, symbol] of Object.entries(ASSET_KEYWORDS)) {
    if (qLower.includes(kw) && !mentionedAssets.includes(symbol)) {
      mentionedAssets.push(symbol);
    }
  }

  // Also search by keyword if no assets detected
  const keyword = mentionedAssets.length === 0 ? question : null;

  const news = await queryNews({
    assets: mentionedAssets,
    keyword,
    hours: opts.hours || 6,
    limit: opts.limit || 15,
    minFreshness: 0.05
  });

  // Sort by combined relevance score
  return news
    .map(item => ({
      ...item,
      relevance: (
        (item.freshness_score || 0) * 0.35 +
        (Math.abs(item.sentiment_score || 0)) * 0.25 +
        (item.credibility_score || 0.7) * 0.20 +
        (item.urgency_score || 0) * 0.20
      )
    }))
    .sort((a, b) => b.relevance - a.relevance);
}

/**
 * Get news formatted for AI prompt injection.
 */
export async function buildNewsContextForAI(question, opts = {}) {
  let news = await getRelevantNewsForQuestion(question, opts);

  // Fallback: if DB is stale/empty, fetch live RSS
  if (news.length === 0) {
    console.log('[news-store] DB empty/stale, falling back to live RSS for AI context');
    const { fetchAllNews } = await import('./news-aggregator.js');
    const { scoreNewsItems } = await import('./news-sentiment.js');
    const live = await fetchAllNews(opts.hours ? opts.hours * 60 : 60);
    const scored = scoreNewsItems(live);
    news = scored.items.slice(0, opts.limit || 15);
  }

  if (news.length === 0) {
    return { hasNews: false, context: 'No relevant news in the last 6 hours.' };
  }

  const lines = news.slice(0, 10).map((n, i) => {
    const age = Math.round((Date.now() - new Date(n.ingested_at).getTime()) / 60000);
    const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    const sentiment = n.sentiment_score > 0.3 ? '🟢' : n.sentiment_score < -0.3 ? '🔴' : '⚪';
    return `${i + 1}. ${sentiment} [${n.source}] ${n.title} (${ageStr}, fresh:${(n.freshness_score * 100).toFixed(0)}%)`;
  });

  return {
    hasNews: true,
    context: `Latest relevant news (${news.length} items in last ${opts.hours || 6}h):\n${lines.join('\n')}`,
    newsCount: news.length,
    topHeadlines: news.slice(0, 5).map(n => ({ title: n.title, source: n.source, sentiment: n.sentiment_score }))
  };
}

/**
 * Get raw news items for signal generation (compatible with news-aggregator format).
 */
export async function fetchNewsFromStore(maxAgeMinutes = 60, limit = 200) {
  const since = new Date(Date.now() - maxAgeMinutes * 60000).toISOString();

  const { data, error } = await supabase
    .from('news_events')
    .select('*')
    .gte('ingested_at', since)
    .order('ingested_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  // Fallback: if DB is empty/stale, fetch live RSS directly
  if (!data || data.length === 0) {
    console.log('[news-store] DB empty/stale, falling back to live RSS');
    const { fetchAllNews } = await import('./news-aggregator.js');
    const { scoreNewsItems } = await import('./news-sentiment.js');
    const live = await fetchAllNews(maxAgeMinutes);
    const scored = scoreNewsItems(live);
    return scored.items.slice(0, limit);
  }

  // Convert back to news-aggregator format
  return (data || []).map(item => ({
    source: item.source,
    title: item.title,
    summary: item.body,
    url: item.url,
    publishedAt: item.published_at || item.ingested_at,
    weight: item.credibility_score || 1.0,
    sentimentScore: item.sentiment_score,
    detectedAssets: (item.assets || []).map(sym => ({ symbol: sym, name: sym.replace('USDT', '') })),
    impact: item.raw_data?.impact || 'neutral',
    hasUrgency: item.raw_data?.hasUrgency || false,
    matchedKeywords: item.matched_keywords || []
  }));
}

/**
 * Cleanup old news events (keep 7 days).
 */
export async function cleanupOldNews(days = 7) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await supabase
    .from('news_events')
    .delete()
    .lt('ingested_at', cutoff)
    .select('count');

  if (error) {
    console.error('[news-store] cleanup error:', error.message);
    return 0;
  }
  console.log(`[news-store] cleaned up ${count || 0} old news items`);
  return count || 0;
}
