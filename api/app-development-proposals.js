// ============================================================
// App Development Proposals API
// GET  /api/app-development-proposals          → list all
// GET  /api/app-development-proposals?status=pending → filtered
// POST /api/app-development-proposals          → create new (admin/auth)
// PATCH /api/app-development-proposals?id=N    → update status
// ============================================================

import { listProposals, updateProposalStatus, saveProposal, getProposalStats, initCapabilityTables } from '../lib/advisor/capability-consolidator.js';
import { db } from '../lib/ml/db.js';

export default async function handler(req, res) {
  initCapabilityTables();

  // ── GET ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { status, limit = '50' } = req.query || {};
    try {
      const proposals = listProposals({ status, limit: parseInt(limit, 10) });
      const stats = getProposalStats();
      return res.status(200).json({
        ok: true,
        proposals: proposals.map(p => ({
          id: p.id,
          title: p.title,
          description: p.description,
          category: p.category,
          capabilityArea: p.capability_area,
          impactScore: p.impact_score,
          effortEstimate: p.effort_estimate,
          proposedBy: p.proposed_by,
          status: p.status,
          reviewNotes: p.review_notes,
          createdAt: p.created_at,
          reviewedAt: p.reviewed_at,
          approvedAt: p.approved_at,
          implementedAt: p.implemented_at,
          tags: JSON.parse(p.tags || '[]'),
          metadata: JSON.parse(p.metadata_json || '{}')
        })),
        stats
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── POST (create) ──────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    try {
      const saved = saveProposal({
        title: body.title,
        description: body.description,
        category: body.category || 'feature',
        capability_area: body.capabilityArea || 'general',
        impact_score: body.impactScore || 0.5,
        effort_estimate: body.effortEstimate || 'medium',
        proposed_by: body.proposedBy || 'manual',
        tags: body.tags || [],
        metadata: body.metadata || {}
      });
      return res.status(201).json({ ok: true, proposal: saved });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── PATCH (review/update status) ───────────────────────────
  if (req.method === 'PATCH') {
    const { id, status, reviewNotes } = req.body || {};
    if (!id || !status) {
      return res.status(400).json({ ok: false, error: 'Missing id or status' });
    }
    const validStatuses = ['pending', 'approved', 'rejected', 'in_progress', 'implemented'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: `Invalid status. Use: ${validStatuses.join(', ')}` });
    }
    try {
      updateProposalStatus(id, status, reviewNotes || '');
      return res.status(200).json({ ok: true, id, status });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
