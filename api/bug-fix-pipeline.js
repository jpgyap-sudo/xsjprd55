// ============================================================
// Bug Auto-Fix Pipeline API — xsjprd55
// GET  /api/bug-fix-pipeline?action=stats    → pipeline stats
// POST /api/bug-fix-pipeline?action=run      → trigger cycle
// POST /api/bug-fix-pipeline?action=queue    → manually queue a bug
// ============================================================

import {
  runBugAutoFixCycle,
  getBugFixPipelineStats,
  manualQueueBugForFix,
  initBugFixPipelineTables
} from '../lib/advisor/bug-fix-pipeline.js';

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

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  initBugFixPipelineTables();

  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || 'stats';

  // ── GET: Stats ─────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const stats = await getBugFixPipelineStats();
      return sendJson(res, 200, { ok: true, stats });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  // ── POST: Run cycle or queue bug ──────────────────────────
  if (req.method === 'POST') {
    if (action === 'run') {
      if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
      try {
        const result = await runBugAutoFixCycle();
        return sendJson(res, 200, { ok: true, result });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    if (action === 'queue') {
      const body = await readBody(req);
      if (!body.bugId) return sendJson(res, 400, { ok: false, error: 'Missing bugId' });
      try {
        const result = await manualQueueBugForFix(body.bugId);
        return sendJson(res, 200, { ok: true, result });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    return sendJson(res, 400, { ok: false, error: 'Unknown action. Use: run, queue' });
  }

  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
}
