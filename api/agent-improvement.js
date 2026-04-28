// ============================================================
// Agent Improvement Ideas API
// GET  /api/agent-improvement — list ideas with optional filters
// POST /api/agent-improvement — create new idea
// PATCH /api/agent-improvement?id=<uuid> — update status
// GET  /api/agent-improvement/summary — dashboard card counts
// ============================================================

import { getIdeas, sendIdea, updateIdeaStatus, getIdeaSummary } from '../lib/agent-improvement-bus.js';

export default async function handler(req, res) {
  const { pathname, query, method, body } = req;

  try {
    // ── Summary ────────────────────────────────────────────────
    if (pathname === '/api/agent-improvement/summary' && method === 'GET') {
      const summary = await getIdeaSummary();
      return res.status(200).json({ success: true, summary });
    }

    // ── List ideas ─────────────────────────────────────────────
    if (pathname === '/api/agent-improvement' && method === 'GET') {
      const ideas = await getIdeas({
        status: query.status,
        sourceBot: query.sourceBot,
        limit: Math.min(Number(query.limit) || 100, 500),
        offset: Number(query.offset) || 0,
      });
      return res.status(200).json({ success: true, count: ideas.length, ideas });
    }

    // ── Create idea ────────────────────────────────────────────
    if (pathname === '/api/agent-improvement' && method === 'POST') {
      const id = await sendIdea(body);
      if (!id) return res.status(400).json({ success: false, error: 'Invalid idea data' });
      return res.status(201).json({ success: true, id });
    }

    // ── Update status ──────────────────────────────────────────
    if (pathname === '/api/agent-improvement' && method === 'PATCH') {
      const id = query.id;
      if (!id || !body.status) {
        return res.status(400).json({ success: false, error: 'Missing id or status' });
      }
      const ok = await updateIdeaStatus(id, body.status, body);
      return res.status(ok ? 200 : 404).json({ success: ok });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
