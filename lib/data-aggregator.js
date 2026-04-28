// ============================================================
// Unified Data Aggregator — combines all internal + external
// sources so the bot can answer with full context.
// ============================================================

import { supabase } from './supabase.js';
import { getCoinData, getTopCoins, analyzeSocialMetrics } from './lunarcrush.js';
import { fetchAllNews, searchNews } from './news.js';

// In-memory cache for serverless warm invocations
let cache = {};
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(symbol) {
  return symbol ? symbol.toUpperCase() : 'GLOBAL';
}

function getCache(key) {
  const entry = cache[key];
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
  return null;
}

function setCache(key, data) {
  cache[key] = { data, ts: Date.now() };
}

// ── Supabase: latest market candle ──────────────────────────
async function getMarketData(symbol) {
  const { data } = await supabase
    .from('market_data')
    .select('*')
    .eq('symbol', symbol)
    .eq('timeframe', '1h')
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();
  return data || null;
}

// ── Supabase: active signals ────────────────────────────────
async function getActiveSignals(symbol) {
  let q = supabase.from('signals').select('*').eq('status', 'active').order('generated_at', { ascending: false });
  if (symbol) q = q.eq('symbol', symbol);
  const { data } = await q.limit(10);
  return data || [];
}

// ── Supabase: open trades ───────────────────────────────────
async function getOpenTrades(symbol) {
  let q = supabase.from('trades').select('*').eq('status', 'open').order('opened_at', { ascending: false });
  if (symbol) q = q.eq('symbol', symbol);
  const { data } = await q.limit(10);
  return data || [];
}

// ── Main context builder ────────────────────────────────────
export async function getBotContext(opts = {}) {
  const { symbol, query, includeNews = true, includeSocial = true, includeMarket = true, includeSignals = true, includeTrades = true } = opts;
  const key = cacheKey(symbol || query);
  const cached = getCache(key);
  if (cached) return cached;

  const promises = [];

  if (includeMarket && symbol) {
    promises.push(getMarketData(symbol).then(d => ({ type: 'market', data: d })));
  }
  if (includeSignals) {
    promises.push(getActiveSignals(symbol).then(d => ({ type: 'signals', data: d })));
  }
  if (includeTrades) {
    promises.push(getOpenTrades(symbol).then(d => ({ type: 'trades', data: d })));
  }
  if (includeSocial && symbol) {
    promises.push(
      getCoinData(symbol)
        .then(coin => ({
          type: 'social',
          data: coin ? { ...coin, analysis: analyzeSocialMetrics(coin) } : null
        }))
        .catch(e => ({ type: 'social', data: null, error: e.message }))
    );
  }
  if (includeNews) {
    promises.push(
      searchNews(query || symbol || '', { limit: 5 })
        .then(d => ({ type: 'news', data: d }))
        .catch(e => ({ type: 'news', data: [], error: e.message }))
    );
  }

  const results = await Promise.allSettled(promises);

  const context = {
    symbol,
    query,
    market: null,
    signals: [],
    trades: [],
    social: null,
    news: [],
    topCoins: null,
    errors: []
  };

  for (const r of results) {
    if (r.status !== 'fulfilled') {
      context.errors.push(r.reason?.message || String(r.reason));
      continue;
    }
    const { type, data, error } = r.value;
    if (error) context.errors.push(error);
    context[type] = data;
  }

  // Top coins (lightweight, always useful)
  try {
    context.topCoins = await getTopCoins(10);
  } catch (_) { /* ignore */ }

  setCache(key, context);
  return context;
}

// ── Summarise context into a concise text for the bot ───────
export function summarizeContext(ctx) {
  const parts = [];

  if (ctx.market) {
    const m = ctx.market;
    const change = (((m.close - m.open) / m.open) * 100).toFixed(2);
    parts.push(`📊 ${m.symbol}: $${m.close} (${change}% 1h) — Vol: ${Math.round(m.volume || 0)}`);
  }

  if (ctx.social) {
    const s = ctx.social;
    parts.push(`🌐 Social: Galaxy ${s.galaxy_score}, AltRank #${s.alt_rank}, Sentiment ${s.sentiment?.toFixed(2) || 'N/A'}`);
    if (s.analysis) {
      parts.push(`   Outlook: ${s.analysis.overall}`);
      if (s.analysis.positives[0]) parts.push(`   ✅ ${s.analysis.positives[0]}`);
      if (s.analysis.issues[0]) parts.push(`   ⚠️ ${s.analysis.issues[0]}`);
    }
  }

  if (ctx.signals.length) {
    parts.push(`📡 Active signals (${ctx.signals.length}):`);
    for (const sig of ctx.signals.slice(0, 3)) {
      parts.push(`   • ${sig.side} ${sig.symbol} @ ${sig.entry_price} (${sig.strategy})`);
    }
  }

  if (ctx.trades.length) {
    parts.push(`💼 Open trades (${ctx.trades.length}):`);
    for (const t of ctx.trades.slice(0, 3)) {
      parts.push(`   • ${t.side} ${t.symbol} @ ${t.entry_price} [${t.mode}]`);
    }
  }

  if (ctx.news.length) {
    parts.push(`📰 Latest news:`);
    for (const n of ctx.news.slice(0, 3)) {
      parts.push(`   • ${n.title}`);
    }
  }

  if (ctx.topCoins?.length) {
    const top = ctx.topCoins.slice(0, 5).map(c => `${c.symbol}($${c.price?.toFixed(2) || '?'})`).join(', ');
    parts.push(`🏆 Top coins: ${top}`);
  }

  if (ctx.errors.length) {
    parts.push(`⚠️ Data errors: ${ctx.errors.join('; ')}`);
  }

  return parts.length ? parts.join('\n') : 'No data available.';
}
