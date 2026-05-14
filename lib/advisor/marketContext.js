// ============================================================
// Advisor Market Context — Wired to real xsjprd55 data sources
// Fetches: OHLCV/market cache, liquidation context, OI/funding,
//          news/social sentiment, strategy backtest memory,
//          previous advisor reports, simulation learning memory
// ============================================================

import { supabase } from '../supabase.js';
import { getLiquidationContext } from '../brain/liquidation-agent.js';
import { getNewsSentiment } from '../brain/news-sentiment-agent.js';
import { getMarketSnapshot } from '../brain/market-memory.js';
import { summarizeBacktestMemory } from '../brain/backtest-memory.js';

/**
 * Build a comprehensive advisor context for a symbol+timeframe.
 * Wires to all existing data sources with graceful fallbacks.
 */
export async function buildAdvisorContext({ symbol, timeframe = '1h', horizon = 'today' }) {
  const now = new Date().toISOString();
  const sym = symbol.toUpperCase();
  const warnings = [];

  // ── 1. Market data (OHLCV / price cache) ──────────────────
  let market = { price: null, trend: 'unknown', volume_state: 'unknown', volatility: 'unknown', raw: null };
  try {
    const snap = await getMarketSnapshot({ symbol: sym, timeframe });
    if (snap.ok && snap.data) {
      const d = snap.data;
      market.price = d.close;
      market.open = d.open;
      market.high = d.high;
      market.low = d.low;
      market.volume = d.volume;
      market.timestamp = d.fetched_at || d.timestamp;

      // Trend detection (simple SMA comparison)
      const change = d.close && d.open ? ((d.close - d.open) / d.open) * 100 : 0;
      market.trend = change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'sideways';
      market.volatility = Math.abs(change) > 3 ? 'high' : Math.abs(change) > 1 ? 'medium' : 'low';
      market.volume_state = d.volume > 0 ? 'normal' : 'unknown';
      market.raw = d;
    } else {
      warnings.push(`No market data for ${sym} ${timeframe}`);
      market.fresh = false;
    }
  } catch (err) {
    warnings.push(`Market data error: ${err.message}`);
    market.fresh = false;
  }

  // ── 2. Liquidation context ────────────────────────────────
  let derivatives = { funding: null, open_interest: null, liquidation_bias: 'unknown', raw: null };
  try {
    const liq = await getLiquidationContext({ symbol: sym, timeframe });
    if (liq.ok) {
      derivatives.liquidation_bias =
        liq.bias > 0.2 ? 'upside_sweep' :
        liq.bias < -0.2 ? 'downside_sweep' : 'neutral';
      derivatives.open_interest = liq.total_volume;
      derivatives.long_volume = liq.long_volume;
      derivatives.short_volume = liq.short_volume;
      derivatives.event_count = liq.event_count;
      derivatives.raw = liq;
    }
  } catch (err) {
    warnings.push(`Liquidation data error: ${err.message}`);
  }

  // ── 3. Funding rate (from market_data or liquidation) ─────
  try {
    const { data: fundingRow } = await supabase
      .from('market_data')
      .select('funding_rate')
      .eq('symbol', sym)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fundingRow?.funding_rate != null) {
      derivatives.funding = Number(fundingRow.funding_rate);
    }
  } catch (err) {
    // non-critical
  }

  // ── 4. News / social sentiment ────────────────────────────
  let sentiment = { news: 'unknown', social: 'unknown', raw: null };
  try {
    const ns = await getNewsSentiment({ symbol: sym });
    if (ns.ok) {
      sentiment.news = ns.sentiment > 0.2 ? 'bullish' : ns.sentiment < -0.2 ? 'bearish' : 'neutral';
      sentiment.social = ns.sentiment > 0.2 ? 'bullish' : ns.sentiment < -0.2 ? 'bearish' : 'neutral';
      sentiment.score = ns.sentiment;
      sentiment.article_count = ns.article_count;
      sentiment.sources = ns.sources;
      sentiment.raw = ns;
    }
  } catch (err) {
    warnings.push(`News sentiment error: ${err.message}`);
  }

  // ── 5. Strategy backtest memory ───────────────────────────
  let strategy_memory = [];
  try {
    const { data: backtests } = await supabase
      .from('strategy_backtests')
      .select('*')
      .eq('symbol', sym)
      .order('created_at', { ascending: false })
      .limit(10);
    if (backtests?.length) {
      strategy_memory = backtests.map(b => ({
        id: b.id,
        strategy_id: b.strategy_id,
        trades_count: b.trades_count,
        win_rate: b.win_rate,
        profit_factor: b.profit_factor,
        max_drawdown: b.max_drawdown,
        avg_r_multiple: b.avg_r_multiple,
        created_at: b.created_at
      }));
    }
  } catch (err) {
    warnings.push(`Backtest memory error: ${err.message}`);
  }

  // ── 6. Previous advisor reports for this symbol ───────────
  let previous_reports = [];
  try {
    const { data: reports } = await supabase
      .from('advisor_reports')
      .select('bias, confidence, risk_score, created_at')
      .eq('symbol', sym)
      .order('created_at', { ascending: false })
      .limit(5);
    if (reports?.length) {
      previous_reports = reports;
    }
  } catch (err) {
    // non-critical
  }

  // ── 7. Simulation learning memory ─────────────────────────
  let learning_memory = [];
  try {
    const { data: memories } = await supabase
      .from('advisor_learning_memory')
      .select('memory_type, content, confidence, created_at')
      .eq('symbol', sym)
      .order('created_at', { ascending: false })
      .limit(10);
    if (memories?.length) {
      learning_memory = memories;
    }
  } catch (err) {
    // non-critical — table may not exist yet
  }

  // ── 8. Simulated trades summary ───────────────────────────
  let simulated_trades_summary = { total: 0, wins: 0, losses: 0, win_rate: 0 };
  try {
    const { data: simTrades } = await supabase
      .from('simulated_trades')
      .select('status, pnl_pct')
      .eq('symbol', sym)
      .neq('status', 'open');
    if (simTrades?.length) {
      const closed = simTrades.filter(t => t.status === 'closed');
      simulated_trades_summary = {
        total: closed.length,
        wins: closed.filter(t => (t.pnl_pct || 0) > 0).length,
        losses: closed.filter(t => (t.pnl_pct || 0) <= 0).length,
        win_rate: closed.length ? closed.filter(t => (t.pnl_pct || 0) > 0).length / closed.length : 0
      };
    }
  } catch (err) {
    // non-critical
  }

  // ── Assemble context ──────────────────────────────────────
  return {
    symbol: sym,
    timeframe,
    horizon,
    fetched_at: now,
    market,
    derivatives,
    sentiment,
    strategy_memory,
    previous_reports,
    learning_memory,
    simulated_trades_summary,
    data_health: {
      fresh: market.price !== null,
      warnings
    }
  };
}
