// ============================================================
// Market Memory — Fetches market snapshots and saves decisions
// to brain_signal_memory table in Supabase.
// ============================================================

import { createClient } from '@supabase/supabase-js';

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/**
 * Fetch the latest market snapshot for a symbol+timeframe from market_cache.
 */
export async function getMarketSnapshot({ symbol, timeframe }) {
  const client = supabase();
  if (!client) return { ok: false, error: 'Supabase not configured' };

  const { data, error } = await client
    .from('market_cache')
    .select('*')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: `No market data for ${symbol} ${timeframe}` };

  return { ok: true, data };
}

/**
 * Save a brain decision to brain_signal_memory.
 */
export async function saveSignalMemory(decision) {
  const client = supabase();
  if (!client) return { ok: false, error: 'Supabase not configured' };

  const payload = {
    symbol: decision.symbol,
    timeframe: decision.timeframe,
    side: decision.side,
    entry_price: decision.entry_price,
    confidence: decision.confidence,
    strategy: decision.strategy,
    score: decision.score,
    risk_verdict: decision.risk_verdict,
    explanation: decision.explanation,
    mode: decision.mode || 'paper',
    generated_at: new Date().toISOString()
  };

  const { error } = await client.from('brain_signal_memory').insert(payload);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
