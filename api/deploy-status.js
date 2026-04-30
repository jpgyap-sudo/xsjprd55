// ============================================================
// Deploy Status API — xsjprd55
// GET  /api/deploy-status              → list deploy history
// GET  /api/deploy-status?latest=1     → latest deploy record
// POST /api/deploy-status              → record a new deploy check
// ============================================================

import { supabase } from '../lib/supabase.js';

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

// ── GET ────────────────────────────────────────────────────
async function handleGet(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
  const offset = Number(url.searchParams.get('offset') || 0);

  try {
    if (url.searchParams.get('latest')) {
      const { data, error } = await supabase
        .from('deploy_history')
        .select('*')
        .order('checked_at', { ascending: false })
        .limit(1)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return sendJson(res, 200, { ok: true, deploy: data || null });
    }

    const { data, error, count } = await supabase
      .from('deploy_history')
      .select('*', { count: 'exact' })
      .order('checked_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return sendJson(res, 200, {
      ok: true,
      deploys: data || [],
      total: count || 0,
      offset,
      limit
    });
  } catch (e) {
    console.error('[api/deploy-status] GET error:', e);
    return sendJson(res, 500, { ok: false, error: e.message });
  }
}

// ── POST ───────────────────────────────────────────────────
async function handlePost(req, res) {
  const body = await readBody(req);
  const {
    github_commit,
    github_commit_date,
    vps_commit,
    vps_commit_date,
    status,
    error_message,
    deploy_started_at,
    deploy_finished_at,
    health_check_ok,
    pm2_status
  } = body;

  try {
    const { data, error } = await supabase
      .from('deploy_history')
      .insert({
        github_commit: github_commit || null,
        github_commit_date: github_commit_date || null,
        vps_commit: vps_commit || null,
        vps_commit_date: vps_commit_date || null,
        status: status || 'unknown',
        error_message: error_message || null,
        deploy_started_at: deploy_started_at || null,
        deploy_finished_at: deploy_finished_at || null,
        health_check_ok: health_check_ok ?? null,
        pm2_status: pm2_status || null,
        checked_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return sendJson(res, 201, { ok: true, deploy: data });
  } catch (e) {
    console.error('[api/deploy-status] POST error:', e);
    return sendJson(res, 500, { ok: false, error: e.message });
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
}
