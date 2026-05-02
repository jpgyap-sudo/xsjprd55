// ============================================================
// Signal Generator Worker — VPS Signal Scan Runner
// Calls the local /api/signals endpoint every 15 minutes
// to ensure the signals table is continuously populated.
// ============================================================

import fetch from 'node-fetch';
import { logger } from '../lib/logger.js';

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const SERVER_PORT = process.env.PORT || 3000;
const API_URL = `http://localhost:${SERVER_PORT}/api/signals`;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000); // 60s timeout
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      logger.warn(`[SIGNAL-GEN] Retry ${i + 1}/${retries} after ${RETRY_DELAY_MS}ms: ${e.message}`);
      await sleep(RETRY_DELAY_MS * (i + 1));
    }
  }
  throw new Error('Max retries exceeded');
}

async function runSignalGenerator() {
  logger.info('[SIGNAL-GEN] Starting signal scan...');

  try {
    if (!process.env.CRON_SECRET) {
      logger.error('[SIGNAL-GEN] CRON_SECRET missing; refusing to run protected signal scan');
      return;
    }

    const res = await fetchWithRetry(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET
      },
      body: JSON.stringify({}),
      keepalive: true,
    });

    if (!res.ok) {
      const text = await res.text();
      logger.warn(`[SIGNAL-GEN] API returned ${res.status}: ${text.slice(0, 200)}`);
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
