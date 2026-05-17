// ============================================================
// Trading Learning Layer Worker — Runs the TLL pipeline
// Periodically: records outcomes, discovers patterns, detects
// regime, tunes weights, generates skills, heals strategies.
//
// Schedule: every TLL_INTERVAL_MS (default 30 min)
// ============================================================

import 'dotenv/config';
import { runLearningLayer } from '../lib/learning-layer/index.js';
import { logger } from '../lib/logger.js';

const INTERVAL_MS = parseInt(process.env.TLL_INTERVAL_MS || '1800000', 10); // 30 min default
const ENABLED = process.env.TLL_ENABLED !== 'false';
const WORKER_NAME = 'trading-learning-layer-worker';

async function tick() {
  logger.info(`[${WORKER_NAME}] Starting TLL cycle...`);
  try {
    const results = await runLearningLayer();
    logger.info(`[${WORKER_NAME}] Cycle complete:`, {
      outcomes: results.outcomesRecorded,
      patterns: results.patternsDiscovered,
      regime: results.regime?.regime,
      weights: results.weightsTuned,
      skills: results.skillsGenerated,
      healed: results.strategiesHealed,
      errors: results.errors.length,
      durationMs: results.durationMs,
    });
  } catch (err) {
    logger.error(`[${WORKER_NAME}] Cycle error:`, err.message);
  }
}

if (!ENABLED) {
  logger.info(`[${WORKER_NAME}] Disabled via TLL_ENABLED=false`);
  process.exit(0);
}

// Initial run after 30s delay (let server boot)
setTimeout(tick, 30_000);

// Then on interval
setInterval(tick, INTERVAL_MS);

logger.info(`[${WORKER_NAME}] Started — runs every ${INTERVAL_MS / 60000}min`);
