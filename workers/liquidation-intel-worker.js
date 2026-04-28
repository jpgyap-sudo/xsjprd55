// ============================================================
// Liquidation Intel Worker
// Fetches liquidation data every 30 min, broadcasts TOP 10 to Telegram.
// ============================================================

import { buildLiquidationOverview, formatLiquidationTelegram } from '../lib/liquidation.js';
import { sendTelegram } from '../lib/telegram.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

const INTERVAL_MS = 30 * 60 * 1000; // 30 min
const GROUP_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

export async function runLiquidationIntelWorker() {
  logger.info('[LIQ-INTEL-WORKER] Tick');

  try {
    const data = await buildLiquidationOverview();
    if (!data.ok) {
      logger.warn('[LIQ-INTEL-WORKER] Data build failed');
      return;
    }

    // Only broadcast if we have good data
    if (!data.topShorts?.length && !data.topLongs?.length) {
      logger.info('[LIQ-INTEL-WORKER] No setups to broadcast');
      return;
    }

    const msg = formatLiquidationTelegram(data);

    // Send to Telegram group if configured
    if (GROUP_ID) {
      await sendTelegram(GROUP_ID, msg, { parse_mode: 'Markdown' });
      logger.info(`[LIQ-INTEL-WORKER] Broadcasted to Telegram — ${data.topShorts?.length || 0} shorts, ${data.topLongs?.length || 0} longs`);
    } else {
      logger.info('[LIQ-INTEL-WORKER] No TELEGRAM_GROUP_CHAT_ID set, skipping broadcast');
    }
  } catch (err) {
    logger.error(`[LIQ-INTEL-WORKER] ${err.message}`);
  }
}

// ── Standalone execution ────────────────────────────────────
if (process.argv.includes('--once')) {
  await runLiquidationIntelWorker();
  process.exit(0);
} else {
  runLiquidationIntelWorker();
  setInterval(runLiquidationIntelWorker, INTERVAL_MS);
}
