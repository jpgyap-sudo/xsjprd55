// ============================================================
// Diagnostics — /api/diagnostics
// Returns operational health: news quality, signal accuracy,
// data freshness, and system performance metrics.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { config } from '../lib/config.js';

async function getNewsDiagnostics() {
  try {
    const { data: latest } = await supabase
      .from('news_events')
      .select('ingested_at, source')
      .order('ingested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { count: totalArticles } = await supabase
      .from('news_events')
      .select('*', { count: 'exact', head: true });

    const { data: sources } = await supabase
      .from('news_events')
      .select('source')
      .gte('ingested_at', new Date(Date.now() - 86400000).toISOString());

    const uniqueSources = sources ? [...new Set(sources.map(s => s.source))] : [];
    const lastIngestMs = latest?.ingested_at ? Date.now() - new Date(latest.ingested_at).getTime() : null;
    const fresh = lastIngestMs != null && lastIngestMs < 3600000;

    return {
      ok: true,
      lastIngestAt: latest?.ingested_at || null,
      lastIngestAgo: lastIngestMs != null ? Math.round(lastIngestMs / 60000) + 'm ago' : 'Never',
      totalArticles: totalArticles || 0,
      activeSources24h: uniqueSources.length,
      sourceNames: uniqueSources.slice(0, 8),
      freshness: fresh ? 'fresh' : lastIngestMs != null ? 'stale' : 'no-data',
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getSignalDiagnostics() {
  try {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();

    const { data: recent } = await supabase
      .from('signals')
      .select('generated_at, side, symbol, confidence, strategy, outcome')
      .gte('generated_at', since)
      .order('generated_at', { ascending: false })
      .limit(200);

    const signals = recent || [];
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
      .map(([name, stats]) => ({
        name,
        winRate: stats.total > 0 ? (stats.wins / stats.total) : 0,
        total: stats.total,
      }))
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
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getBacktestDiagnostics() {
  try {
    const { data: rows } = await supabase
      .from('backtest_results')
      .select('strategy_name, total_return_pct, sharpe_ratio, max_drawdown_pct, win_rate, trades_count')
      .order('created_at', { ascending: false })
      .limit(50);

    const results = rows || [];
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
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getDataFreshness() {
  const sources = [
    { table: 'market_data', label: 'Market Data', timeCol: 'updated_at' },
    { table: 'signals', label: 'Signals', timeCol: 'generated_at' },
    { table: 'news_events', label: 'News Feed', timeCol: 'ingested_at' },
    { table: 'backtest_results', label: 'Backtests', timeCol: 'created_at' },
    { table: 'mock_trades', label: 'Mock Trades', timeCol: 'created_at' },
  ];

  const checks = [];
  for (const src of sources) {
    try {
      const { data } = await supabase
        .from(src.table)
        .select(src.timeCol)
        .order(src.timeCol, { ascending: false })
        .limit(1)
        .maybeSingle();

      const last = data?.[src.timeCol];
      const ageMs = last ? Date.now() - new Date(last).getTime() : null;
      const ageMin = ageMs != null ? Math.round(ageMs / 60000) : null;
      let status = 'fresh';
      if (ageMin == null) status = 'no-data';
      else if (ageMin > 120) status = 'stale';
      else if (ageMin > 30) status = 'warn';

      checks.push({
        source: src.label,
        table: src.table,
        lastUpdate: last,
        ageMin,
        status,
      });
    } catch (e) {
      checks.push({ source: src.label, table: src.table, lastUpdate: null, ageMin: null, status: 'error', error: e.message });
    }
  }
  return checks;
}

async function getSystemPerformance() {
  const mem = process.memoryUsage();
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    uptimeFormatted: formatUptime(process.uptime()),
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

function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const [news, signals, backtests, freshness, system] = await Promise.all([
      getNewsDiagnostics(),
      getSignalDiagnostics(),
      getBacktestDiagnostics(),
      getDataFreshness(),
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
  } catch (e) {
    console.error('[DIAGNOSTICS] error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
