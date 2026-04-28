// ============================================================
// Debug Crawler API — Trigger on-demand scans
// Protected with CRON_SECRET.
// ============================================================

import { runDebugCrawlerCycle } from '../workers/debug-crawler-worker.js';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body, null, 2));
}

function isAuthorized(req) {
  const url = new URL(req.url, 'http://localhost');
  const secret = url.searchParams.get('secret') || req.headers['x-cron-secret'];
  return process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const type = url.searchParams.get('type') || 'run';

    if (type === 'run') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, error: 'Unauthorized. Missing or invalid CRON_SECRET.' });
      }

      const result = await runDebugCrawlerCycle();
      return sendJson(res, result.ok ? 200 : 500, result);
    }

    return sendJson(res, 400, { ok: false, error: 'Unknown type', supported: ['run'] });
  } catch (error) {
    console.error('[api/debug-crawler] error:', error);
    return sendJson(res, 500, { ok: false, error: error.message });
  }
}
