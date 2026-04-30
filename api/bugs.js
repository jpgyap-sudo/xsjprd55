// ============================================================
// Bugs API — CRUD + status management for debug crawler findings
// Protected writes with CRON_SECRET.
// ============================================================

import {
  createBugReport,
  bulkCreateBugReports,
  listBugs,
  updateBugStatus,
  getBugHistory
} from '../lib/bug-store.js';

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
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const type = url.searchParams.get('type') || 'list';

    if (type === 'list') {
      const status = url.searchParams.get('status') || undefined;
      const severity = url.searchParams.get('severity') || undefined;
      const excludeStatus = url.searchParams.get('exclude_status') || undefined;
      const limit = Number(url.searchParams.get('limit') || 100);
      let bugs = await listBugs({ status, severity, excludeStatus, limit });
      // Deduplicate by fingerprint — keep the most recent per fingerprint
      const seen = new Map();
      for (const b of bugs) {
        if (!b.id) continue; // skip rows with no ID
        if (!b.fingerprint) { seen.set(b.id, b); continue; }
        const existing = seen.get(b.fingerprint);
        if (!existing || new Date(b.detected_at || b.created_at) > new Date(existing.detected_at || existing.created_at)) {
          seen.set(b.fingerprint, b);
        }
      }
      bugs = Array.from(seen.values()).sort((a, b) => new Date(b.detected_at || b.created_at) - new Date(a.detected_at || a.created_at));
      return sendJson(res, 200, { ok: true, bugs, deduped: true, total: bugs.length });
    }

    if (type === 'create') {
      if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
      const body = await readBody(req);
      const bug = await createBugReport(body);
      return sendJson(res, 200, { ok: true, bug });
    }

    if (type === 'bulk-create') {
      if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
      const body = await readBody(req);
      const bugs = await bulkCreateBugReports(body.findings || []);
      return sendJson(res, 200, { ok: true, count: bugs.length, bugs });
    }

    if (type === 'update-status') {
      if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
      const id = url.searchParams.get('id');
      if (!id) return sendJson(res, 400, { ok: false, error: 'Missing bug id' });
      const body = await readBody(req);
      const bug = await updateBugStatus(id, body);
      return sendJson(res, 200, { ok: true, bug });
    }

    if (type === 'history') {
      const id = url.searchParams.get('id');
      if (!id) return sendJson(res, 400, { ok: false, error: 'Missing bug id' });
      const history = await getBugHistory(id);
      return sendJson(res, 200, { ok: true, history });
    }

    return sendJson(res, 400, {
      ok: false,
      error: 'Unknown type',
      supported: ['list', 'create', 'bulk-create', 'update-status', 'history']
    });
  } catch (error) {
    console.error('[api/bugs] error:', error);
    return sendJson(res, 500, { ok: false, error: error.message });
  }
}
