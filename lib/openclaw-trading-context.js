// ============================================================
// lib/openclaw-trading-context.js — OpenClaw Trading Knowledge Base
// Provides rich trading context for OpenClaw to answer trading
// questions intelligently via Telegram.
//
// This module builds a comprehensive context snapshot from:
// - Active signals & trades (Supabase)
// - Market data (OHLCV, funding rates, liquidation intel)
// - News & sentiment
// - Strategy performance & backtest results
// - Brain signal memory & learning reports
// - Risk assessment data
// ============================================================

import { supabase } from './supabase.js';
import { buildMarketContext } from './ai.js';
import { buildNewsContextForAI } from './news-store.js';
import { getPatternStats } from './pattern-learner.js';
import { getSources } from './data-source-manager.js';

/**
 * Build a comprehensive trading context snapshot for OpenClaw.
 * This is the "brain" that makes OpenClaw smart about trading.
 *
 * @param {Object} [opts]
 * @param {string} [opts.symbol] - Optional symbol to focus context on
 * @param {string} [opts.question] - The user's question for relevance filtering
 * @param {number} [opts.timeout] - Timeout in ms (default: 15000)
 * @returns {Promise<Object>} tradingContext
 */
export async function buildTradingContext(opts = {}) {
  const { symbol, question } = opts;
  const timeout = opts.timeout || 15000;

  // Create a timeout promise that rejects after the specified time
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`buildTradingContext timed out after ${timeout}ms`)), timeout)
  );

  // Race the actual work against the timeout
  const result = await Promise.race([
    (async () => {
      const [
        marketContext,
        newsContext,
        activeSignals,
        openTrades,
        patternStats,
        dataSources,
        brainMemory,
        brainLearning,
        liquidationData,
      ] = await Promise.all([
        buildMarketContext(),
        buildNewsContextForAI(question || '', { hours: 6, limit: 20 }),
        fetchActiveSignals(symbol),
        fetchOpenTrades(symbol),
        getPatternStats({ limit: 100 }),
        getSources(),
        fetchBrainSignalMemory(symbol),
        fetchBrainLearningReports(),
        fetchLiquidationData(),
      ]);

      return {
        timestamp: new Date().toISOString(),
        market: marketContext,
        news: newsContext,
        signals: activeSignals,
        trades: openTrades,
        patterns: patternStats,
        sources: dataSources,
        brain: {
          signalMemory: brainMemory,
          learningReports: brainLearning,
        },
        liquidation: liquidationData,
        summary: buildSummary({
          marketContext,
          activeSignals,
          openTrades,
          patternStats,
          brainMemory,
          liquidationData,
        }),
      };
    })(),
    timeoutPromise,
  ]);

  return result;
}

/**
 * Format the trading context into a readable text prompt for OpenClaw.
 */
export function formatTradingContext(ctx) {
  const lines = [];
  const s = ctx.summary;

  lines.push('=== TRADING CONTEXT SNAPSHOT ===');
  lines.push(`Time: ${ctx.timestamp}`);
  lines.push('');

  // ── Market Overview ──
  lines.push('--- MARKET OVERVIEW ---');
  if (ctx.market?.global) {
    const g = ctx.market.global;
    lines.push(`Total Market Cap: $${formatNumber(g.totalMarketCap)}`);
    lines.push(`24h Volume: $${formatNumber(g.totalVolume)}`);
    lines.push(`BTC Dominance: ${g.btcDominance?.toFixed(1)}%`);
    lines.push(`Market Change (24h): ${g.fearGreed?.toFixed(2) || 'N/A'}%`);
  }
  if (ctx.market?.topCoins?.length) {
    lines.push('');
    lines.push('Top Coins (24h):');
    for (const coin of ctx.market.topCoins.slice(0, 10)) {
      const change = coin.priceChange24h != null ? `${coin.priceChange24h >= 0 ? '+' : ''}${coin.priceChange24h.toFixed(2)}%` : 'N/A';
      lines.push(`  ${coin.symbol}: $${coin.price || 'N/A'} (${change})`);
    }
  }
  lines.push('');

  // ── Funding Rates ──
  lines.push('--- FUNDING RATES ---');
  if (ctx.market?.fundingRates) {
    const fr = ctx.market.fundingRates;
    const crowdedLongs = Object.entries(fr)
      .filter(([, v]) => v > 0.01)
      .map(([k]) => k);
    const crowdedShorts = Object.entries(fr)
      .filter(([, v]) => v < -0.01)
      .map(([k]) => k);
    if (crowdedLongs.length) lines.push(`Crowded Longs (high funding): ${crowdedLongs.join(', ')}`);
    if (crowdedShorts.length) lines.push(`Crowded Shorts (negative funding): ${crowdedShorts.join(', ')}`);
    for (const [sym, rate] of Object.entries(fr).slice(0, 8)) {
      lines.push(`  ${sym}: ${(rate * 100).toFixed(4)}%`);
    }
  } else {
    lines.push('  No funding rate data available');
  }
  lines.push('');

  // ── Liquidation Intelligence ──
  lines.push('--- LIQUIDATION INTELLIGENCE ---');
  if (ctx.liquidation) {
    const liq = ctx.liquidation;
    if (liq.bestShortCandidates?.length) {
      lines.push('Best Short Candidates (high long liquidation risk):');
      for (const c of liq.bestShortCandidates.slice(0, 5)) {
        lines.push(`  ${c.symbol}: Long liq ${c.longLiquidationPrice || 'N/A'}, OI ${c.openInterest || 'N/A'}`);
      }
    }
    if (liq.bestLongCandidates?.length) {
      lines.push('Best Long Candidates (high short liquidation risk):');
      for (const c of liq.bestLongCandidates.slice(0, 5)) {
        lines.push(`  ${c.symbol}: Short liq ${c.shortLiquidationPrice || 'N/A'}, OI ${c.openInterest || 'N/A'}`);
      }
    }
    if (liq.totalLiquidations != null) {
      lines.push(`Total 24h Liquidations: $${formatNumber(liq.totalLiquidations)}`);
    }
  } else {
    lines.push('  No liquidation data available');
  }
  lines.push('');

  // ── Active Signals ──
  lines.push('--- ACTIVE SIGNALS ---');
  if (ctx.signals?.length) {
    for (const sig of ctx.signals.slice(0, 10)) {
      const tp = sig.take_profit ? (Array.isArray(sig.take_profit) ? sig.take_profit.join(', ') : sig.take_profit) : 'N/A';
      lines.push(`  ${sig.symbol} ${sig.side} @ ${sig.entry_price || 'N/A'} | SL: ${sig.stop_loss || 'N/A'} | TP: ${tp} | Conf: ${sig.confidence ? (sig.confidence * 100).toFixed(0) + '%' : 'N/A'} | Strat: ${sig.strategy || 'N/A'}`);
    }
  } else {
    lines.push('  No active signals');
  }
  lines.push('');

  // ── Open Trades ──
  lines.push('--- OPEN TRADES ---');
  if (ctx.trades?.length) {
    for (const t of ctx.trades.slice(0, 10)) {
      const pnl = t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}` : 'N/A';
      lines.push(`  ${t.symbol} ${t.side} | Entry: ${t.entry_price || 'N/A'} | Size: ${t.size || 'N/A'} | PnL: ${pnl} | Mode: ${t.mode || 'paper'}`);
    }
  } else {
    lines.push('  No open trades');
  }
  lines.push('');

  // ── Strategy Performance ──
  lines.push('--- STRATEGY PERFORMANCE ---');
  if (ctx.patterns?.length) {
    for (const p of ctx.patterns.slice(0, 10)) {
      const wr = p.winRate != null ? `${(p.winRate * 100).toFixed(1)}%` : 'N/A';
      lines.push(`  ${p.strategy || p.name}: Win Rate ${wr} | Trades: ${p.totalTrades || p.count || 0} | PnL: ${p.totalPnl != null ? p.totalPnl.toFixed(2) : 'N/A'}`);
    }
  } else {
    lines.push('  No strategy performance data');
  }
  lines.push('');

  // ── Brain Signal Memory ──
  lines.push('--- BRAIN SIGNAL MEMORY ---');
  if (ctx.brain?.signalMemory?.length) {
    for (const m of ctx.brain.signalMemory.slice(0, 5)) {
      lines.push(`  ${m.symbol} ${m.side || m.direction} | Score: ${m.composite_score != null ? m.composite_score.toFixed(2) : 'N/A'} | Verdict: ${m.risk_verdict || m.verdict || 'N/A'} | ${m.generated_at || ''}`);
    }
  } else {
    lines.push('  No brain signal memory');
  }
  lines.push('');

  // ── Brain Learning Insights ──
  lines.push('--- BRAIN LEARNING INSIGHTS ---');
  if (ctx.brain?.learningReports?.length) {
    for (const r of ctx.brain.learningReports.slice(0, 3)) {
      lines.push(`  Report: ${r.summary || r.insights || 'N/A'} (${r.generated_at || ''})`);
    }
  } else {
    lines.push('  No learning reports');
  }
  lines.push('');

  // ── Recent News ──
  lines.push('--- RECENT NEWS ---');
  if (ctx.news?.items?.length) {
    for (const n of ctx.news.items.slice(0, 10)) {
      const sentiment = n.sentiment != null ? (n.sentiment > 0 ? '🟢' : n.sentiment < 0 ? '🔴' : '⚪') : '⚪';
      lines.push(`  ${sentiment} ${n.title || n.headline || 'Untitled'} (${n.source || 'unknown'})`);
    }
  } else {
    lines.push('  No recent news');
  }
  lines.push('');

  // ── Data Sources ──
  lines.push('--- DATA SOURCES ---');
  if (ctx.sources?.length) {
    for (const src of ctx.sources) {
      const status = src.status === 'ok' ? '✅' : src.status === 'degraded' ? '⚠️' : '❌';
      lines.push(`  ${status} ${src.name}: ${src.status || 'unknown'}${src.latency ? ` (${src.latency}ms)` : ''}`);
    }
  } else {
    lines.push('  No data source info');
  }
  lines.push('');

  // ── Quick Summary ──
  lines.push('--- QUICK SUMMARY ---');
  if (s) {
    lines.push(`Active Signals: ${s.activeSignals ?? ctx.signals?.length ?? 0}`);
    lines.push(`Open Trades: ${s.openTrades ?? ctx.trades?.length ?? 0}`);
    lines.push(`Best Performing Strategy: ${s.bestStrategy || 'N/A'}`);
    lines.push(`Market Trend: ${s.marketTrend || 'N/A'}`);
    lines.push(`Top Liquidation Risk: ${s.topLiquidationRisk || 'N/A'}`);
  }

  return lines.join('\n');
}

/**
 * Build a quick summary from the collected context.
 */
function buildSummary({ marketContext, activeSignals, openTrades, patternStats, brainMemory, liquidationData }) {
  // Best strategy by win rate
  let bestStrategy = 'N/A';
  if (patternStats?.length) {
    const sorted = [...patternStats].sort((a, b) => (b.winRate || 0) - (a.winRate || 0));
    if (sorted[0]) bestStrategy = `${sorted[0].strategy || sorted[0].name} (${((sorted[0].winRate || 0) * 100).toFixed(1)}%)`;
  }

  // Market trend
  let marketTrend = 'N/A';
  if (marketContext?.global?.fearGreed != null) {
    const fg = marketContext.global.fearGreed;
    marketTrend = fg > 50 ? 'Bullish' : fg > 25 ? 'Neutral' : 'Bearish';
  }

  // Top liquidation risk
  let topLiquidationRisk = 'N/A';
  if (liquidationData?.bestShortCandidates?.length) {
    topLiquidationRisk = `${liquidationData.bestShortCandidates[0].symbol} (long liq risk)`;
  } else if (liquidationData?.bestLongCandidates?.length) {
    topLiquidationRisk = `${liquidationData.bestLongCandidates[0].symbol} (short liq risk)`;
  }

  return {
    activeSignals: activeSignals?.length || 0,
    openTrades: openTrades?.length || 0,
    bestStrategy,
    marketTrend,
    topLiquidationRisk,
  };
}

async function fetchActiveSignals(symbol) {
  try {
    let query = supabase
      .from('signals')
      .select('*')
      .eq('status', 'active')
      .order('generated_at', { ascending: false })
      .limit(20);
    if (symbol) query = query.eq('symbol', symbol.toUpperCase());
    const { data } = await query;
    return data || [];
  } catch (e) {
    return [];
  }
}

async function fetchOpenTrades(symbol) {
  try {
    let query = supabase
      .from('trades')
      .select('*')
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(20);
    if (symbol) query = query.eq('symbol', symbol.toUpperCase());
    const { data } = await query;
    return data || [];
  } catch (e) {
    return [];
  }
}

async function fetchBrainSignalMemory(symbol) {
  try {
    let query = supabase
      .from('brain_signal_memory')
      .select('*')
      .order('generated_at', { ascending: false })
      .limit(10);
    if (symbol) query = query.eq('symbol', symbol.toUpperCase());
    const { data } = await query;
    return data || [];
  } catch (e) {
    return [];
  }
}

async function fetchBrainLearningReports() {
  try {
    const { data } = await supabase
      .from('brain_learning_reports')
      .select('*')
      .order('generated_at', { ascending: false })
      .limit(5);
    return data || [];
  } catch (e) {
    return [];
  }
}

async function fetchLiquidationData() {
  try {
    const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const res = await fetch(`${base}/api/liquidation`, { method: 'GET', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function formatNumber(n) {
  if (n == null) return 'N/A';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}
