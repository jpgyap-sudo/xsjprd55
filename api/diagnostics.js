// ============================================================
// Diagnostics — /api/diagnostics
// Returns operational health: news quality, signal accuracy,
// data freshness, and system performance metrics.
// Each section is resilient — partial data is returned even if
// some queries fail (e.g. missing Supabase tables).
// ============================================================

import { config } from '../lib/config.js';

// Safe Supabase query wrapper — returns fallback on any error
async function safeQuery(supabase, queryFn, fallback = null) {
  try {
    return await queryFn(supabase);
  } catch (e) {
    console.error('[DIAGNOSTICS] Query error:', e.message);
    return fallback;
  }
}

async function getNewsDiagnostics(supabase) {
  if (!supabase) return { ok: false, error: 'Supabase not connected' };
  const latest = await safeQuery(supabase, async (db) => {
    const { data } = await db.from('news_events').select('ingested_at, source').order('ingested_at', { ascending: false }).limit(1).maybeSingle();
    return data;
  });

  const totalArticles = await safeQuery(supabase, async (db) => {
    const { count } = await db.from('news_events').select('*', { count: 'exact', head: true });
    return count || 0;
  }, 0);

  const sources = await safeQuery(supabase, async (db) => {
    const { data } = await db.from('news_events').select('source').gte('ingested_at', new Date(Date.now() - 86400000).toISOString());
    return data || [];
  }, []);

  const uniqueSources = [...new Set(sources.map(s => s.source))];
  const lastIngestMs = latest?.ingested_at ? Date.now() - new Date(latest.ingested_at).getTime() : null;
  const fresh = lastIngestMs != null && lastIngestMs < 3600000;

  return {
    ok: true,
    lastIngestAt: latest?.ingested_at || null,
    lastIngestAgo: lastIngestMs != null ? Math.round(lastIngestMs / 60000) + 'm ago' : 'Never',
    totalArticles,
    activeSources24h: uniqueSources.length,
    sourceNames: uniqueSources.slice(0, 8),
    freshness: fresh ? 'fresh' : lastIngestMs != null ? 'stale' : 'no-data',
  };
}

async function getSignalDiagnostics(supabase) {
  if (!supabase) return { ok: false, error: 'Supabase not connected' };
  const since = new Date(Date.now() - 7 * 86400000).toISOString();

  const signals = await safeQuery(supabase, async (db) => {
    const { data } = await db.from('signals').select('generated_at, side, symbol, confidence, strategy, outcome').gte('generated_at', since).order('generated_at', { ascending: false }).limit(200);
    return data || [];
  }, []);

  const withOutcome = signals.filter(s => s.outcome === 'win' || s.outcome === 'loss');
  const wins = withOutcome.filter(s => s.outcome === 'win').length;
  const losses = withOutcome.filter(s => s.outcome === 'loss').length;
  const winRate = withOutcome.length > 0 ? wins / withOutcome.length : 0;

  const byStrategy = {};
  for (const s of withOutcome) {
    if (!byStrategy[s.strategy]) byStrategy[s.strategy] = { wins: 0, losses: 0, total: 0 };
    byStrategy[s.strategy].total++;
    if (s.outcome === 'win') byStrategy[s.strategy].wins++;
    else byStrategy[s.strategy].losses++;
  }
  const strategyStats = Object.entries(byStrategy)
    .map(([name, stats]) => ({ name, winRate: stats.total > 0 ? (stats.wins / stats.total) : 0, total: stats.total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const avgConfidence = signals.length > 0
    ? signals.reduce((sum, s) => sum + (s.confidence || 0), 0) / signals.length
    : 0;

  return {
    ok: true,
    signals7d: signals.length,
    withOutcome: withOutcome.length,
    winRate,
    wins,
    losses,
    avgConfidence,
    topStrategies: strategyStats,
    lastSignalAt: signals[0]?.generated_at || null,
  };
}

async function getBacktestDiagnostics(supabase) {
  if (!supabase) return { ok: false, error: 'Supabase not connected' };
  const results = await safeQuery(supabase, async (db) => {
    const { data } = await db.from('backtest_results').select('strategy_name, total_return_pct, sharpe_ratio, max_drawdown_pct, win_rate, trades_count').order('created_at', { ascending: false }).limit(50);
    return data || [];
  }, []);

  const best = results.length > 0
    ? results.reduce((best, r) => (r.total_return_pct > best.total_return_pct ? r : best), results[0])
    : null;

  return {
    ok: true,
    totalBacktests: results.length,
    bestStrategy: best?.strategy_name || null,
    bestReturnPct: best?.total_return_pct || 0,
    bestSharpe: best?.sharpe_ratio || 0,
    avgTrades: results.length > 0
      ? results.reduce((s, r) => s + (r.trades_count || 0), 0) / results.length
      : 0,
  };
}

async function getDataFreshness(supabase) {
  const sources = [
    { table: 'market_data', label: 'Market Data', timeCol: 'updated_at', warnMin: 30, staleMin: 120 },
    { table: 'signals', label: 'Signals', timeCol: 'generated_at', warnMin: 60, staleMin: 180 },
    { table: 'news_events', label: 'News Feed', timeCol: 'ingested_at', warnMin: 120, staleMin: 360 },
    { table: 'backtest_results', label: 'Backtests', timeCol: 'created_at', warnMin: 1440, staleMin: 10080 },
    { table: 'mock_trades', label: 'Mock Trades', timeCol: 'created_at', warnMin: 60, staleMin: 360 },
  ];

  const checks = [];
  for (const src of sources) {
    if (!supabase) {
      checks.push({ source: src.label, table: src.table, lastUpdate: null, ageMin: null, status: 'no-data' });
      continue;
    }
    const row = await safeQuery(supabase, async (db) => {
      const { data } = await db.from(src.table).select(src.timeCol).order(src.timeCol, { ascending: false }).limit(1).maybeSingle();
      return data;
    });

    const last = row?.[src.timeCol];
    const ageMs = last ? Date.now() - new Date(last).getTime() : null;
    const ageMin = ageMs != null ? Math.round(ageMs / 60000) : null;
    let status = 'fresh';
    if (ageMin == null) status = 'no-data';
    else if (ageMin > src.staleMin) status = 'stale';
    else if (ageMin > src.warnMin) status = 'warn';

    checks.push({ source: src.label, table: src.table, lastUpdate: last, ageMin, status });
  }
  return checks;
}

function getSystemPerformance() {
  const mem = process.memoryUsage();
  const sec = process.uptime();
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const uptimeFormatted = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;

  return {
    uptimeSeconds: Math.floor(sec),
    uptimeFormatted,
    nodeVersion: process.version,
    memoryMb: {
      rss: Math.round(mem.rss / 1048576),
      heapUsed: Math.round(mem.heapUsed / 1048576),
      heapTotal: Math.round(mem.heapTotal / 1048576),
    },
    env: config.NODE_ENV,
    tradingMode: config.TRADING_MODE,
    aiProvider: config.AI_PROVIDER,
    deploymentTarget: config.DEPLOYMENT_TARGET,
  };
}

// Lazy-load supabase to avoid crash if module fails
async function getSupabase() {
  try {
    const mod = await import('../lib/supabase.js');
    return mod.supabase || null;
  } catch (e) {
    console.error('[DIAGNOSTICS] Supabase load error:', e.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = await getSupabase();

  // Run all checks in parallel — each is resilient
  const [news, signals, backtests, freshness, system] = await Promise.all([
    getNewsDiagnostics(supabase),
    getSignalDiagnostics(supabase),
    getBacktestDiagnostics(supabase),
    getDataFreshness(supabase),
    getSystemPerformance(),
  ]);

  return res.status(200).json({
    ok: true,
    news,
    signals,
    backtests,
    freshness,
    system,
    generatedAt: new Date().toISOString(),
  });
}
