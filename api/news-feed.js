// ============================================================
// News Feed — /api/news-feed
// Returns recent news articles with sentiment scores
// GET ?limit=20&hours=24
// ============================================================

import { fetchAllNews } from '../lib/news-aggregator.js';
import { scoreNewsItems } from '../lib/news-sentiment.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const limit = Math.min(50, parseInt(req.query?.limit || '20'));
  const hours = Math.min(72, parseInt(req.query?.hours || '24'));

  try {
    const maxAgeMinutes = hours * 60;
    const newsItems = await fetchAllNews(maxAgeMinutes);
    const scored = scoreNewsItems(newsItems);

    // Limit and format for dashboard
    const items = scored.items.slice(0, limit).map(item => ({
      source: item.source,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      sentimentScore: item.sentimentScore,
      impact: item.impact,
      hasUrgency: item.hasUrgency,
      detectedAssets: item.detectedAssets.map(a => ({ symbol: a.symbol, name: a.name })),
      matchedKeywords: item.matchedKeywords.map(k => ({ term: k.term, score: k.score }))
    }));

    // Aggregate sentiment by asset
    const byAsset = {};
    for (const item of scored.items) {
      for (const asset of item.detectedAssets) {
        if (!byAsset[asset.symbol]) {
          byAsset[asset.symbol] = { symbol: asset.symbol, name: asset.name, count: 0, avgScore: 0, scores: [], items: [] };
        }
        byAsset[asset.symbol].count++;
        byAsset[asset.symbol].scores.push(item.sentimentScore);
        byAsset[asset.symbol].items.push(item.title);
      }
    }
    for (const sym of Object.keys(byAsset)) {
      const a = byAsset[sym];
      a.avgScore = a.scores.reduce((s, v) => s + v, 0) / a.scores.length;
      delete a.scores;
      a.items = a.items.slice(0, 3);
    }

    return res.status(200).json({
      ok: true,
      overallScore: scored.overallScore,
      itemCount: scored.itemCount,
      items,
      byAsset: Object.values(byAsset).sort((a, b) => b.count - a.count)
    });

  } catch (err) {
    console.error('News feed error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
