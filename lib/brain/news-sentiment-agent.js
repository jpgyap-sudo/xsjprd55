// ============================================================
// News Sentiment Agent — Fetches news/social sentiment for a
// symbol from existing social intel and news data sources.
// Wired to: lib/signal-engine.js getSocialIntelForSymbol()
// ============================================================

import { createClient } from '@supabase/supabase-js';

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/**
 * Fetch news/social sentiment for a symbol.
 * Queries social_intel and news_articles tables.
 */
export async function getNewsSentiment({ symbol }) {
  const client = supabase();
  if (!client) {
    return { ok: false, error: 'Supabase not configured', sentiment: 0, article_count: 0, sources: [] };
  }

  try {
    // Try social_intel table first (from social-news-worker)
    const { data: social, error: socErr } = await client
      .from('social_intel')
      .select('sentiment, source, content')
      .eq('symbol', symbol)
      .gte('created_at', new Date(Date.now() - 7200000).toISOString()) // last 2 hours
      .limit(50);

    if (!socErr && social?.length) {
      const sentiments = social.map(s => s.sentiment ?? 0);
      const avgSentiment = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
      const sources = [...new Set(social.map(s => s.source).filter(Boolean))];

      return {
        ok: true,
        symbol,
        sentiment: Math.round(avgSentiment * 100) / 100,
        article_count: social.length,
        sources,
        source: 'social_intel'
      };
    }

    // Fallback: try news_articles table
    const { data: news, error: newsErr } = await client
      .from('news_articles')
      .select('sentiment, source, title')
      .eq('symbol', symbol)
      .gte('published_at', new Date(Date.now() - 7200000).toISOString())
      .limit(50);

    if (!newsErr && news?.length) {
      const sentiments = news.map(n => n.sentiment ?? 0);
      const avgSentiment = sentiments.length ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : 0;
      const sources = [...new Set(news.map(n => n.source).filter(Boolean))];

      return {
        ok: true,
        symbol,
        sentiment: Math.round(avgSentiment * 100) / 100,
        article_count: news.length,
        sources,
        source: 'news_articles'
      };
    }

    // No data
    return {
      ok: true,
      symbol,
      sentiment: 0,
      article_count: 0,
      sources: [],
      source: 'none'
    };
  } catch (err) {
    console.error('[news-sentiment-agent] error:', err.message);
    return { ok: false, error: err.message, sentiment: 0, article_count: 0, sources: [] };
  }
}
