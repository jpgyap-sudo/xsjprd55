// ============================================================
// News Feed — /api/news-feed
// Returns recent news articles with sentiment scores
// GET ?limit=20&hours=24&asset=BTCUSDT
// Reads from Supabase news_events (populated by /api/news-ingest cron)
// ============================================================

import { queryNews } from '../lib/news-store.js';

function normalizeNewsItem(item) {
  const detectedAssets = item.detectedAssets || [];
  const assets = item.assets || detectedAssets.map(a => a.symbol).filter(Boolean);
  const sentimentScore = item.sentiment_score ?? item.sentimentScore ?? 0;
  const urgencyScore = item.urgency_score ?? (item.hasUrgency ? 0.5 : 0);
  const credibilityScore = item.credibility_score ?? item.weight ?? 0.7;
  const publishedAt = item.published_at || item.publishedAt || item.ingested_at || item.ingestedAt;
  const ingestedAt = item.ingested_at || item.ingestedAt || item.publishedAt || item.published_at || new Date().toISOString();

  return {
    source: item.source,
    title: item.title,
    url: item.url,
    publishedAt,
    ingestedAt,
    sentimentScore,
    freshnessScore: item.freshness_score ?? item.freshnessScore ?? null,
    credibilityScore,
    urgencyScore,
    impact: sentimentScore > 0.3 ? 'bullish' : sentimentScore < -0.3 ? 'bearish' : 'neutral',
    hasUrgency: urgencyScore > 0.25 || Boolean(item.hasUrgency),
    detectedAssets: assets.map(sym => ({ symbol: sym, name: sym.replace('USDT', '') })),
    matchedKeywords: item.matched_keywords || item.matchedKeywords || []
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const limit = Math.min(50, parseInt(req.query?.limit || '20'));
  const hours = Math.min(72, parseInt(req.query?.hours || '24'));
  const asset = req.query?.asset || null;

  try {
    const assets = asset ? [asset.toUpperCase()] : [];
    let newsItems = [];
    let source = 'db';
    let rssDiagnostics = null;
    let fallbackReason = null;
    try {
      newsItems = await queryNews({ assets, hours, limit, minFreshness: 0.05 });
    } catch (queryErr) {
      console.warn('[news-feed] query warning:', queryErr.message);
      fallbackReason = `database query failed: ${queryErr.message}`;
    }

    // Live RSS fallback if DB is empty/stale
    if (newsItems.length === 0) {
      try {
        const { fetchAllNews, getLastNewsFetchDiagnostics } = await import('../lib/news-aggregator.js');
        const { scoreNewsItems } = await import('../lib/news-sentiment.js');
        const live = await fetchAllNews(Math.min(hours * 60, 1440));
        const scored = scoreNewsItems(live);
        newsItems = scored.items.slice(0, limit);
        source = 'live_rss';
        rssDiagnostics = getLastNewsFetchDiagnostics();
        fallbackReason ||= 'database returned no fresh articles';
      } catch (rssErr) {
        console.warn('[news-feed] RSS fallback failed:', rssErr.message);
        fallbackReason ||= `RSS fallback failed: ${rssErr.message}`;
      }
    }

    // Format for dashboard
    const items = newsItems.slice(0, limit).map(normalizeNewsItem);

    // Aggregate sentiment by asset
    const byAsset = {};
    for (const item of items) {
      for (const asset of (item.detectedAssets || [])) {
        const sym = asset.symbol;
        if (!byAsset[sym]) {
          byAsset[sym] = { symbol: sym, name: sym.replace('USDT', ''), count: 0, avgScore: 0, scores: [], items: [] };
        }
        byAsset[sym].count++;
        byAsset[sym].scores.push(item.sentimentScore || 0);
        byAsset[sym].items.push(item.title);
      }
    }
    for (const sym of Object.keys(byAsset)) {
      const a = byAsset[sym];
      a.avgScore = a.scores.reduce((s, v) => s + v, 0) / a.scores.length;
      delete a.scores;
      a.items = a.items.slice(0, 3);
    }

    // Compute overall sentiment from fresh news (last 3 hours weighted more)
    const now = Date.now();
    let weightedSum = 0, weightTotal = 0;
    for (const item of items) {
      const ageHours = (now - new Date(item.ingestedAt || item.publishedAt).getTime()) / 3600000;
      const w = Math.max(0.1, 1 - ageHours / 12); // decay over 12h
      weightedSum += (item.sentimentScore || 0) * w;
      weightTotal += w;
    }
    const overallScore = weightTotal > 0 ? weightedSum / weightTotal : 0;

    return res.status(200).json({
      ok: true,
      overallScore,
      itemCount: items.length,
      items,
      byAsset: Object.values(byAsset).sort((a, b) => b.count - a.count),
      source,
      fallbackReason,
      rssDiagnostics
    });

  } catch (err) {
    console.error('News feed error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
