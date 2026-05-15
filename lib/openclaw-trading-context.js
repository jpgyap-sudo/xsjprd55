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
 * @returns {Promise<Object>} tradingContext
 */
export async function buildTradingContext(opts = {}) {
  const { symbol, question } = opts;

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
    lines.push('Top Coins (24h):');
    for (const c of ctx.market.topCoins.slice(0, 10)) {
      const emoji = c.change24h >= 0 ? '🟢' : '🔴';
      lines.push(`  ${emoji} ${c.symbol}: $${c.price} (${c.change24h?.toFixed(2) || 0}%) Vol: $${formatNumber(c.volume24h)}`);
    }
  }
  lines.push('');

  // ── Funding Rates ──
  if (ctx.market?.okxFunding && Object.keys(ctx.market.okxFunding).length > 0) {
    lines.push('--- FUNDING RATES ---');
    for (const [sym, f] of Object.entries(ctx.market.okxFunding)) {
      const annualized = (f.fundingRate * 3 * 365 * 100).toFixed(2);
      const direction = f.fundingRate > 0 ? '🟢 Longs paying' : '🔴 Shorts paying';
      lines.push(`  ${sym}: ${direction} ${annualized}% annualized`);
    }
    lines.push('');
  }

  // ── Liquidation Intel ──
  if (ctx.liquidation) {
    lines.push('--- LIQUIDATION INTELLIGENCE ---');
    const liq = ctx.liquidation;
    if (liq.summary) {
      lines.push(`  Total OI: $${formatNumber(liq.summary.totalOpenInterestUsd)}`);
      lines.push(`  Avg Funding: ${(liq.summary.averageFundingAnnualized * 100).toFixed(2)}%`);
      lines.push(`  Long/Short Ratio: ${liq.summary.longShortRatio?.toFixed(2) || 'N/A'}`);
    }
    if (liq.bestShort) {
      lines.push(`  Best Short Candidate: ${liq.bestShort.symbol} — Risk Score: ${liq.bestShort.riskScore}/100`);
      lines.push(`    Funding: ${(liq.bestShort.fundingAnnualized * 100).toFixed(2)}% | OI: $${formatNumber(liq.bestShort.openInterest)}`);
    }
    if (liq.bestLong) {
      lines.push(`  Best Long Candidate: ${liq.bestLong.symbol} — Risk Score: ${liq.bestLong.riskScore}/100`);
      lines.push(`    Funding: ${(liq.bestLong.fundingAnnualized * 100).toFixed(2)}% | OI: $${formatNumber(liq.bestLong.openInterest)}`);
    }
    if (liq.alerts?.length) {
      lines.push('  Alerts:');
      for (const a of liq.alerts.slice(0, 5)) {
        lines.push(`    ${a.symbol}: ${a.message} (${a.severity})`);
      }
    }
    lines.push('');
  }

  // ── Active Signals ──
  if (ctx.signals?.length) {
    lines.push('--- ACTIVE SIGNALS ---');
    for (const sig of ctx.signals.slice(0, 10)) {
      const emoji = sig.side === 'LONG' ? '🟢' : sig.side === 'SHORT' ? '🔴' : '⚪';
      lines.push(`  ${emoji} ${sig.side} ${sig.symbol} @ $${sig.entry_price} | Conf: ${Math.round((sig.confidence || 0) * 100)}% | Strat: ${sig.strategy} | ${sig.timeframe}`);
      if (sig.stop_loss) lines.push(`    SL: $${sig.stop_loss}`);
      if (sig.take_profit?.length) lines.push(`    TP: ${sig.take_profit.map(t => `$${t}`).join(', ')}`);
    }
    lines.push('');
  }

  // ── Open Trades ──
  if (ctx.trades?.length) {
    lines.push('--- OPEN TRADES ---');
    for (const t of ctx.trades.slice(0, 10)) {
      const emoji = t.side === 'LONG' ? '🟢' : '🔴';
      const pnl = t.current_pnl ? `${t.current_pnl >= 0 ? '+' : ''}${t.current_pnl.toFixed(2)}` : 'N/A';
      lines.push(`  ${emoji} ${t.side} ${t.symbol} @ $${t.entry_price} | PnL: $${pnl} | Mode: ${t.mode || 'paper'}`);
    }
    lines.push('');
  }

  // ── Strategy Performance ──
  if (ctx.patterns) {
    lines.push('--- STRATEGY PERFORMANCE ---');
    lines.push(`  Overall Win Rate: ${(ctx.patterns.winRate * 100).toFixed(1)}%`);
    lines.push(`  Total PnL: $${ctx.patterns.totalPnl?.toFixed(2) || '0.00'}`);
    lines.push(`  Total Signals: ${ctx.patterns.total}`);
    lines.push(`  Avg Confidence: ${(ctx.patterns.avgConfidence * 100).toFixed(1)}%`);
    if (ctx.patterns.byStrategy && Object.keys(ctx.patterns.byStrategy).length > 0) {
      lines.push('  By Strategy:');
      for (const [name, stats] of Object.entries(ctx.patterns.byStrategy)) {
        lines.push(`    ${name}: ${stats.count} signals, ${(stats.winRate * 100).toFixed(0)}% win rate`);
      }
    }
    lines.push('');
  }

  // ── Brain Signal Memory ──
  if (ctx.brain?.signalMemory?.length) {
    lines.push('--- BRAIN SIGNAL MEMORY (Recent) ---');
    for (const m of ctx.brain.signalMemory.slice(0, 5)) {
      const emoji = m.side === 'LONG' ? '🟢' : '🔴';
      lines.push(`  ${emoji} ${m.side} ${m.symbol} | Conf: ${(m.confidence * 100).toFixed(0)}% | Risk: ${m.risk_verdict || 'N/A'}`);
      if (m.explanation) lines.push(`    ${m.explanation.slice(0, 200)}`);
    }
    lines.push('');
  }

  // ── Brain Learning Reports ──
  if (ctx.brain?.learningReports?.length) {
    lines.push('--- BRAIN LEARNING INSIGHTS ---');
    for (const r of ctx.brain.learningReports.slice(0, 3)) {
      lines.push(`  Report: ${r.summary?.slice(0, 200) || 'N/A'}`);
      if (r.suggestions?.length) {
        for (const sug of r.suggestions.slice(0, 3)) {
          lines.push(`    💡 ${sug.title}: ${sug.description?.slice(0, 150)}`);
        }
      }
    }
    lines.push('');
  }

  // ── News Context ──
  if (ctx.news?.hasNews) {
    lines.push('--- RECENT NEWS ---');
    lines.push(`Market Sentiment: ${ctx.news.overallScore > 0.2 ? '📈 Bullish' : ctx.news.overallScore < -0.2 ? '📉 Bearish' : '➡️ Neutral'} (${ctx.news.overallScore?.toFixed(2) || 'N/A'})`);
    if (ctx.news.topHeadlines?.length) {
      lines.push('Top Headlines:');
      for (const h of ctx.news.topHeadlines.slice(0, 5)) {
        lines.push(`  📰 ${h.title} [${h.source}] — Impact: ${h.impact || 'neutral'}`);
      }
    }
    lines.push('');
  }

  // ── Data Sources Health ──
  if (ctx.sources?.length) {
    lines.push('--- DATA SOURCES ---');
    for (const src of ctx.sources) {
      const statusEmoji = src.status === 'active' ? '🟢' : src.status === 'degraded' ? '🟡' : '🔴';
      lines.push(`  ${statusEmoji} ${src.display_name} (${src.type}) — Rel: ${(src.reliability_score * 100).toFixed(0)}%`);
    }
    lines.push('');
  }

  // ── Quick Summary ──
  if (s) {
    lines.push('--- QUICK SUMMARY ---');
    lines.push(`Market: ${s.marketDirection}`);
    lines.push(`Active Signals: ${s.activeSignalCount} | Open Trades: ${s.openTradeCount}`);
    lines.push(`Best Short Candidate: ${s.bestShort || 'N/A'}`);
    lines.push(`Best Long Candidate: ${s.bestLong || 'N/A'}`);
    lines.push(`Strategy Win Rate: ${s.winRate}`);
    lines.push(`News Sentiment: ${s.newsSentiment}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build a quick summary object from all context data.
 */
function buildSummary({ marketContext, activeSignals, openTrades, patternStats, brainMemory, liquidationData }) {
  const btc = marketContext?.topCoins?.find(c => c.symbol === 'BTC');
  const eth = marketContext?.topCoins?.find(c => c.symbol === 'ETH');

  return {
    marketDirection: btc?.change24h >= 0 ? '🟢 Bullish' : '🔴 Bearish',
    btcPrice: btc?.price,
    btcChange24h: btc?.change24h,
    ethPrice: eth?.price,
    ethChange24h: eth?.change24h,
    activeSignalCount: activeSignals?.length || 0,
    openTradeCount: openTrades?.length || 0,
    bestShort: liquidationData?.bestShort?.symbol || null,
    bestLong: liquidationData?.bestLong?.symbol || null,
    winRate: patternStats?.winRate ? `${(patternStats.winRate * 100).toFixed(1)}%` : 'N/A',
    newsSentiment: marketContext?.newsSnapshot?.overallScore
      ? marketContext.newsSnapshot.overallScore > 0.2 ? 'Bullish' : marketContext.newsSnapshot.overallScore < -0.2 ? 'Bearish' : 'Neutral'
      : 'N/A',
  };
}

// ── Data Fetching Helpers ──────────────────────────────────

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
