// ============================================================
// Learning Loop Worker — Runs the self-improving feedback loop
// Schedule: every 6 hours (configurable via LEARNING_INTERVAL_HOURS)
// ============================================================

import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { runLearningLoop } from '../lib/learning-loop.js';

const INTERVAL_MS = (parseInt(process.env.LEARNING_INTERVAL_HOURS) || 6) * 60 * 60 * 1000;
const ENABLED = process.env.ENABLE_LEARNING_WORKER !== 'false';

async function run() {
  logger.info('[LEARNING_WORKER] Running learning loop...');
  try {
    const results = await runLearningLoop();
    logger.info('[LEARNING_WORKER] Loop completed:', results);
  } catch (e) {
    logger.error('[LEARNING_WORKER] Loop error:', e.message);
  }
}

if (!ENABLED) {
  logger.info('[LEARNING_WORKER] Disabled via ENABLE_LEARNING_WORKER=false');
  process.exit(0);
}

// Initial run after 60s (let server boot first)
setTimeout(run, 60_000);

// Then every 6 hours
setInterval(run, INTERVAL_MS);

logger.info(`[LEARNING_WORKER] Started — runs every ${INTERVAL_MS / 3600000}h`);
