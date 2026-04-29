// ============================================================
// News Ingest Worker — Continuously fetches & stores fresh news
// Bridges social intel into news_events for dashboard display.
// Runs every 3 minutes on VPS via PM2.
// ============================================================

import { ingestNews } from '../lib/news-store.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import crypto from 'crypto';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Bridge neural news events (from social-news-worker) into news_events.
 */
async function bridgeSocialToNewsEvents() {
  const results = { bridged: 0, duplicates: 0, errors: 0 };

  try {
    const { data: events, error } = await supabase
      .from('neural_news_events')
      .select('*')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    if (!events || events.length === 0) return results;

    // Fetch associated posts separately to avoid join issues
    const postIds = events.map(e => e.post_id).filter(Boolean);
    let postsMap = new Map();
    if (postIds.length > 0) {
      const { data: posts } = await supabase
        .from('social_posts')
        .select('id, title, url, source, raw_text, external_created_at')
        .in('id', postIds);
      if (posts) {
        for (const p of posts) postsMap.set(p.id, p);
      }
    }

    for (const ev of events) {
      try {
        const post = postsMap.get(ev.post_id) || {};
        const title = ev.summary?.slice(0, 200) || post.title || 'Market Update';
        const url = post.url || '';
        const source = post.source || 'Social Intel';
        const body = post.raw_text?.slice(0, 1000) || ev.summary || '';
        const titleHash = crypto.createHash('md5').update(title.toLowerCase().trim()).digest('hex');

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
          published_at: post.external_created_at || ev.created_at,
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
          logger.warn(`[news-ingest-worker] Bridge insert error: ${insertErr.message}`);
        } else {
          results.bridged++;
        }
      } catch (e) {
        results.errors++;
        logger.warn(`[news-ingest-worker] Bridge item error: ${e.message}`);
      }
    }

    logger.info(`[news-ingest-worker] Bridged ${results.bridged} social events, ${results.duplicates} dupes, ${results.errors} errors`);
    return results;
  } catch (e) {
    logger.error(`[news-ingest-worker] Bridge failed: ${e.message}`);
    return results;
  }
}

export async function runNewsIngestCycle() {
  const started = Date.now();
  logger.info('[news-ingest-worker] Starting ingest cycle...');

  const results = {
    rss: { inserted: 0, duplicates: 0, errors: 0, sources: 0 },
    bridge: { bridged: 0, duplicates: 0, errors: 0 }
  };

  try {
    // 1. Ingest fresh RSS news
    results.rss = await ingestNews({ maxAgeMinutes: 60 });
  } catch (e) {
    logger.error(`[news-ingest-worker] RSS ingest failed: ${e.message}`);
    results.rss.errors++;
  }

  try {
    // 2. Bridge social intel
    results.bridge = await bridgeSocialToNewsEvents();
  } catch (e) {
    logger.error(`[news-ingest-worker] Bridge failed: ${e.message}`);
    results.bridge.errors++;
  }

  const duration = Date.now() - started;
  logger.info(`[news-ingest-worker] Cycle complete in ${duration}ms: RSS=${results.rss.inserted}, Bridge=${results.bridge.bridged}`);
  return { ok: true, ...results, duration_ms: duration };
}

async function main() {
  const once = process.argv.includes('--once');
  const intervalSeconds = Number(process.env.NEWS_INGEST_INTERVAL_SECONDS || 180); // 3 min default

  logger.info(`[news-ingest-worker] Starting. once=${once}, interval=${intervalSeconds}s`);

  do {
    try {
      await runNewsIngestCycle();
    } catch (error) {
      logger.error(`[news-ingest-worker] Cycle failed: ${error.message}`);
    }

    if (once) break;
    await sleep(intervalSeconds * 1000);
  } while (true);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
