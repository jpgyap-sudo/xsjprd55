// ============================================================
// Notification Worker
// Processes unsent critical/warning notifications.
// Runs every 60 seconds.
// ============================================================

import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { processUnsentNotifications } from '../lib/notification-engine.js';
import { isMainModule } from '../lib/entrypoint.js';

const INTERVAL_MS = 60 * 1000;

export async function runNotificationWorker() {
  if (!config.ENABLE_NOTIFICATION_WORKER) {
    logger.debug('[NOTIFY-WORKER] Disabled by config');
    return;
  }
  logger.info('[NOTIFY-WORKER] Checking unsent alerts...');
  await processUnsentNotifications();
}

if (isMainModule(import.meta.url)) {
  logger.info('[NOTIFY-WORKER] Starting loop...');
  await runNotificationWorker();
  setInterval(runNotificationWorker, INTERVAL_MS);
}
