// ============================================================
// Social & Market Data Crawler Worker
// Periodically scrapes social/crypto sites for sentiment signals.
// Runs every 15 minutes on VPS.
// ============================================================

import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { runSocialCrawl } from '../lib/social-crawler.js';
import { supabase } from '../lib/supabase.js';
import { dedupSendIdea } from '../lib/agent-improvement-bus.js';

const INTERVAL_MS = 15 * 60 * 1000;

export async function runSocialCrawlerWorker() {
  if (!config.ENABLE_SOCIAL_CRAWLER_WORKER) {
    logger.debug('[SOCIAL-CRAWLER-WORKER] Disabled by config');
    return;
  }

  logger.info('[SOCIAL-CRAWLER-WORKER] Tick');

  try {
    const data = await runSocialCrawl();

    // Save aggregate sentiment to Supabase
    try {
      await supabase.from('social_sentiment').insert({
        source: 'aggregate',
        sentiment_score: data.overallSentiment?.score || 0,
        sentiment_label: data.overallSentiment?.label || 'neutral',
        raw_data: data,
        created_at: data.timestamp,
      });
    } catch (e) {
      // Table may not exist yet
    }

    // Save trending tokens from Birdeye
    if (data.birdeye?.trending?.length) {
      for (const token of data.birdeye.trending.slice(0, 5)) {
        try {
          await supabase.from('market_trends').insert({
            symbol: token.symbol,
            source: 'birdeye',
            price: token.price || null,
            change_24h: token.change24h || null,
            volume_approx: token.volume || null,
            raw: token,
            created_at: data.timestamp,
          });
        } catch (e) {
          // ignore
        }
      }
    }

    // Cross-agent improvement: flag sentiment extremes
    const score = data.overallSentiment?.score || 0;
    if (Math.abs(score) > 0.7) {
      await dedupSendIdea({
        sourceBot: 'Trading Signal Bot',
        ideaType: 'Data Source Improvement',
        featureAffected: 'Social Sentiment Scoring',
        observation: `Extreme social sentiment detected: ${score > 0 ? 'strongly bullish' : 'strongly bearish'} (${score.toFixed(2)}).`,
        recommendation: 'Consider contrarian signals when sentiment reaches extremes. High bullishness often precedes corrections.',
        expectedBenefit: 'Avoid FOMO entries and improve risk-adjusted returns.',
        priority: 'High',
        confidence: 'Medium',
        status: 'New',
      });
    }

    logger.info(`[SOCIAL-CRAWLER-WORKER] Tick complete. Sentiment: ${data.overallSentiment?.label}`);
  } catch (err) {
    logger.error(`[SOCIAL-CRAWLER-WORKER] ${err.message}`);
    await dedupSendIdea({
      sourceBot: 'Coding Bot',
      ideaType: 'Bug Fix',
      featureAffected: 'Social Crawler Worker',
      observation: `Social crawler crashed: ${err.message}`,
      recommendation: 'Add per-site error isolation so one failing site does not kill the whole crawl.',
      priority: 'Medium',
      confidence: 'High',
      status: 'New',
      relatedErrorId: err.message,
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  logger.info('[SOCIAL-CRAWLER-WORKER] Starting loop...');
  await runSocialCrawlerWorker();
  setInterval(runSocialCrawlerWorker, INTERVAL_MS);
}
