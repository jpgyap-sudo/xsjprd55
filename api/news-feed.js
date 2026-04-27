// ============================================================
// News Feed — /api/news-feed
// Returns recent news articles with sentiment scores
// GET ?limit=20&hours=24&asset=BTCUSDT
// Reads from Supabase news_events (populated by /api/news-ingest cron)
// ============================================================

import { queryNews } from '../lib/news-store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const limit = Math.min(50, parseInt(req.query?.limit || '20'));
  const hours = Math.min(72, parseInt(req.query?.hours || '24'));
  const asset = req.query?.asset || null;

  try {
    const assets = asset ? [asset.toUpperCase()] : [];
    const newsItems = await queryNews({ assets, hours, limit, minFreshness: 0.05 });

    // Format for dashboard
    const items = newsItems.slice(0, limit).map(item => ({
      source: item.source,
      title: item.title,
      url: item.url,
      publishedAt: item.published_at || item.ingested_at,
      ingestedAt: item.ingested_at,
      sentimentScore: item.sentiment_score,
      freshnessScore: item.freshness_score,
      credibilityScore: item.credibility_score,
      urgencyScore: item.urgency_score,
      impact: item.sentiment_score > 0.3 ? 'bullish' : item.sentiment_score < -0.3 ? 'bearish' : 'neutral',
      hasUrgency: (item.urgency_score || 0) > 0.25,
      detectedAssets: (item.assets || []).map(sym => ({ symbol: sym, name: sym.replace('USDT', '') })),
      matchedKeywords: item.matched_keywords || []
    }));

    // Aggregate sentiment by asset
    const byAsset = {};
    for (const item of newsItems) {
      for (const sym of (item.assets || [])) {
        if (!byAsset[sym]) {
          byAsset[sym] = { symbol: sym, name: sym.replace('USDT', ''), count: 0, avgScore: 0, scores: [], items: [] };
        }
        byAsset[sym].count++;
        byAsset[sym].scores.push(item.sentiment_score || 0);
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
    for (const item of newsItems) {
      const ageHours = (now - new Date(item.ingested_at).getTime()) / 3600000;
      const w = Math.max(0.1, 1 - ageHours / 12); // decay over 12h
      weightedSum += (item.sentiment_score || 0) * w;
      weightTotal += w;
    }
    const overallScore = weightTotal > 0 ? weightedSum / weightTotal : 0;

    return res.status(200).json({
      ok: true,
      overallScore,
      itemCount: newsItems.length,
      items,
      byAsset: Object.values(byAsset).sort((a, b) => b.count - a.count)
    });

  } catch (err) {
    console.error('News feed error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
