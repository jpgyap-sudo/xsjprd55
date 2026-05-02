// ============================================================
// Social News Worker — Neural Social Intelligence Pipeline
// Crawls sources → dedup → neural analysis → score → broadcast
// Runs continuously on VPS via PM2.
// ============================================================

import { crawlSocialSources } from '../lib/social-crawler.js';
import { analyzePostWithNeuralModel } from '../lib/neural-news-analyzer.js';
import { scoreEventImpact, buildAgentPayload } from '../lib/event-impact-scorer.js';
import { broadcastSocialIntel } from '../lib/agent-signal-bus.js';
import { insertPostIfNew, insertNeuralEvent, upsertSourceHealth } from '../lib/social-intel-store.js';
import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/entrypoint.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runSocialNewsCycle() {
  const started = Date.now();
  logger.info('[SOCIAL-NEWS-WORKER] Starting news cycle...');

  const { posts, health } = await crawlSocialSources();
  await upsertSourceHealth(health);

  const insertedPosts = [];
  const events = [];
  let skippedDuplicates = 0;

  for (const rawPost of posts) {
    try {
      const { post, inserted } = await insertPostIfNew(rawPost);
      if (!inserted) {
        skippedDuplicates++;
        continue;
      }

      insertedPosts.push(post);

      const analysis = await analyzePostWithNeuralModel(post);
      const eventScore = scoreEventImpact(analysis);

      const event = await insertNeuralEvent({
        post_id: post.id,
        symbol: analysis.symbol,
        symbols: analysis.symbols || [],
        event_type: analysis.event_type,
        sentiment_score: analysis.sentiment_score,
        confidence: analysis.confidence,
        impact_level: analysis.impact_level,
        urgency: analysis.urgency,
        source_quality: analysis.source_quality,
        summary: analysis.summary,
        suggested_bias: analysis.suggested_bias,
        time_decay_minutes: analysis.time_decay_minutes,
        event_score: eventScore,
        model_name: analysis.model_name,
        model_provider: analysis.model_provider,
        features: analysis.features || {}
      });

      events.push(event);

      // Only broadcast high-confidence or high-impact events
      if (analysis.confidence >= 0.55 || eventScore >= 0.5) {
        const payload = buildAgentPayload(event, post);
        await broadcastSocialIntel(payload);
      }
    } catch (error) {
      logger.error(`[SOCIAL-NEWS-WORKER] Post failed: ${error.message}`);
    }
  }

  const result = {
    ok: true,
    crawled_posts: posts.length,
    inserted_posts: insertedPosts.length,
    skipped_duplicates: skippedDuplicates,
    created_events: events.length,
    duration_ms: Date.now() - started
  };

  logger.info(`[SOCIAL-NEWS-WORKER] Cycle complete: ${JSON.stringify(result)}`);
  return result;
}

async function main() {
  const once = process.argv.includes('--once');
  const intervalSeconds = Number(process.env.SOCIAL_WORKER_INTERVAL_SECONDS || 300);

  logger.info(`[SOCIAL-NEWS-WORKER] Starting. once=${once}, interval=${intervalSeconds}s`);

  do {
    try {
      await runSocialNewsCycle();
    } catch (error) {
      logger.error(`[SOCIAL-NEWS-WORKER] Cycle failed: ${error.message}`);
    }

    if (once) break;
    await sleep(intervalSeconds * 1000);
  } while (true);
}

if (isMainModule(import.meta.url)) {
  main();
}
