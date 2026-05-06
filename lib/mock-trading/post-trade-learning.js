// ============================================================
// Post-Trade Learning — MFE/MAE Analysis & Lesson Extraction
// Called after every closed trade to capture detailed analytics
// and update the strategy scorecard.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { recordTradeOutcome } from './strategy-scorecard.js';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

// ── Main: Analyze a Closed Trade ────────────────────────────

/**
 * Analyze a closed trade and update scorecard + metadata.
 * @param {object} trade - Full trade row from mock_trades
 * @param {object} options
 * @param {number[]} [options.priceHistory] - Array of prices during the trade (for MFE/MAE)
 * @param {string} [options.marketRegime] - Regime label at entry
 * @param {number} [options.spreadEstimateBps] - Estimated spread in bps
 * @param {number} [options.slippageEstimateBps] - Estimated slippage in bps
 * @returns {object} analysis result
 */
export async function analyzeClosedTrade(trade, options = {}) {
  if (!trade) {
    return { error: 'No trade data provided' };
  }

  const {
    priceHistory = [],
    marketRegime = null,
    spreadEstimateBps = 5,
    slippageEstimateBps = 3,
  } = options;

  // 1. Compute MFE / MAE from price history
  const mfeMae = computeMFEMAE(trade, priceHistory);

  // 2. Compute R-multiple
  const rMultiple = computeRMultiple(trade);

  // 3. Time in trade
  const timeInTradeMinutes = computeTimeInTrade(trade);

  // 4. Entry / exit quality assessment
  const entryQuality = assessEntryQuality(trade, mfeMae);
  const exitQuality = assessExitQuality(trade, mfeMae, rMultiple);

  // 5. Generate lessons
  const lessons = generateLessons(trade, mfeMae, rMultiple, exitQuality);

  // 6. Build post-trade metadata
  const postTrade = {
    tpHitFirst: wasTPHitFirst(trade),
    slHitFirst: wasSLHitFirst(trade),
    maxFavorableExcursionPct: mfeMae.mfePct,
    maxAdverseExcursionPct: mfeMae.maePct,
    timeInTradeMinutes,
    spreadEstimateBps,
    slippageEstimateBps,
    marketRegimeAtEntry: marketRegime || trade.market_regime_at_entry || 'unknown',
    entryQuality,
    exitQuality,
    rMultiple,
    initialRiskUsd: trade.initial_risk_usd || computeInitialRisk(trade),
    lessons,
  };

  // 7. Update mock_trades.metadata with post-trade data
  await updateTradeMetadata(trade.id, postTrade);

  // 8. Update strategy scorecard
  const regime = marketRegime || trade.market_regime_at_entry || 'any';
  const scorecardKey = {
    strategy_name: trade.strategy_name || 'unknown',
    symbol: trade.symbol,
    timeframe: trade.timeframe || '15m',
    market_regime: regime,
  };

  const tradeResult = {
    pnl_usd: trade.pnl_usd || 0,
    pnl_pct: trade.pnl_pct || 0,
    r_multiple: rMultiple,
    time_in_trade_minutes: timeInTradeMinutes,
    mfe_pct: mfeMae.mfePct,
    mae_pct: mfeMae.maePct,
  };

  const updatedScorecard = await recordTradeOutcome(scorecardKey, tradeResult);

  return {
    postTrade,
    scorecard: updatedScorecard,
    mfeMae,
    rMultiple,
    timeInTradeMinutes,
    entryQuality,
    exitQuality,
    lessons,
  };
}

// ── MFE / MAE Computation ───────────────────────────────────

function computeMFEMAE(trade, priceHistory) {
  if (!priceHistory || priceHistory.length < 2) {
    // Estimate from entry/exit if no intra-trade prices
    const entry = parseFloat(trade.entry_price);
    const exit = parseFloat(trade.exit_price);
    const isLong = trade.side === 'LONG';

    if (isLong) {
      return {
        mfePct: Math.max(0, ((exit - entry) / entry) * 100),
        maePct: Math.max(0, ((entry - Math.min(entry, exit)) / entry) * 100),
      };
    } else {
      return {
        mfePct: Math.max(0, ((entry - exit) / entry) * 100),
        maePct: Math.max(0, ((Math.max(entry, exit) - entry) / entry) * 100),
      };
    }
  }

  const entry = parseFloat(trade.entry_price);
  const isLong = trade.side === 'LONG';

  let maxPrice = entry;
  let minPrice = entry;

  for (const price of priceHistory) {
    if (price > maxPrice) maxPrice = price;
    if (price < minPrice) minPrice = price;
  }

  // Also consider exit price
  const exit = parseFloat(trade.exit_price);
  if (exit > maxPrice) maxPrice = exit;
  if (exit < minPrice) minPrice = exit;

  if (isLong) {
    return {
      mfePct: ((maxPrice - entry) / entry) * 100,
      maePct: ((entry - minPrice) / entry) * 100,
    };
  } else {
    return {
      mfePct: ((entry - minPrice) / entry) * 100,
      maePct: ((maxPrice - entry) / entry) * 100,
    };
  }
}

// ── R-Multiple ──────────────────────────────────────────────

function computeRMultiple(trade) {
  if (trade.r_multiple_at_close) return parseFloat(trade.r_multiple_at_close);

  const entry = parseFloat(trade.entry_price);
  const exit = parseFloat(trade.exit_price);
  const stopLoss = parseFloat(trade.stop_loss);

  if (!entry || !exit || !stopLoss || entry === 0) return 0;

  const isLong = trade.side === 'LONG';
  const riskPerUnit = isLong
    ? Math.abs(entry - stopLoss)
    : Math.abs(stopLoss - entry);

  if (riskPerUnit === 0) return 0;

  const movePerUnit = isLong ? (exit - entry) : (entry - exit);
  return movePerUnit / riskPerUnit;
}

// ── Time in Trade ───────────────────────────────────────────

function computeTimeInTrade(trade) {
  if (!trade.created_at || !trade.closed_at) return 0;

  const open = new Date(trade.created_at);
  const close = new Date(trade.closed_at);
  return Math.round((close - open) / 60000); // minutes
}

// ── Entry Quality ───────────────────────────────────────────

function assessEntryQuality(trade, mfeMae) {
  // Good entry: price moved favorably soon after entry (low MAE relative to MFE)
  if (mfeMae.mfePct > 0 && mfeMae.maePct < mfeMae.mfePct * 0.3) {
    return 'good';
  }
  // Fair entry: some adverse movement but recovered
  if (mfeMae.mfePct > 0 && mfeMae.maePct < mfeMae.mfePct * 0.7) {
    return 'fair';
  }
  // Poor entry: price went against significantly before recovering
  if (mfeMae.maePct > mfeMae.mfePct * 0.7) {
    return 'poor';
  }
  return 'unknown';
}

// ── Exit Quality ────────────────────────────────────────────

function assessExitQuality(trade, mfeMae, rMultiple) {
  // If MFE was much higher than realized PnL, exit was early
  if (mfeMae.mfePct > 0 && trade.pnl_pct) {
    const pnlPct = Math.abs(parseFloat(trade.pnl_pct) || 0);
    if (pnlPct > 0 && mfeMae.mfePct > pnlPct * 2) {
      return 'early';
    }
  }

  // If SL hit but price reversed to TP later, exit was too tight
  if (trade.exit_reason === 'stop_loss' && mfeMae.mfePct > Math.abs(parseFloat(trade.pnl_pct) || 0) * 3) {
    return 'too_tight';
  }

  // If TP hit cleanly
  if (trade.exit_reason === 'take_profit') {
    return 'good';
  }

  // If time stop
  if (trade.exit_reason === 'time_stop') {
    return 'timeout';
  }

  return 'fair';
}

// ── TP/SL Hit Detection ─────────────────────────────────────

function wasTPHitFirst(trade) {
  return trade.exit_reason === 'take_profit';
}

function wasSLHitFirst(trade) {
  return trade.exit_reason === 'stop_loss';
}

// ── Initial Risk ────────────────────────────────────────────

function computeInitialRisk(trade) {
  const entry = parseFloat(trade.entry_price);
  const stopLoss = parseFloat(trade.stop_loss);
  const positionSize = parseFloat(trade.position_size_usd);

  if (!entry || !stopLoss || !positionSize) return 0;

  const riskPct = Math.abs((entry - stopLoss) / entry);
  return Math.round(positionSize * riskPct * 100) / 100;
}

// ── Update Trade Metadata ───────────────────────────────────

async function updateTradeMetadata(tradeId, postTrade) {
  try {
    // Fetch current metadata
    const { data: trade, error: fetchErr } = await supabase
      .from('mock_trades')
      .select('metadata')
      .eq('id', tradeId)
      .single();

    if (fetchErr) {
      console.error(`[PostTrade] Fetch trade ${tradeId} error:`, fetchErr);
      return;
    }

    const existingMeta = trade?.metadata || {};
    const updatedMeta = {
      ...existingMeta,
      postTrade,
    };

    const { error: updateErr } = await supabase
      .from('mock_trades')
      .update({ metadata: updatedMeta })
      .eq('id', tradeId);

    if (updateErr) {
      console.error(`[PostTrade] Update trade ${tradeId} metadata error:`, updateErr);
    }
  } catch (err) {
    console.error(`[PostTrade] Error updating metadata:`, err);
  }
}

// ── Lesson Generation ───────────────────────────────────────

function generateLessons(trade, mfeMae, rMultiple, exitQuality) {
  const lessons = [];
  const pnlPct = parseFloat(trade.pnl_pct) || 0;

  // Lesson 1: Exit too early
  if (exitQuality === 'early') {
    lessons.push('Exit was too early — price reached much higher after close. Consider wider targets or trailing stop.');
  }

  // Lesson 2: SL too tight
  if (exitQuality === 'too_tight') {
    lessons.push('Stop loss was too tight for this volatility. Price reversed to target after hitting SL. Widen SL or use ATR-based placement.');
  }

  // Lesson 3: Good hold
  if (exitQuality === 'good' && rMultiple >= 2) {
    lessons.push('Good hold — captured full move. Maintain current exit strategy.');
  }

  // Lesson 4: MFE significantly higher than realized
  if (mfeMae.mfePct > 0 && Math.abs(pnlPct) > 0 && mfeMae.mfePct > Math.abs(pnlPct) * 3) {
    lessons.push(`Price moved ${mfeMae.mfePct.toFixed(1)}% favorably but only ${Math.abs(pnlPct).toFixed(1)}% was captured. Review exit timing.`);
  }

  // Lesson 5: High adverse excursion
  if (mfeMae.maePct > 2) {
    lessons.push(`High adverse excursion (${mfeMae.maePct.toFixed(1)}%) — entry timing or SL placement needs improvement.`);
  }

  // Lesson 6: Time stop
  if (exitQuality === 'timeout') {
    lessons.push('Trade expired without reaching targets. Consider if this strategy works in current market regime.');
  }

  // Lesson 7: Loss with no clear reason
  if (pnlPct < 0 && mfeMae.mfePct < 1) {
    lessons.push('Loss with minimal favorable movement — check if entry was against the trend.');
  }

  return lessons;
}

// ── Batch Update Existing Trades ────────────────────────────

/**
 * Process all closed trades that don't have post-trade analysis yet.
 * Useful for backfilling after deployment.
 */
export async function backfillPostTradeAnalysis(limit = 50) {
  const { data: trades, error } = await supabase
    .from('mock_trades')
    .select('*')
    .not('closed_at', 'is', null)
    .is('metadata->postTrade', null)
    .order('closed_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[PostTrade] Backfill fetch error:`, error);
    return { processed: 0, errors: [error] };
  }

  let processed = 0;
  const errors = [];

  for (const trade of trades || []) {
    try {
      await analyzeClosedTrade(trade);
      processed++;
    } catch (err) {
      errors.push({ tradeId: trade.id, error: err.message });
    }
  }

  return { processed, errors };
}
