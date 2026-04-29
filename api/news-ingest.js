// ============================================================
// News Ingest — /api/news-ingest
// Cron-triggered endpoint that fetches RSS and populates news_events.
// Also bridges social_posts/neural_news_events into news_events.
// Call every 3–5 minutes via cron or PM2 worker.
// ============================================================

import { ingestNews } from '../lib/news-store.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { scoreNewsItems } from '../lib/news-sentiment.js';
import { fetchAllNews } from '../lib/news-aggregator.js';

/**
 * Bridge neural news events (from social-news-worker) into news_events.
 * This ensures the dashboard news feed shows social-intel data too.
 */
async function bridgeSocialToNewsEvents() {
  const results = { bridged: 0, duplicates: 0, errors: 0 };

  try {
    // Get recent neural events not yet in news_events
    const { data: events, error } = await supabase
      .from('neural_news_events')
      .select('*, social_posts!inner(title, url, source, raw_text, external_created_at)')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    if (!events || events.length === 0) return results;

    for (const ev of events) {
      try {
        const title = ev.summary?.slice(0, 200) || ev.social_posts?.title || 'Market Update';
        const url = ev.social_posts?.url || '';
        const source = ev.social_posts?.source || 'Social Intel';
        const body = ev.social_posts?.raw_text?.slice(0, 1000) || ev.summary || '';
        const titleHash = await import('crypto').then(c =>
          c.createHash('md5').update(title.toLowerCase().trim()).digest('hex')
        );

        // Check duplicate
        const { data: existing } = await supabase
          .from('news_events')
          .select('id')
          .eq('title_hash', titleHash)
          .maybeSingle();

        if (existing) {
          results.duplicates++;
          continue;
        }

        const record = {
          source,
          source_type: 'api',
          source_url: url,
          title: title.slice(0, 500),
          body: body || null,
          url,
          published_at: ev.social_posts?.external_created_at || ev.created_at,
          ingested_at: new Date().toISOString(),
          assets: ev.symbols?.length ? ev.symbols : (ev.symbol ? [ev.symbol] : null),
          sentiment_score: ev.sentiment_score,
          credibility_score: ev.source_quality || 0.7,
          freshness_score: 1.0,
          urgency_score: ev.urgency === 'breaking' ? 0.9 : ev.urgency === 'fast' ? 0.6 : 0.2,
          title_hash: titleHash,
          matched_keywords: [],
          raw_data: {
            event_type: ev.event_type,
            impact_level: ev.impact_level,
            confidence: ev.confidence,
            suggested_bias: ev.suggested_bias,
            neural_event_id: ev.id,
            bridged_from: 'social_intel'
          }
        };

        const { error: insertErr } = await supabase.from('news_events').insert(record);
        if (insertErr) {
          results.errors++;
          logger.warn(`[news-ingest] Bridge insert error: ${insertErr.message}`);
        } else {
          results.bridged++;
        }
      } catch (e) {
        results.errors++;
        logger.warn(`[news-ingest] Bridge item error: ${e.message}`);
      }
    }

    logger.info(`[news-ingest] Bridged ${results.bridged} social events, ${results.duplicates} dupes, ${results.errors} errors`);
    return results;
  } catch (e) {
    logger.error(`[news-ingest] Bridge failed: ${e.message}`);
    return results;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const results = {
    rss: { inserted: 0, duplicates: 0, errors: 0, sources: 0 },
    bridge: { bridged: 0, duplicates: 0, errors: 0 },
    timestamp: new Date().toISOString()
  };

  try {
    // 1. Ingest fresh RSS news
    results.rss = await ingestNews({ maxAgeMinutes: 60 });

    // 2. Bridge social intel into news_events
    results.bridge = await bridgeSocialToNewsEvents();

    logger.info(`[news-ingest] Complete: RSS=${results.rss.inserted}, Bridge=${results.bridge.bridged}`);
    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    logger.error(`[news-ingest] Fatal: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message, ...results });
  }
}
