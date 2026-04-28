// ============================================================
// Bug Store — Supabase persistence layer for debug crawler
// Reuses existing supabase.js client with graceful fallback.
// ============================================================

import crypto from 'crypto';
import { supabase } from './supabase.js';

export function makeBugFingerprint(input) {
  const stable = [
    input.title || '',
    input.file_path || '',
    input.affected_area || '',
    input.source_agent || 'debug_crawler_agent'
  ].join('|').toLowerCase();

  return crypto.createHash('sha256').update(stable).digest('hex');
}

export async function createBugReport(input) {
  const fingerprint = input.fingerprint || makeBugFingerprint(input);

  const row = {
    source_agent: input.source_agent || 'debug_crawler_agent',
    title: input.title,
    description: input.description || null,
    severity: input.severity || 'medium',
    priority: input.priority || severityToPriority(input.severity || 'medium'),
    status: input.status || 'new',
    file_path: input.file_path || null,
    affected_area: input.affected_area || null,
    recommendation: input.recommendation || null,
    fingerprint,
    metadata: input.metadata || {}
  };

  const { data, error } = await supabase
    .from('bugs_to_fix')
    .upsert(row, { onConflict: 'fingerprint' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function bulkCreateBugReports(findings = []) {
  const results = [];
  for (const finding of findings) {
    try {
      results.push(await createBugReport(finding));
    } catch (err) {
      console.warn('[bug-store] failed to create bug:', err.message);
    }
  }
  return results;
}

export async function listBugs({ status, severity, limit = 100 } = {}) {
  let query = supabase
    .from('bugs_to_fix')
    .select('*')
    .order('detected_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (severity) query = query.eq('severity', severity);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function updateBugStatus(id, input) {
  const patch = {
    status: input.status,
    fixed_by: input.fixed_by || null,
    fix_commit: input.fix_commit || null,
    fix_notes: input.fix_notes || null
  };

  if (input.status === 'fixed') patch.fixed_at = input.fixed_at || new Date().toISOString();
  if (input.status === 'verified') patch.verified_at = input.verified_at || new Date().toISOString();

  const { data, error } = await supabase
    .from('bugs_to_fix')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function getBugHistory(bugId) {
  const { data, error } = await supabase
    .from('bug_status_history')
    .select('*')
    .eq('bug_id', bugId)
    .order('changed_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createDebugCrawlerRun(input = {}) {
  const { data, error } = await supabase
    .from('debug_crawler_runs')
    .insert({
      status: 'running',
      metadata: input.metadata || {}
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updateDebugCrawlerRun(id, patch) {
  const { data, error } = await supabase
    .from('debug_crawler_runs')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

function severityToPriority(severity) {
  if (severity === 'critical') return 1;
  if (severity === 'high') return 2;
  if (severity === 'medium') return 3;
  return 4;
}
