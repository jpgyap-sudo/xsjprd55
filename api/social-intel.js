// ============================================================
// API: /api/social-intel — Neural Social Intelligence Endpoint
// Endpoints:
//   ?type=latest&symbol=BTCUSDT&limit=10  -> latest events
//   ?type=health                          -> source health
//   ?type=messages&agent=signal_engine    -> pending agent messages
//   ?type=mark-done&id=uuid               -> mark message done (POST)
//   ?type=run&secret=CRON_SECRET          -> trigger manual crawl (POST)
// ============================================================

import { runSocialNewsCycle } from '../workers/social-news-worker.js';
import { getLatestEvents, getSocialHealth, getEventsForSignalWindow } from '../lib/social-intel-store.js';
import { getPendingAgentMessages, markAgentMessageDone } from '../lib/agent-signal-bus.js';
import { logger } from '../lib/logger.js';

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
    const type = url.searchParams.get('type') || 'latest';

    // ── Trigger manual crawl ──────────────────────────────
    if (type === 'run') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, error: 'Unauthorized. Missing or invalid CRON_SECRET.' });
      }
      logger.info('[api/social-intel] Manual run triggered');
      const result = await runSocialNewsCycle();
      return sendJson(res, 200, { ok: true, result });
    }

    // ── Latest events ─────────────────────────────────────
    if (type === 'latest') {
      const symbol = url.searchParams.get('symbol');
      const limit = Number(url.searchParams.get('limit') || 25);
      const events = await getLatestEvents({ symbol, limit });
      return sendJson(res, 200, { ok: true, count: events.length, events });
    }

    // ── Signal window events (for signal engine) ─────────
    if (type === 'signal-window') {
      const symbol = url.searchParams.get('symbol');
      const minutes = Number(url.searchParams.get('minutes') || 60);
      const events = await getEventsForSignalWindow({ symbol, minutes });
      return sendJson(res, 200, { ok: true, count: events.length, events });
    }

    // ── Source health ─────────────────────────────────────
    if (type === 'health') {
      const health = await getSocialHealth();
      return sendJson(res, 200, { ok: true, health });
    }

    // ── Agent messages ────────────────────────────────────
    if (type === 'messages') {
      const agent = url.searchParams.get('agent') || 'signal_engine';
      const limit = Number(url.searchParams.get('limit') || 50);
      const messages = await getPendingAgentMessages(agent, limit);
      return sendJson(res, 200, { ok: true, agent, count: messages.length, messages });
    }

    // ── Mark message done ─────────────────────────────────
    if (type === 'mark-done') {
      if (!isAuthorized(req)) {
        return sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
      }
      const id = url.searchParams.get('id');
      if (!id) return sendJson(res, 400, { ok: false, error: 'Missing id' });
      await markAgentMessageDone(id);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 400, {
      ok: false,
      error: 'Unknown type',
      supported: ['run', 'latest', 'signal-window', 'health', 'messages', 'mark-done']
    });
  } catch (error) {
    logger.error(`[api/social-intel] error: ${error.message}`);
    return sendJson(res, 500, { ok: false, error: error.message });
  }
}
