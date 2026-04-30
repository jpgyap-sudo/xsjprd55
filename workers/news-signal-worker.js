// ============================================================
// News Signal Worker — Daily news-to-signal analysis
// PM2 runs this via cron_restart: '0 1 * * *' (1 AM UTC)
// Replaces the old vercel.json cron: GET /api/news-signal
// ============================================================

import { logger } from '../lib/logger.js';

const BASE = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
const SECRET = process.env.CRON_SECRET || '';

async function run() {
  logger.info('[NEWS-SIGNAL-WORKER] Starting daily news signal scan...');
  try {
    const url = `${BASE}/api/news-signal`;
    const headers = { 'Content-Type': 'application/json' };
    if (SECRET) headers['x-cron-secret'] = SECRET;

    const res = await fetch(url, { method: 'POST', headers });
    const data = await res.json();
    if (data.ok) {
      logger.info('[NEWS-SIGNAL-WORKER] Done:', data);
    } else {
      logger.error('[NEWS-SIGNAL-WORKER] API error:', data.error);
    }
  } catch (e) {
    logger.error('[NEWS-SIGNAL-WORKER] Failed:', e.message);
  }
  process.exit(0);
}

run();
