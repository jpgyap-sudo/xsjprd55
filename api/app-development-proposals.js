// ============================================================
// App Development Proposals API — xsjprd55 v2
// GET    /api/app-development-proposals           → list all
// GET    /api/app-development-proposals?status=X  → filtered
// POST   /api/app-development-proposals           → create new
// PATCH  /api/app-development-proposals           → update status
// POST   /api/app-development-proposals?action=proceed → start development
// GET    /api/app-development-proposals?action=tasks → dev pipeline tasks
// ============================================================

import {
  listProposals,
  updateProposalStatus,
  saveProposal,
  getProposalStats,
  initCapabilityTables
} from '../lib/advisor/capability-consolidator.js';

import {
  listDevelopmentTasks,
  getTaskStats,
  proceedWithDevelopment,
  createDevelopmentTask,
  getTaskActions,
  initDevPipelineTables
} from '../lib/advisor/product-dev-pipeline.js';

import { runConsolidationCycle } from '../lib/advisor/capability-consolidator.js';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body, null, 2));
}

export default async function handler(req, res) {
  initCapabilityTables();
  initDevPipelineTables();

  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action');

  // ── GET ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    // Dev pipeline tasks view
    if (action === 'tasks') {
      const status = url.searchParams.get('status') || undefined;
      const limit = Number(url.searchParams.get('limit') || 50);
      try {
        const tasks = listDevelopmentTasks({ status, limit });
        const stats = getTaskStats();
        return sendJson(res, 200, { ok: true, tasks, stats });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    // Task actions history
    if (action === 'task-actions') {
      const taskId = url.searchParams.get('taskId');
      if (!taskId) return sendJson(res, 400, { ok: false, error: 'Missing taskId' });
      try {
        const actions = getTaskActions(Number(taskId));
        return sendJson(res, 200, { ok: true, actions });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    // Standard proposals list
    const status = url.searchParams.get('status') || undefined;
    const limit = Number(url.searchParams.get('limit') || 50);
    try {
      const proposals = listProposals({ status, limit });
      const stats = getProposalStats();
      const taskStats = getTaskStats();
      return sendJson(res, 200, {
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
        stats,
        taskStats
      });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  // ── POST ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};

    // Proceed with development from a proposal
    if (action === 'proceed') {
      const { proposalId, title, description, category, capabilityArea, impactScore, effortEstimate, tags } = body;
      if (!proposalId) {
        return sendJson(res, 400, { ok: false, error: 'Missing proposalId' });
      }
      try {
        const task = proceedWithDevelopment(proposalId, {
          title, description, category, capabilityArea, impactScore, effortEstimate, tags
        });
        // Update proposal status
        updateProposalStatus(proposalId, 'in_progress', `Development started. Task #${task.id} created for coding agent.`);
        return sendJson(res, 200, { ok: true, task, message: 'Development task created. Coding agent will pick it up automatically.' });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    // Create manual proposal
    if (action === 'create-manual') {
      const { title, description, category, capabilityArea, impactScore, effortEstimate, tags } = body;
      if (!title || !description) {
        return sendJson(res, 400, { ok: false, error: 'Missing title or description' });
      }
      try {
        const saved = saveProposal({
          title,
          description,
          category: category || 'feature',
          capability_area: capabilityArea || 'general',
          impact_score: impactScore || 0.5,
          effort_estimate: effortEstimate || 'medium',
          proposed_by: 'manual',
          tags: tags || [],
          metadata: { source: 'manual', created_by: 'user' }
        });
        return sendJson(res, 201, { ok: true, proposal: saved });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    // Trigger consolidation (old behavior)
    try {
      const result = await runConsolidationCycle();
      return sendJson(res, 200, { ok: true, result });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  // ── PATCH ──────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { id, status, reviewNotes } = req.body || {};
    if (!id || !status) {
      return sendJson(res, 400, { ok: false, error: 'Missing id or status' });
    }
    const validStatuses = ['pending', 'approved', 'rejected', 'in_progress', 'implemented'];
    if (!validStatuses.includes(status)) {
      return sendJson(res, 400, { ok: false, error: `Invalid status. Use: ${validStatuses.join(', ')}` });
    }
    try {
      updateProposalStatus(id, status, reviewNotes || '');
      return sendJson(res, 200, { ok: true, id, status });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
}
