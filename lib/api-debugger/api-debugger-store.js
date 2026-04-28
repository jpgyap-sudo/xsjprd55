// ============================================================
// API Debugger Store
// Supabase persistence layer for API debugger results
// ============================================================

import { supabase } from '../supabase.js';

export async function createApiDebuggerRun(metadata = {}) {
  const { data, error } = await supabase
    .from('api_debugger_runs')
    .insert({ metadata })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateApiDebuggerRun(id, patch) {
  const { data, error } = await supabase
    .from('api_debugger_runs')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function insertApiDebugResult(result) {
  const { data, error } = await supabase
    .from('api_debugger_results')
    .insert(result)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function insertApiDebugResults(results = []) {
  if (!results.length) return [];
  const { data, error } = await supabase
    .from('api_debugger_results')
    .insert(results)
    .select();
  if (error) throw error;
  return data || [];
}

export async function listApiDebugResults({ provider, status, limit = 100 } = {}) {
  let q = supabase
    .from('api_debugger_results')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (provider) q = q.eq('provider', provider);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function updateApiDebugStatus(id, input) {
  const patch = {
    status: input.status,
    severity: input.severity,
    neural_review: input.neural_review || null,
    docs_reference: input.docs_reference || null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('api_debugger_results')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function upsertDocsCache(row) {
  const payload = {
    provider: row.provider,
    doc_url: row.docUrl,
    content_hash: row.contentHash,
    title: row.title,
    summary: row.summary,
    content_snippet: row.contentSnippet,
    fetched_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('api_debugger_docs_cache')
    .upsert(payload, { onConflict: 'provider,doc_url' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listDocsCache(limit = 50) {
  const { data, error } = await supabase
    .from('api_debugger_docs_cache')
    .select('*')
    .order('fetched_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function submitApiIssueToBugs(result) {
  if (!result || result.status === 'healthy') return null;
  const { data, error } = await supabase
    .from('bugs_to_fix')
    .upsert({
      title: `[${result.provider}] ${result.error_category || 'API Issue'}`,
      description: `${result.error_message || ''}\n\nEndpoint: ${result.endpoint}\nHTTP: ${result.http_code}\nResponse time: ${result.response_time_ms}ms`,
      severity: result.severity || 'medium',
      source: 'api_debugger',
      affected_area: result.endpoint,
      status: 'open',
      metadata: {
        api_debugger_result_id: result.id,
        provider: result.provider,
        error_category: result.error_category
      }
    }, { onConflict: 'fingerprint' })
    .select()
    .single();
  if (error) {
    // Silently fail - bug submission is best-effort
    return null;
  }
  return data;
}
