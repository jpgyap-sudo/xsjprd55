// ============================================================
// Signal Generator Worker — VPS Signal Scan Runner
// Calls the local /api/signals endpoint every 15 minutes
// to ensure the signals table is continuously populated.
// ============================================================

import { logger } from '../lib/logger.js';

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const SERVER_PORT = process.env.PORT || 3000;
const API_URL = `http://localhost:${SERVER_PORT}/api/signals`;

async function runSignalGenerator() {
  logger.info('[SIGNAL-GEN] Starting signal scan...');

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!res.ok) {
      const text = await res.text();
      logger.warn(`[SIGNAL-GEN] API returned ${res.status}: ${text}`);
      return;
    }

    const data = await res.json();
    logger.info(`[SIGNAL-GEN] Scan complete — ${data.signals?.length || 0} signals, ${data.errors?.length || 0} errors`);
  } catch (e) {
    logger.error(`[SIGNAL-GEN] Failed to reach ${API_URL}: ${e.message}`);
  }
}

// Initial run after 30s delay (let server boot first)
setTimeout(runSignalGenerator, 30_000);

// Then every 15 minutes
setInterval(runSignalGenerator, INTERVAL_MS);

logger.info('[SIGNAL-GEN] Worker started — scans every 15 minutes');
