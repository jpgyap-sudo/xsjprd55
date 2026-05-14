// ============================================================
// Liquidation Agent — Fetches liquidation context from existing
// liquidation intel data sources.
// Wired to: workers/liquidation-intel-worker.js, api/liquidation.js
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
 * Fetch liquidation context for a symbol+timeframe.
 * Queries the liquidation_events or liquidation_cache table.
 */
export async function getLiquidationContext({ symbol, timeframe }) {
  const client = supabase();
  if (!client) {
    return { ok: false, error: 'Supabase not configured', bias: 0, total_volume: 0, event_count: 0 };
  }

  try {
    // Try liquidation_cache first
    const { data: cache, error: cacheErr } = await client
      .from('liquidation_cache')
      .select('*')
      .eq('symbol', symbol)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!cacheErr && cache) {
      const totalLong = cache.total_long_volume || 0;
      const totalShort = cache.total_short_volume || 0;
      const total = totalLong + totalShort;
      const bias = total > 0 ? (totalLong - totalShort) / total : 0;

      return {
        ok: true,
        symbol,
        timeframe,
        bias: Math.round(bias * 100) / 100,
        total_volume: total,
        long_volume: totalLong,
        short_volume: totalShort,
        event_count: cache.event_count || 0,
        source: 'liquidation_cache'
      };
    }

    // Fallback: try liquidation_events table
    const { data: events, error: evErr } = await client
      .from('liquidation_events')
      .select('side, volume_usd')
      .eq('symbol', symbol)
      .gte('created_at', new Date(Date.now() - 3600000).toISOString()) // last hour
      .limit(100);

    if (!evErr && events?.length) {
      const longVol = events.filter(e => e.side === 'LONG').reduce((s, e) => s + (e.volume_usd || 0), 0);
      const shortVol = events.filter(e => e.side === 'SHORT').reduce((s, e) => s + (e.volume_usd || 0), 0);
      const total = longVol + shortVol;
      const bias = total > 0 ? (longVol - shortVol) / total : 0;

      return {
        ok: true,
        symbol,
        timeframe,
        bias: Math.round(bias * 100) / 100,
        total_volume: total,
        long_volume: longVol,
        short_volume: shortVol,
        event_count: events.length,
        source: 'liquidation_events'
      };
    }

    // No data available
    return {
      ok: true,
      symbol,
      timeframe,
      bias: 0,
      total_volume: 0,
      event_count: 0,
      source: 'none'
    };
  } catch (err) {
    console.error('[liquidation-agent] error:', err.message);
    return { ok: false, error: err.message, bias: 0, total_volume: 0, event_count: 0 };
  }
}
