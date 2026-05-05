// ============================================================
// API: Perpetual Trader — Single Trade Detail
// GET /api/perpetual-trader/trade-detail?id=<tradeId>
// Returns full detail for one trade including analysis fields.
// Used by the trade detail page (new tab).
// ============================================================

import { supabase, isSupabaseNoOp } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tradeId = req.query?.id;
  if (!tradeId) {
    return res.status(400).json({ ok: false, error: 'Missing trade id parameter' });
  }

  try {
    if (isSupabaseNoOp()) {
      return res.status(503).json({
        ok: false,
        error: 'Supabase is not configured.',
      });
    }

    // Get trade detail from history table
    const { data: history, error: histErr } = await supabase
      .from('perp_trade_history')
      .select('*')
      .eq('trade_id', tradeId)
      .limit(1)
      .maybeSingle();

    if (histErr) throw histErr;

    // Also get the raw trade from perpetual_mock_trades for extra context
    const { data: rawTrade, error: rawErr } = await supabase
      .from('perpetual_mock_trades')
      .select('*')
      .eq('id', tradeId)
      .limit(1)
      .maybeSingle();

    if (rawErr) {
      logger.warn(`[perp-trade-detail] Raw trade fetch failed: ${rawErr.message}`);
    }

    if (!history && !rawTrade) {
      return res.status(404).json({ ok: false, error: 'Trade not found' });
    }

    // Merge data sources
    const trade = {
      // From history (preferred)
      tradeId: history?.trade_id || rawTrade?.id,
      symbol: history?.symbol || rawTrade?.symbol,
      side: history?.side || rawTrade?.side,
      strategy: history?.strategy || rawTrade?.strategy,
      timeframe: history?.timeframe || rawTrade?.timeframe,
      entryPrice: history?.entry_price || rawTrade?.entry_price,
      exitPrice: history?.exit_price || rawTrade?.exit_price,
      entryAt: history?.entry_at || rawTrade?.created_at,
      exitAt: history?.exit_at || rawTrade?.exit_at,
      entryReason: history?.entry_reason || rawTrade?.entry_reason,
      exitReason: history?.exit_reason || rawTrade?.exit_reason,
      exitReasonDetail: history?.exit_reason_detail || rawTrade?.exit_reason_detail,
      positionSizeUsd: history?.position_size_usd || rawTrade?.position_size_usd,
      marginUsed: history?.margin_used || rawTrade?.margin_used,
      leverage: history?.leverage || rawTrade?.leverage,
      stopLoss: history?.stop_loss || rawTrade?.stop_loss,
      takeProfit: history?.take_profit || rawTrade?.take_profit,
      riskReward: history?.risk_reward || rawTrade?.risk_reward,
      pnlUsd: history?.pnl_usd || rawTrade?.pnl_usd,
      pnlPct: history?.pnl_pct || rawTrade?.pnl_pct,
      confidence: history?.confidence || rawTrade?.confidence,
      holdDurationMinutes: history?.hold_duration_minutes,
      exitQuality: history?.exit_quality,
      whatWentRight: history?.what_went_right,
      whatWentWrong: history?.what_went_wrong,
      strategyNotes: history?.strategy_notes,
      marketCondition: history?.market_condition,
      entryFeatures: history?.entry_features || rawTrade?.entry_features || {},
      status: rawTrade?.status || 'closed',
    };

    // Compute additional analysis
    const analysis = computeTradeAnalysis(trade);

    return res.status(200).json({
      ok: true,
      trade,
      analysis,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`[perp-trade-detail] Error: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Compute additional analysis for a single trade
 */
function computeTradeAnalysis(trade) {
  const analysis = {
    riskRewardAnalysis: null,
    performanceGrade: null,
    lessons: [],
    recommendations: [],
  };

  if (!trade.entryPrice || !trade.exitPrice) return analysis;

  const entry = Number(trade.entryPrice);
  const exit = Number(trade.exitPrice);
  const side = trade.side;
  const pnlPct = trade.pnlPct || 0;
  const pnlUsd = trade.pnlUsd || 0;
  const sl = trade.stopLoss ? Number(trade.stopLoss) : null;
  const tp = trade.takeProfit ? Number(trade.takeProfit) : null;

  // Risk/Reward analysis
  if (sl && tp) {
    const riskAmount = Math.abs(entry - sl);
    const rewardAmount = Math.abs(tp - entry);
    const actualMove = Math.abs(exit - entry);
    const rr = trade.riskReward || (riskAmount > 0 ? rewardAmount / riskAmount : 0);
    const actualRR = riskAmount > 0 ? actualMove / riskAmount : 0;

    analysis.riskRewardAnalysis = {
      plannedRR: rr,
      actualRR: Math.round(actualRR * 100) / 100,
      riskAmount: Math.round(riskAmount * 100) / 100,
      rewardAmount: Math.round(rewardAmount * 100) / 100,
      actualMove: Math.round(actualMove * 100) / 100,
      hitTarget: trade.exitReason === 'tp',
      hitStop: trade.exitReason === 'sl',
    };
  }

  // Performance grade
  if (pnlPct >= 10) analysis.performanceGrade = 'A+';
  else if (pnlPct >= 5) analysis.performanceGrade = 'A';
  else if (pnlPct >= 2) analysis.performanceGrade = 'B';
  else if (pnlPct >= 0) analysis.performanceGrade = 'C';
  else if (pnlPct >= -3) analysis.performanceGrade = 'D';
  else analysis.performanceGrade = 'F';

  // Lessons learned
  if (pnlUsd > 0) {
    analysis.lessons.push(
      `${trade.strategy} strategy worked well on ${trade.symbol} ${side}.`,
      `Entry at $${entry.toFixed(2)} was well-timed.`,
      `Exit at $${exit.toFixed(2)} captured ${pnlPct > 0 ? 'positive' : 'negative'} movement.`
    );
    if (trade.exitReason === 'tp') {
      analysis.lessons.push('Take-profit target was correctly placed.');
    }
    analysis.recommendations.push(
      `Consider similar ${trade.strategy} setups on ${trade.symbol}.`,
      `Maintain current position sizing for this strategy.`
    );
  } else if (pnlUsd < 0) {
    analysis.lessons.push(
      `${trade.strategy} strategy failed on ${trade.symbol} ${side}.`,
      `Entry at $${entry.toFixed(2)} was against the market direction.`,
      `Loss of $${Math.abs(pnlUsd).toFixed(2)} (${pnlPct.toFixed(2)}%).`
    );
    if (trade.exitReason === 'sl') {
      analysis.lessons.push('Stop-loss was triggered — discipline preserved capital.');
      analysis.recommendations.push(
        'Review if entry conditions were fully met before entering.',
        'Consider waiting for stronger confirmation signals.',
        'Evaluate if stop-loss distance was appropriate for volatility.'
      );
    } else {
      analysis.recommendations.push(
        'Review the strategy parameters for this setup.',
        'Consider paper trading this strategy before re-entering.'
      );
    }
  }

  // Hold time insight
  if (trade.holdDurationMinutes !== null && trade.holdDurationMinutes !== undefined) {
    const hours = Math.floor(trade.holdDurationMinutes / 60);
    const mins = trade.holdDurationMinutes % 60;
    analysis.lessons.push(
      `Trade held for ${hours > 0 ? `${hours}h ` : ''}${mins}m.`
    );
  }

  return analysis;
}
