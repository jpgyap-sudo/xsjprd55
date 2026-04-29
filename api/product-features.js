// ============================================================
// Product Features API — Feature inventory + health tracking
// GET    /api/product-features?limit=50              → list all
// POST   /api/product-features                       → create/update
// POST   /api/product-features?action=check&id=X     → run health check
// POST   /api/product-features?action=debug&id=X     → send to debugger
// POST   /api/product-features?action=fix&id=X       → send to coder
// ============================================================

import { supabase } from '../lib/supabase.js';

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

// ── GET ────────────────────────────────────────────────────
async function handleGet(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const limit = Number(url.searchParams.get('limit') || 100);
  const status = url.searchParams.get('status') || undefined;
  const category = url.searchParams.get('category') || undefined;
  const priority = url.searchParams.get('priority') || undefined;

  try {
    // Build query
    let query = supabase.from('product_features').select('*', { count: 'exact' });
    if (status) query = query.eq('status', status);
    if (category) query = query.eq('category', category);
    if (priority) query = query.eq('priority', priority);
    query = query.order('priority', { ascending: false }).limit(limit);

    const { data, error, count } = await query;
    if (error) throw error;

    // Compute stats
    const stats = {
      total: count || data?.length || 0,
      byStatus: {},
      byCategory: {},
      byPriority: {},
      needsCheck: 0,
      hasBugs: 0,
      inProgress: 0
    };
    for (const f of data || []) {
      stats.byStatus[f.status] = (stats.byStatus[f.status] || 0) + 1;
      stats.byCategory[f.category] = (stats.byCategory[f.category] || 0) + 1;
      stats.byPriority[f.priority] = (stats.byPriority[f.priority] || 0) + 1;
      if (f.status === 'Needs Check') stats.needsCheck++;
      if (f.bug_notes) stats.hasBugs++;
      if (f.status === 'In Progress') stats.inProgress++;
    }

    return sendJson(res, 200, {
      ok: true,
      features: (data || []).map(f => ({
        id: f.id,
        featureId: f.feature_id,
        name: f.name,
        category: f.category,
        description: f.description,
        status: f.status,
        priority: f.priority,
        lastChecked: f.last_checked,
        bugNotes: f.bug_notes,
        debuggerStatus: f.debugger_status,
        coderStatus: f.coder_status,
        relatedFiles: f.related_files || [],
        improvementProposal: f.improvement_proposal,
        createdAt: f.created_at,
        updatedAt: f.updated_at
      })),
      stats
    });
  } catch (e) {
    console.error('[api/product-features] GET error:', e);
    return sendJson(res, 500, { ok: false, error: e.message });
  }
}

// ── POST ───────────────────────────────────────────────────
async function handlePost(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action');

  // Run health check on a feature
  if (action === 'check') {
    const id = url.searchParams.get('id');
    if (!id) return sendJson(res, 400, { ok: false, error: 'Missing feature id' });
    return runHealthCheck(id, res);
  }

  // Send to debugger
  if (action === 'debug') {
    const id = url.searchParams.get('id');
    if (!id) return sendJson(res, 400, { ok: false, error: 'Missing feature id' });
    return sendToDebugger(id, res);
  }

  // Send to coder
  if (action === 'fix') {
    const id = url.searchParams.get('id');
    if (!id) return sendJson(res, 400, { ok: false, error: 'Missing feature id' });
    return sendToCoder(id, res);
  }

  // Bulk health check
  if (action === 'bulk-check') {
    if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    return runBulkHealthCheck(res);
  }

  // Create or update feature
  const body = await readBody(req);
  const { id, featureId, name, category, description, status, priority,
          bugNotes, relatedFiles, improvementProposal } = body;

  if (!featureId || !name) {
    return sendJson(res, 400, { ok: false, error: 'Missing featureId or name' });
  }

  try {
    const payload = {
      feature_id: featureId,
      name,
      category: category || 'General',
      description: description || null,
      status: status || 'Needs Check',
      priority: priority || 'Medium',
      bug_notes: bugNotes || null,
      related_files: relatedFiles || [],
      improvement_proposal: improvementProposal || null,
      last_checked: new Date().toISOString()
    };

    if (id) {
      // Update existing
      const { data, error } = await supabase
        .from('product_features')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return sendJson(res, 200, { ok: true, feature: data, action: 'updated' });
    } else {
      // Upsert by feature_id
      const { data, error } = await supabase
        .from('product_features')
        .upsert(payload, { onConflict: 'feature_id' })
        .select()
        .single();
      if (error) throw error;
      return sendJson(res, 200, { ok: true, feature: data, action: 'created' });
    }
  } catch (e) {
    console.error('[api/product-features] POST error:', e);
    return sendJson(res, 500, { ok: false, error: e.message });
  }
}

// ── Health Check ───────────────────────────────────────────
async function runHealthCheck(featureId, res) {
  try {
    const { data: feature, error } = await supabase
      .from('product_features')
      .select('*')
      .eq('feature_id', featureId)
      .single();
    if (error) throw error;
    if (!feature) return sendJson(res, 404, { ok: false, error: 'Feature not found' });

    const files = feature.related_files || [];
    const results = [];
    const fs = await import('fs');
    const path = await import('path');

    for (const file of files) {
      const fullPath = path.join(process.cwd(), file);
      const exists = fs.existsSync(fullPath);
      results.push({ file, exists, path: fullPath });
    }

    const allExist = results.every(r => r.exists);
    const newStatus = allExist ? 'Working' : 'Broken';
    const bugText = allExist
      ? null
      : `Missing files: ${results.filter(r => !r.exists).map(r => r.file).join(', ')}`;

    const { data: updated, error: upErr } = await supabase
      .from('product_features')
      .update({
        status: newStatus,
        last_checked: new Date().toISOString(),
        bug_notes: bugText,
        debugger_status: bugText ? 'Pending' : 'OK'
      })
      .eq('feature_id', featureId)
      .select()
      .single();
    if (upErr) throw upErr;

    return sendJson(res, 200, {
      ok: true,
      feature: updated,
      health: { allExist, results }
    });
  } catch (e) {
    console.error('[api/product-features] health check error:', e);
    return sendJson(res, 500, { ok: false, error: e.message });
  }
}

async function runBulkHealthCheck(res) {
  try {
    const { data: features, error } = await supabase
      .from('product_features')
      .select('*');
    if (error) throw error;

    const fs = await import('fs');
    const path = await import('path');
    const results = [];

    for (const feature of features || []) {
      const files = feature.related_files || [];
      const fileChecks = files.map(f => ({
        file: f,
        exists: fs.existsSync(path.join(process.cwd(), f))
      }));
      const allExist = fileChecks.every(r => r.exists);
      const newStatus = allExist ? 'Working' : 'Broken';
      const bugText = allExist
        ? null
        : `Missing files: ${fileChecks.filter(r => !r.exists).map(r => r.file).join(', ')}`;

      const { error: upErr } = await supabase
        .from('product_features')
        .update({
          status: newStatus,
          last_checked: new Date().toISOString(),
          bug_notes: bugText,
          debugger_status: bugText ? 'Pending' : 'OK'
        })
        .eq('feature_id', feature.feature_id);
      if (upErr) console.error(`[bulk-check] ${feature.feature_id}:`, upErr.message);

      results.push({
        featureId: feature.feature_id,
        name: feature.name,
        status: newStatus,
        allExist,
        fileChecks
      });
    }

    return sendJson(res, 200, { ok: true, checked: results.length, results });
  } catch (e) {
    console.error('[api/product-features] bulk check error:', e);
    return sendJson(res, 500, { ok: false, error: e.message });
  }
}

// ── Send to Debugger ───────────────────────────────────────
async function sendToDebugger(featureId, res) {
  try {
    const { data: feature, error } = await supabase
      .from('product_features')
      .select('*')
      .eq('feature_id', featureId)
      .single();
    if (error) throw error;
    if (!feature) return sendJson(res, 404, { ok: false, error: 'Feature not found' });

    // Create a bug report from the feature's bug notes
    if (feature.bug_notes) {
      const bugPayload = {
        title: `[Feature] ${feature.name} health issue`,
        description: feature.bug_notes,
        severity: feature.priority === 'Critical' ? 'high' : 'medium',
        source: 'product-feature-health',
        feature_id: featureId,
        related_files: feature.related_files || []
      };

      // Send to bug-fix pipeline API if available
      try {
        const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
        await fetch(`${baseUrl}/api/bugs?type=create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-cron-secret': process.env.CRON_SECRET || ''
          },
          body: JSON.stringify(bugPayload)
        });
      } catch (fetchErr) {
        console.warn('[product-features] bug pipeline not reachable:', fetchErr.message);
      }
    }

    const { data: updated, error: upErr } = await supabase
      .from('product_features')
      .update({
        debugger_status: 'Sent',
        updated_at: new Date().toISOString()
      })
      .eq('feature_id', featureId)
      .select()
      .single();
    if (upErr) throw upErr;

    return sendJson(res, 200, {
      ok: true,
      feature: updated,
      message: 'Feature sent to debugger. Bug report created if issues found.'
    });
  } catch (e) {
    console.error('[api/product-features] debug error:', e);
    return sendJson(res, 500, { ok: false, error: e.message });
  }
}

// ── Send to Coder ──────────────────────────────────────────
async function sendToCoder(featureId, res) {
  try {
    const { data: feature, error } = await supabase
      .from('product_features')
      .select('*')
      .eq('feature_id', featureId)
      .single();
    if (error) throw error;
    if (!feature) return sendJson(res, 404, { ok: false, error: 'Feature not found' });

    // Create an app development proposal from the improvement
    if (feature.improvement_proposal) {
      const proposalPayload = {
        title: `[Feature] ${feature.name} — ${feature.improvement_proposal.slice(0, 60)}`,
        description: feature.improvement_proposal,
        category: 'feature',
        capabilityArea: feature.category,
        impactScore: feature.priority === 'Critical' ? 0.9 : feature.priority === 'High' ? 0.75 : 0.5,
        effortEstimate: 'medium',
        tags: ['product-feature', feature.featureId],
        metadata: { source: 'product-features', feature_id: featureId }
      };

      try {
        const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
        await fetch(`${baseUrl}/api/app-development-proposals?action=create-manual`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-cron-secret': process.env.CRON_SECRET || ''
          },
          body: JSON.stringify(proposalPayload)
        });
      } catch (fetchErr) {
        console.warn('[product-features] proposals API not reachable:', fetchErr.message);
      }
    }

    const { data: updated, error: upErr } = await supabase
      .from('product_features')
      .update({
        coder_status: 'Sent',
        updated_at: new Date().toISOString()
      })
      .eq('feature_id', featureId)
      .select()
      .single();
    if (upErr) throw upErr;

    return sendJson(res, 200, {
      ok: true,
      feature: updated,
      message: 'Feature sent to coder. Development proposal created if improvement exists.'
    });
  } catch (e) {
    console.error('[api/product-features] fix error:', e);
    return sendJson(res, 500, { ok: false, error: e.message });
  }
}

// ── Main handler ───────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
}
