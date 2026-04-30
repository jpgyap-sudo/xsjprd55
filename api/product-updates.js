// ============================================================
// Product Updates API — xsjprd55
// GET  /api/product-updates              → list (supports category, search, pagination)
// GET  /api/product-updates?stats=1     → stats
// POST /api/product-updates              → manually add update
// ============================================================

import {
  initProductUpdateTables,
  listProductUpdates,
  countProductUpdates,
  getUpdateStats,
  addProductUpdate
} from '../lib/advisor/product-update-log.js';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body, null, 2));
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
  initProductUpdateTables();

  const url = new URL(req.url, 'http://localhost');

  // ── GET: List or Stats ────────────────────────────────────
  if (req.method === 'GET') {
    if (url.searchParams.get('stats')) {
      try {
        const stats = getUpdateStats();
        return sendJson(res, 200, { ok: true, stats });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    const category = url.searchParams.get('category') || undefined;
    const author = url.searchParams.get('author') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
    const offset = Number(url.searchParams.get('offset') || 0);

    try {
      const updates = listProductUpdates({ category, author, search, limit, offset });
      const total = countProductUpdates({ category, author, search });
      return sendJson(res, 200, { ok: true, updates, total, offset, limit });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  // ── POST: Add manual update ──────────────────────────────
  if (req.method === 'POST') {
    const body = await readBody(req);
    if (!body.title || !body.description) {
      return sendJson(res, 400, { ok: false, error: 'Missing title or description' });
    }
    try {
      const update = addProductUpdate({
        version: body.version || '',
        title: body.title,
        description: body.description,
        category: body.category || 'feature',
        affectedFiles: body.affectedFiles || [],
        author: body.author || 'user',
        tags: body.tags || [],
        metadata: body.metadata || {}
      });
      return sendJson(res, 201, { ok: true, update });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
}
