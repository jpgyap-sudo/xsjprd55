// ============================================================
// API Debugger API Route
// GET  /api/api-debugger          -> list recent results
// GET  /api/api-debugger?run=1    -> trigger on-demand scan
// POST /api/api-debugger          -> trigger on-demand scan (with secret)
// ============================================================

import { runApiDebuggerCycle } from '../workers/api-debugger-worker.js';
import { listApiDebugResults, updateApiDebugStatus } from '../lib/api-debugger/api-debugger-store.js';

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET || 'dev-secret';
  const q = new URL(req.url, `http://${req.headers.host}`).searchParams.get('secret');
  return q === secret;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;

  // List results (read-only, no auth required)
  if (method === 'GET' && !url.searchParams.has('run')) {
    try {
      const provider = url.searchParams.get('provider');
      const status = url.searchParams.get('status');
      const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
      const results = await listApiDebugResults({ provider, status, limit });
      return sendJson(res, 200, { ok: true, count: results.length, results });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  // Trigger scan (requires secret)
  if ((method === 'GET' && url.searchParams.has('run')) || method === 'POST') {
    if (!isAuthorized(req)) {
      return sendJson(res, 403, { ok: false, error: 'Forbidden: invalid secret' });
    }

    // Fire-and-forget scan (don't block HTTP response)
    runApiDebuggerCycle()
      .then(result => {
        console.log('[api-debugger] On-demand scan complete:', result.runId);
      })
      .catch(err => {
        console.error('[api-debugger] On-demand scan failed:', err.message);
      });

    return sendJson(res, 202, { ok: true, message: 'Scan started' });
  }

  // PATCH status update (requires secret)
  if (method === 'PATCH') {
    if (!isAuthorized(req)) {
      return sendJson(res, 403, { ok: false, error: 'Forbidden: invalid secret' });
    }
    const body = await readBody(req);
    if (!body.id || !body.status) {
      return sendJson(res, 400, { ok: false, error: 'Missing id or status' });
    }
    try {
      const updated = await updateApiDebugStatus(body.id, {
        status: body.status,
        severity: body.severity,
        neural_review: body.neural_review,
        docs_reference: body.docs_reference
      });
      return sendJson(res, 200, { ok: true, updated });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
}
