// ============================================================
// Capability Consolidator Worker
// Runs every 60 minutes to scan app capabilities and propose improvements.
// Saves proposals to memory log + SQLite for app development review.
// ============================================================

import { runConsolidationCycle } from '../lib/advisor/capability-consolidator.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

const INTERVAL_MS = 60 * 60 * 1000; // 60 min

export async function runCapabilityConsolidatorWorker() {
  if (!config.ENABLE_CAPABILITY_CONSOLIDATOR) {
    logger.debug('[CAPABILITY-WORKER] Disabled by config');
    return;
  }

  logger.info('[CAPABILITY-WORKER] Tick');

  try {
    const result = await runConsolidationCycle();
    logger.info(`[CAPABILITY-WORKER] Cycle complete: ${result.proposalsSaved} new proposals`);
  } catch (err) {
    logger.error(`[CAPABILITY-WORKER] ${err.message}`);
  }
}

// ── Standalone execution ────────────────────────────────────
if (process.argv.includes('--once')) {
  await runCapabilityConsolidatorWorker();
  process.exit(0);
} else {
  await runCapabilityConsolidatorWorker();
  setInterval(runCapabilityConsolidatorWorker, INTERVAL_MS);
}
