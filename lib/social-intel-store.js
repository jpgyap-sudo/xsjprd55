// ============================================================
// Social Intelligence Store — Supabase persistence layer
// Deduplicates posts, stores neural events, tracks source health.
// ============================================================

import { supabase } from './supabase.js';
import { logger } from './logger.js';

export async function upsertSourceHealth(healthItems = []) {
  if (!healthItems.length) return;
  const rows = healthItems.map(h => ({
    source_id: h.source_id,
    status: h.status,
    last_checked_at: new Date().toISOString(),
    last_success_at: h.status === 'ok' ? new Date().toISOString() : undefined,
    last_error: h.last_error || null,
    last_items_found: h.last_items_found || 0,
    reliability_score: h.status === 'ok' ? 0.80 : h.status === 'degraded' ? 0.45 : 0.20,
    metadata: { latency_ms: h.latency_ms || null }
  }));

  const { error } = await supabase
    .from('social_source_health')
    .upsert(rows, { onConflict: 'source_id' });

  if (error) {
    logger.warn(`[social-intel-store] health upsert error: ${error.message}`);
  }
}

export async function insertPostIfNew(post) {
  const { data, error } = await supabase
    .from('social_posts')
    .insert(post)
    .select('*')
    .single();

  if (!error) return { post: data, inserted: true };

  if (String(error.message || '').toLowerCase().includes('duplicate') || error.code === '23505') {
    const { data: existing, error: findError } = await supabase
      .from('social_posts')
      .select('*')
      .eq('hash', post.hash)
      .single();

    if (findError) throw findError;
    return { post: existing, inserted: false };
  }

  throw error;
}

export async function insertNeuralEvent(event) {
  const { data, error } = await supabase
    .from('neural_news_events')
    .insert(event)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function getLatestEvents({ symbol, limit = 25 } = {}) {
  let query = supabase
    .from('neural_news_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (symbol) {
    query = query.or(`symbol.eq.${symbol},symbols.cs.{${symbol}}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getSocialHealth() {
  const { data, error } = await supabase
    .from('social_source_health')
    .select('*')
    .order('last_checked_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getEventsForSignalWindow({ symbol, minutes = 60 } = {}) {
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  let query = supabase
    .from('neural_news_events')
    .select('*')
    .gte('created_at', since)
    .order('event_score', { ascending: false });

  if (symbol) {
    query = query.or(`symbol.eq.${symbol},symbols.cs.{${symbol}}`);
  }

  const { data, error } = await query;
  if (error) {
    logger.warn(`[social-intel-store] getEventsForSignalWindow error: ${error.message}`);
    return [];
  }
  return data || [];
}
