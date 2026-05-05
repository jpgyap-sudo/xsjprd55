// ============================================================
// Perpetual Trader — Trade History Logger
// Logs every trade event to perp_trade_history for the dashboard
// and research agent. Also computes analysis fields on close.
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';

/**
 * Log a new trade to the history table (called when trade opens)
 */
export async function logTradeOpen(trade) {
  try {
    const { error } = await supabase.from('perp_trade_history').insert({
      trade_id: trade.id,
      account_id: trade.account_id,
      symbol: trade.symbol,
      side: trade.side,
      strategy: trade.strategy,
      timeframe: trade.timeframe,
      entry_price: trade.entry_price,
      entry_at: trade.created_at || new Date().toISOString(),
      entry_reason: trade.entry_reason,
      position_size_usd: trade.position_size_usd,
      margin_used: trade.margin_used,
      leverage: trade.leverage,
      stop_loss: trade.stop_loss,
      take_profit: trade.take_profit,
      risk_reward: trade.risk_reward,
      confidence: trade.confidence,
      signal_id: trade.signal_id,
      entry_features: trade.entry_features || {},
      created_at: new Date().toISOString(),
    });

    if (error) {
      logger.warn(`[PerpTradeHistory] Log open failed: ${error.message}`);
    }
  } catch (e) {
    logger.warn(`[PerpTradeHistory] Log open error: ${e.message}`);
  }
}

/**
 * Update trade history on close with P&L and analysis
 */
export async function logTradeClose(trade, exitPrice, reason, detail) {
  try {
    const entryAt = new Date(trade.created_at || trade.entry_at).getTime();
    const exitAt = Date.now();
    const holdDurationMinutes = Math.round((exitAt - entryAt) / 60000);

    // Compute exit quality based on P&L
    const pnlUsd = trade.pnl_usd || 0;
    const pnlPct = trade.pnl_pct || 0;
    let exitQuality = 'fair';
    if (pnlPct > 10) exitQuality = 'excellent';
    else if (pnlPct > 5) exitQuality = 'good';
    else if (pnlPct < -5) exitQuality = 'poor';

    // Generate analysis text
    const analysis = analyzeTrade(trade, exitPrice, reason, pnlUsd, pnlPct);

    // Check if history record exists
    const { data: existing } = await supabase
      .from('perp_trade_history')
      .select('id')
      .eq('trade_id', trade.id)
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Update existing record
      const { error } = await supabase
        .from('perp_trade_history')
        .update({
          exit_price: exitPrice,
          exit_at: new Date().toISOString(),
          exit_reason: reason,
          exit_reason_detail: detail,
          pnl_usd: pnlUsd,
          pnl_pct: pnlPct,
          hold_duration_minutes: holdDurationMinutes,
          exit_quality: exitQuality,
          what_went_right: analysis.whatWentRight,
          what_went_wrong: analysis.whatWentWrong,
          strategy_notes: analysis.strategyNotes,
          market_condition: analysis.marketCondition,
        })
        .eq('id', existing.id);

      if (error) {
        logger.warn(`[PerpTradeHistory] Log close update failed: ${error.message}`);
      }
    } else {
      // Insert new record with full data
      const { error } = await supabase.from('perp_trade_history').insert({
        trade_id: trade.id,
        account_id: trade.account_id,
        symbol: trade.symbol,
        side: trade.side,
        strategy: trade.strategy,
        timeframe: trade.timeframe,
        entry_price: trade.entry_price,
        entry_at: trade.created_at || trade.entry_at || new Date().toISOString(),
        entry_reason: trade.entry_reason,
        exit_price: exitPrice,
        exit_at: new Date().toISOString(),
        exit_reason: reason,
        exit_reason_detail: detail,
        position_size_usd: trade.position_size_usd,
        margin_used: trade.margin_used,
        leverage: trade.leverage,
        stop_loss: trade.stop_loss,
        take_profit: trade.take_profit,
        risk_reward: trade.risk_reward,
        pnl_usd: pnlUsd,
        pnl_pct: pnlPct,
        confidence: trade.confidence,
        signal_id: trade.signal_id,
        hold_duration_minutes: holdDurationMinutes,
        exit_quality: exitQuality,
        what_went_right: analysis.whatWentRight,
        what_went_wrong: analysis.whatWentWrong,
        strategy_notes: analysis.strategyNotes,
        market_condition: analysis.marketCondition,
        entry_features: trade.entry_features || {},
        created_at: new Date().toISOString(),
      });

      if (error) {
        logger.warn(`[PerpTradeHistory] Log close insert failed: ${error.message}`);
      }
    }

    // Update daily summary
    await updateDailySummary(trade.account_id, pnlUsd, trade.position_size_usd, pnlUsd > 0);
  } catch (e) {
    logger.warn(`[PerpTradeHistory] Log close error: ${e.message}`);
  }
}

/**
 * Generate analysis text for a trade
 */
function analyzeTrade(trade, exitPrice, reason, pnlUsd, pnlPct) {
  const side = trade.side || 'UNKNOWN';
  const symbol = trade.symbol || 'UNKNOWN';
  const strategy = trade.strategy || 'UNKNOWN';
  const entryPrice = trade.entry_price || 0;
  const sl = trade.stop_loss;
  const tp = trade.take_profit;

  let whatWentRight = '';
  let whatWentWrong = '';
  let strategyNotes = '';
  let marketCondition = '';

  // Analyze based on exit reason
  if (reason === 'tp') {
    whatWentRight = `${side} ${symbol} hit take-profit target. `;
    whatWentRight += `Entry at $${Number(entryPrice).toFixed(2)} → Exit at $${Number(exitPrice).toFixed(2)}. `;
    whatWentRight += `Strategy ${strategy} correctly identified the move direction.`;
    if (pnlPct > 5) {
      whatWentRight += ` Strong momentum confirmed the thesis.`;
    }
    whatWentWrong = 'N/A — trade hit target as planned.';
    strategyNotes = `${strategy} showed good directional accuracy on ${symbol}. Consider increasing position size for similar setups.`;
    marketCondition = 'Favorable — price moved in expected direction.';
  } else if (reason === 'sl') {
    whatWentRight = 'Stop-loss discipline protected capital from larger losses.';
    whatWentWrong = `${side} ${symbol} hit stop-loss at $${Number(exitPrice).toFixed(2)}. `;
    whatWentWrong += `Entry at $${Number(entryPrice).toFixed(2)}. `;
    if (sl) {
      const slDistance = Math.abs(entryPrice - sl) / entryPrice * 100;
      whatWentWrong += `Stop was set ${slDistance.toFixed(2)}% from entry. `;
    }
    whatWentWrong += `Strategy ${strategy} misjudged the direction or timing. `;
    whatWentWrong += `Consider if market conditions invalidated the thesis.`;
    strategyNotes = `${strategy} failed on ${symbol}. Review if entry conditions were met or if market regime changed. Consider tightening stop or waiting for confirmation.`;
    marketCondition = 'Unfavorable — price moved against the position.';
  } else if (reason === 'expired') {
    whatWentRight = 'No loss taken — trade expired without hitting SL.';
    whatWentWrong = `${side} ${symbol} expired without reaching targets. `;
    whatWentWrong += `Entry at $${Number(entryPrice).toFixed(2)}. `;
    whatWentWrong += `The expected move did not materialize within the timeframe.`;
    strategyNotes = `${strategy} on ${symbol} failed to trigger expected move. Consider if timeframe was too short or if signal was premature.`;
    marketCondition = 'Neutral — price consolidated without clear direction.';
  } else if (reason === 'adaptive_close') {
    whatWentRight = 'Adaptive risk management triggered to protect capital.';
    whatWentWrong = `${side} ${symbol} closed adaptively. `;
    whatWentWrong += `Entry at $${Number(entryPrice).toFixed(2)}, exit at $${Number(exitPrice).toFixed(2)}. `;
    whatWentWrong += `Market conditions changed, invalidating the original thesis.`;
    strategyNotes = `${strategy} on ${symbol} was adaptively closed. Monitor if market regime has shifted.`;
    marketCondition = 'Changing — market conditions shifted during the trade.';
  } else {
    // manual or other
    whatWentRight = pnlUsd >= 0 ? 'Trade closed profitably.' : 'Capital preserved by closing.';
    whatWentWrong = pnlUsd < 0
      ? `${side} ${symbol} closed at a loss of $${Math.abs(pnlUsd).toFixed(2)}. `
      : 'N/A';
    strategyNotes = `${strategy} on ${symbol}: PnL $${pnlUsd.toFixed(2)} (${pnlPct.toFixed(2)}%).`;
    marketCondition = pnlUsd >= 0 ? 'Favorable' : 'Unfavorable';
  }

  // Add P&L context
  if (pnlUsd > 0) {
    whatWentRight += ` Profit: +$${pnlUsd.toFixed(2)} (+${pnlPct.toFixed(2)}%).`;
  } else if (pnlUsd < 0) {
    whatWentWrong += ` Loss: -$${Math.abs(pnlUsd).toFixed(2)} (${pnlPct.toFixed(2)}%).`;
  }

  return { whatWentRight, whatWentWrong, strategyNotes, marketCondition };
}

/**
 * Update or create daily summary record
 */
async function updateDailySummary(accountId, pnlUsd, volumeUsd, isWin) {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Upsert daily summary
    const { data: existing } = await supabase
      .from('perp_daily_summary')
      .select('id, trades, wins, losses, pnl_usd, volume_usd, best_trade_pnl, worst_trade_pnl')
      .eq('account_id', accountId)
      .eq('date', today)
      .limit(1)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('perp_daily_summary')
        .update({
          trades: existing.trades + 1,
          wins: existing.wins + (isWin ? 1 : 0),
          losses: existing.losses + (isWin ? 0 : 1),
          pnl_usd: (existing.pnl_usd || 0) + pnlUsd,
          volume_usd: (existing.volume_usd || 0) + volumeUsd,
          best_trade_pnl: existing.best_trade_pnl !== null
            ? Math.max(existing.best_trade_pnl, pnlUsd)
            : pnlUsd,
          worst_trade_pnl: existing.worst_trade_pnl !== null
            ? Math.min(existing.worst_trade_pnl, pnlUsd)
            : pnlUsd,
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('perp_daily_summary').insert({
        account_id: accountId,
        date: today,
        trades: 1,
        wins: isWin ? 1 : 0,
        losses: isWin ? 0 : 1,
        pnl_usd: pnlUsd,
        volume_usd: volumeUsd,
        best_trade_pnl: pnlUsd,
        worst_trade_pnl: pnlUsd,
      });
    }
  } catch (e) {
    logger.warn(`[PerpTradeHistory] Daily summary update failed: ${e.message}`);
  }
}

/**
 * Get complete trade history with pagination
 */
export async function getTradeHistory({ limit = 100, offset = 0, symbol, strategy, side, sortBy = 'created_at', sortDir = 'desc' } = {}) {
  try {
    let q = supabase
      .from('perp_trade_history')
      .select('*', { count: 'exact' });

    if (symbol) q = q.eq('symbol', symbol);
    if (strategy) q = q.eq('strategy', strategy);
    if (side) q = q.eq('side', side);

    // Only return closed trades (with exit data)
    q = q.not('exit_at', 'is', null);

    q = q.order(sortBy, { ascending: sortDir === 'asc' });
    q = q.range(offset, offset + limit - 1);

    const { data, error, count } = await q;
    if (error) throw error;

    return { ok: true, data: data || [], count, limit, offset };
  } catch (e) {
    logger.error(`[PerpTradeHistory] Get history failed: ${e.message}`);
    return { ok: false, error: e.message, data: [], count: 0 };
  }
}

/**
 * Get single trade detail by trade_id
 */
export async function getTradeDetail(tradeId) {
  try {
    const { data, error } = await supabase
      .from('perp_trade_history')
      .select('*')
      .eq('trade_id', tradeId)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return { ok: true, data };
  } catch (e) {
    logger.error(`[PerpTradeHistory] Get detail failed: ${e.message}`);
    return { ok: false, error: e.message, data: null };
  }
}

/**
 * Get aggregated research data for the research agent
 */
export async function getResearchData({ strategy, symbol, limit = 500 } = {}) {
  try {
    let q = supabase
      .from('perp_trade_history')
      .select('*')
      .not('exit_at', 'is', null)
      .order('exit_at', { ascending: false });

    if (strategy) q = q.eq('strategy', strategy);
    if (symbol) q = q.eq('symbol', symbol);

    q = q.limit(limit);

    const { data, error } = await q;
    if (error) throw error;

    // Compute aggregated metrics
    const trades = data || [];
    const total = trades.length;
    const wins = trades.filter(t => (t.pnl_usd || 0) > 0).length;
    const losses = total - wins;
    const totalPnl = trades.reduce((s, t) => s + (t.pnl_usd || 0), 0);
    const grossProfit = trades.filter(t => (t.pnl_usd || 0) > 0).reduce((s, t) => s + t.pnl_usd, 0);
    const grossLoss = Math.abs(trades.filter(t => (t.pnl_usd || 0) < 0).reduce((s, t) => s + t.pnl_usd, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Strategy breakdown
    const strategyMap = new Map();
    for (const t of trades) {
      const key = t.strategy || 'unknown';
      const s = strategyMap.get(key) || { trades: 0, wins: 0, pnl: 0, exitReasons: [] };
      s.trades++;
      if ((t.pnl_usd || 0) > 0) s.wins++;
      s.pnl += t.pnl_usd || 0;
      if (t.exit_reason) s.exitReasons.push(t.exit_reason);
      strategyMap.set(key, s);
    }

    const strategyBreakdown = Array.from(strategyMap.entries()).map(([name, s]) => ({
      strategy: name,
      trades: s.trades,
      winRate: s.trades > 0 ? s.wins / s.trades : 0,
      totalPnl: s.pnl,
      avgPnl: s.trades > 0 ? s.pnl / s.trades : 0,
      commonExitReasons: getMostCommon(s.exitReasons, 3),
    }));

    // Symbol breakdown
    const symbolMap = new Map();
    for (const t of trades) {
      const key = t.symbol || 'unknown';
      const s = symbolMap.get(key) || { trades: 0, wins: 0, pnl: 0 };
      s.trades++;
      if ((t.pnl_usd || 0) > 0) s.wins++;
      s.pnl += t.pnl_usd || 0;
      symbolMap.set(key, s);
    }

    const symbolBreakdown = Array.from(symbolMap.entries()).map(([sym, s]) => ({
      symbol: sym,
      trades: s.trades,
      winRate: s.trades > 0 ? s.wins / s.trades : 0,
      totalPnl: s.pnl,
    }));

    // Exit reason distribution
    const exitReasonCounts = {};
    for (const t of trades) {
      const r = t.exit_reason || 'unknown';
      exitReasonCounts[r] = (exitReasonCounts[r] || 0) + 1;
    }

    // What worked / what failed (aggregated)
    const whatWorked = trades
      .filter(t => (t.pnl_usd || 0) > 0 && t.what_went_right)
      .slice(0, 10)
      .map(t => ({ symbol: t.symbol, strategy: t.strategy, note: t.what_went_right }));

    const whatFailed = trades
      .filter(t => (t.pnl_usd || 0) < 0 && t.what_went_wrong)
      .slice(0, 10)
      .map(t => ({ symbol: t.symbol, strategy: t.strategy, note: t.what_went_wrong }));

    // Hold time analysis
    const holdTimes = trades.filter(t => t.hold_duration_minutes).map(t => t.hold_duration_minutes);
    const avgHold = holdTimes.length > 0
      ? holdTimes.reduce((s, v) => s + v, 0) / holdTimes.length
      : 0;

    // Best/worst trades
    const sortedByPnl = [...trades].sort((a, b) => (b.pnl_usd || 0) - (a.pnl_usd || 0));
    const bestTrades = sortedByPnl.slice(0, 5);
    const worstTrades = sortedByPnl.slice(-5).reverse();

    // Max drawdown
    let maxDrawdown = 0, peak = 0, running = 0;
    for (const t of [...trades].sort((a, b) => (a.exit_at || '').localeCompare(b.exit_at || ''))) {
      running += t.pnl_usd || 0;
      if (running > peak) peak = running;
      maxDrawdown = Math.max(maxDrawdown, peak - running);
    }

    return {
      ok: true,
      summary: {
        totalTrades: total,
        wins,
        losses,
        winRate: total > 0 ? wins / total : 0,
        totalPnl,
        avgPnl: total > 0 ? totalPnl / total : 0,
        profitFactor,
        maxDrawdown,
        avgHoldMinutes: Math.round(avgHold),
        bestTrade: sortedByPnl[0]?.pnl_usd || 0,
        worstTrade: sortedByPnl[sortedByPnl.length - 1]?.pnl_usd || 0,
      },
      strategyBreakdown,
      symbolBreakdown,
      exitReasonDistribution: exitReasonCounts,
      whatWorked,
      whatFailed,
      bestTrades: bestTrades.map(t => ({
        tradeId: t.trade_id,
        symbol: t.symbol,
        side: t.side,
        strategy: t.strategy,
        pnlUsd: t.pnl_usd,
        pnlPct: t.pnl_pct,
        exitAt: t.exit_at,
      })),
      worstTrades: worstTrades.map(t => ({
        tradeId: t.trade_id,
        symbol: t.symbol,
        side: t.side,
        strategy: t.strategy,
        pnlUsd: t.pnl_usd,
        pnlPct: t.pnl_pct,
        exitAt: t.exit_at,
      })),
      rawTrades: trades.map(t => ({
        tradeId: t.trade_id,
        symbol: t.symbol,
        side: t.side,
        strategy: t.strategy,
        entryPrice: t.entry_price,
        exitPrice: t.exit_price,
        entryAt: t.entry_at,
        exitAt: t.exit_at,
        pnlUsd: t.pnl_usd,
        pnlPct: t.pnl_pct,
        leverage: t.leverage,
        exitReason: t.exit_reason,
        exitQuality: t.exit_quality,
        holdMinutes: t.hold_duration_minutes,
        whatWentRight: t.what_went_right,
        whatWentWrong: t.what_went_wrong,
        strategyNotes: t.strategy_notes,
        marketCondition: t.market_condition,
        confidence: t.confidence,
      })),
      generatedAt: new Date().toISOString(),
    };
  } catch (e) {
    logger.error(`[PerpTradeHistory] Research data failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * Helper: get most common items from an array
 */
function getMostCommon(arr, n = 3) {
  const counts = {};
  for (const item of arr) {
    counts[item] = (counts[item] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([item, count]) => ({ item, count }));
}
