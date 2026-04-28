// ============================================================
// Data Source Manager — Registry, health checks, discovery
// Tracks all APIs/exchanges/news sources and their reliability
// ============================================================

import { supabase } from './supabase.js';

const DISCOVERY_APIS = [
  { name: 'glassnode', display: 'Glassnode', type: 'onchain', url: 'https://docs.glassnode.com', provides: ['onchain','exchange_flows','whale_activity'] },
  { name: 'santiment', display: 'Santiment', type: 'sentiment', url: 'https://academy.santiment.net/products/sanapi', provides: ['sentiment','social','onchain'] },
  { name: 'lunarcrush', display: 'LunarCrush', type: 'social', url: 'https://lunarcrush.com/developers/docs', provides: ['social','sentiment','trending'] },
  { name: 'dune', display: 'Dune Analytics', type: 'onchain', url: 'https://docs.dune.com/api-reference/overview/introduction', provides: ['onchain','defi','nft'] },
  { name: 'theblock', display: 'The Block API', type: 'news_api', url: 'https://www.theblock.co/api', provides: ['news','research'] },
  { name: 'defillama', display: 'DeFi Llama', type: 'onchain', url: 'https://docs.llama.fi', provides: ['defi_tvl','yields','dex_volume'] },
  { name: 'messari', display: 'Messari API', type: 'macro', url: 'https://messari.io/api/docs', provides: ['research','metrics','news'] },
  { name: 'alternative_me', display: 'Alternative.me Fear & Greed', type: 'sentiment', url: 'https://alternative.me/crypto/fear-and-greed-index/', provides: ['sentiment','fear_greed'] },
];

/**
 * Register a new data source.
 */
export async function registerSource(source) {
  const { data, error } = await supabase
    .from('data_source_registry')
    .upsert({
      name: source.name,
      display_name: source.display_name || source.name,
      type: source.type,
      base_url: source.base_url || null,
      api_endpoint: source.api_endpoint || null,
      auth_type: source.auth_type || 'none',
      config: source.config || {},
      provides: source.provides || [],
      supported_symbols: source.supported_symbols || [],
      rate_limit: source.rate_limit || {},
      status: source.status || 'active',
      docs_url: source.docs_url || null,
      notes: source.notes || null,
      discovered_by: source.discovered_by || 'manual',
    }, { onConflict: 'name' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all sources, optionally filtered by type or status.
 */
export async function getSources(opts = {}) {
  let query = supabase.from('data_source_registry').select('*');
  if (opts.type) query = query.eq('type', opts.type);
  if (opts.status) query = query.eq('status', opts.status);
  if (opts.provides) {
    query = query.contains('provides', Array.isArray(opts.provides) ? opts.provides : [opts.provides]);
  }

  const { data, error } = await query.order('reliability_score', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Record a successful request to a source.
 */
export async function recordSuccess(name, latencyMs) {
  const { data: existing } = await supabase
    .from('data_source_registry')
    .select('requests_count, avg_latency_ms, reliability_score')
    .eq('name', name)
    .single();

  const count = (existing?.requests_count || 0) + 1;
  const oldLatency = existing?.avg_latency_ms || latencyMs;
  const newLatency = Math.round((oldLatency * (count - 1) + latencyMs) / count);
  const reliability = Math.min(1, (existing?.reliability_score || 0.95) * 0.99 + 0.01);

  await supabase
    .from('data_source_registry')
    .update({
      last_success_at: new Date().toISOString(),
      requests_count: count,
      avg_latency_ms: newLatency,
      reliability_score: reliability,
      status: reliability > 0.5 ? 'active' : 'degraded',
    })
    .eq('name', name);
}

/**
 * Record an error from a source.
 */
export async function recordError(name, message) {
  const { data: existing } = await supabase
    .from('data_source_registry')
    .select('reliability_score, signals_contributed')
    .eq('name', name)
    .single();

  const reliability = Math.max(0, (existing?.reliability_score || 1) * 0.9);

  await supabase
    .from('data_source_registry')
    .update({
      last_error_at: new Date().toISOString(),
      last_error_message: message.slice(0, 500),
      reliability_score: reliability,
      status: reliability < 0.3 ? 'down' : reliability < 0.7 ? 'degraded' : 'active',
    })
    .eq('name', name);
}

/**
 * Discover new data sources the bot could integrate.
 * Returns suggestions, does NOT auto-register.
 */
export async function discoverSources() {
  const { data: existing } = await supabase
    .from('data_source_registry')
    .select('name');

  const existingNames = new Set((existing || []).map(e => e.name));
  const discoveries = [];

  for (const api of DISCOVERY_APIS) {
    if (!existingNames.has(api.name)) {
      discoveries.push({
        ...api,
        status: 'experimental',
        discovered_by: 'suggestion-bot',
        reliability_score: null,
      });
    }
  }

  return discoveries;
}

/**
 * Increment the signal contribution counter for a source.
 */
export async function recordSignalContribution(name) {
  await supabase.rpc('increment_source_signals', { source_name: name });
}
