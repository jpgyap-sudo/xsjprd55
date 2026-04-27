// ============================================================
// Learning Loop Worker — Runs the self-improving feedback loop
// Schedule: every 6 hours (configurable via CRON_LEARNING)
// ============================================================

import cron from 'node-cron';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { runLearningLoop } from '../lib/learning-loop.js';

const CRON_LEARNING = config.CRON_LEARNING || '0 */6 * * *';
const ENABLED = config.ENABLE_LEARNING_WORKER !== 'false';

let task = null;

export function startLearningWorker() {
  if (!ENABLED) {
    logger.info('[LEARNING_WORKER] Disabled via ENABLE_LEARNING_WORKER=false');
    return;
  }

  if (CRON_LEARNING === 'false') {
    logger.info('[LEARNING_WORKER] Disabled via CRON_LEARNING=false');
    return;
  }

  if (!cron.validate(CRON_LEARNING)) {
    logger.error(`[LEARNING_WORKER] Invalid cron expression: ${CRON_LEARNING}`);
    return;
  }

  task = cron.schedule(CRON_LEARNING, async () => {
    logger.info(`[LEARNING_WORKER] Triggered (schedule: ${CRON_LEARNING})`);
    try {
      const results = await runLearningLoop();
      logger.info('[LEARNING_WORKER] Loop completed:', results);
    } catch (e) {
      logger.error('[LEARNING_WORKER] Loop error:', e.message);
    }
  });

  logger.info(`[LEARNING_WORKER] Started with schedule: ${CRON_LEARNING}`);
}

export function stopLearningWorker() {
  if (task) {
    task.stop();
    logger.info('[LEARNING_WORKER] Stopped');
  }
}

// Immediate run for testing
export async function runLearningWorkerNow() {
  logger.info('[LEARNING_WORKER] Running immediately...');
  return runLearningLoop();
}
