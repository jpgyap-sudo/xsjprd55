// ============================================================
// Exit Engine — Enhanced Exit Logic
// Breakeven after +1R, partial TP, trailing after momentum,
// time stops, and volatility-adjusted trailing.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { calculatePnl } from './mock-account-engine.js';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

const BREAKEVEN_R_MULTIPLE = 1.0;
const PARTIAL_TP_R_MULTIPLE = 1.0;
const PARTIAL_TP_PCT = 0.3; // Close 30% at partial TP
const TRAILING_ACTIVATE_R_MULTIPLE = 1.5;
const TIME_STOP_CANDLES = 16; // For 15m = 4 hours
const VOLATILITY_ADJUSTMENT_FACTOR = 0.5; // How much to adjust trailing by volatility

// ── Main: Monitor All Open Trades ───────────────────────────

/**
 * Monitor all open trades with enhanced exit logic.
 * @param {object[]} openTrades - Array of open trade rows
 * @param {object} marketData - { [symbol]: { currentPrice, volume, atrPct, high, low } }
 * @returns {object[]} actions taken
 */
export async function monitorExitsWithEnhancedLogic(openTrades, marketData = {}) {
  const actions = [];

  for (const trade of openTrades) {
    const symbol = trade.symbol;
    const md = marketData[symbol];

    if (!md || !md.currentPrice) {
      continue; // No price data for this symbol
    }

    const currentPrice = md.currentPrice;
    const action = await evaluateTradeExit(trade, currentPrice, md);
    if (action) {
      actions.push(action);
    }
  }

  return actions;
}

// ── Evaluate Single Trade ───────────────────────────────────

async function evaluateTradeExit(trade, currentPrice, marketData) {
  const entry = parseFloat(trade.entry_price);
  const stopLoss = parseFloat(trade.stop_loss);
  const takeProfit = parseFloat(trade.take_profit);
  const isLong = trade.side === 'LONG';

  if (!entry || !currentPrice) return null;

  // Calculate current unrealized PnL as R-multiple
  const riskPerUnit = isLong
    ? Math.abs(entry - stopLoss)
    : Math.abs(stopLoss - entry);

  if (riskPerUnit === 0) return null;

  const movePerUnit = isLong
    ? (currentPrice - entry)
    : (entry - currentPrice);

  const currentR = movePerUnit / riskPerUnit;
  const totalRisk = trade.initial_risk_usd || (riskPerUnit * (trade.position_size_usd / entry));

  // ── 1. Check Time Stop ─────────────────────────────────
  const timeStopResult = checkTimeStop(trade, currentPrice, currentR);
  if (timeStopResult.shouldClose) {
    return await executeExit(trade, timeStopResult.exitPrice, 'time_stop', {
      reason: `Time stop after ${timeStopResult.candlesOpen} candles`,
      rMultiple: currentR,
    });
  }

  // ── 2. Check Partial TP ────────────────────────────────
  if (currentR >= PARTIAL_TP_R_MULTIPLE && (!trade.partial_exit_pct || trade.partial_exit_pct === 0)) {
    return await executePartialTP(trade, currentPrice, currentR, marketData);
  }

  // ── 3. Check Breakeven Move ────────────────────────────
  const beResult = shouldMoveToBreakeven(trade, currentPrice, currentR, marketData);
  if (beResult.shouldMove) {
    await moveStopToBreakeven(trade, beResult.newStopLoss);
    return {
      action: 'breakeven',
      tradeId: trade.id,
      symbol: trade.symbol,
      newStopLoss: beResult.newStopLoss,
      reason: beResult.reason,
    };
  }

  // ── 4. Check Trailing Stop Activation ──────────────────
  const trailResult = shouldActivateTrailing(trade, currentPrice, currentR, marketData);
  if (trailResult.shouldActivate) {
    await activateTrailingStop(trade, currentPrice, trailResult.trailPct);
    return {
      action: 'trailing_activated',
      tradeId: trade.id,
      symbol: trade.symbol,
      trailPct: trailResult.trailPct,
      reason: trailResult.reason,
    };
  }

  // ── 5. Update Trailing Stop (if already active) ────────
  if (trade.trailing_stop_pct) {
    const trailUpdated = await updateTrailingStop(trade, currentPrice, marketData);
    if (trailUpdated) {
      return {
        action: 'trailing_updated',
        tradeId: trade.id,
        symbol: trade.symbol,
        newStopLoss: trailUpdated,
        reason: 'Trailing stop updated',
      };
    }
  }

  return null;
}

// ── Time Stop ───────────────────────────────────────────────

function checkTimeStop(trade, currentPrice, currentR) {
  if (!trade.created_at) return { shouldClose: false };

  const openTime = new Date(trade.created_at).getTime();
  const now = Date.now();
  const timeDiffMinutes = (now - openTime) / 60000;

  // Determine max candles based on timeframe
  const timeframe = trade.timeframe || '15m';
  const candleMinutes = parseTimeframeToMinutes(timeframe);
  const candlesOpen = Math.round(timeDiffMinutes / candleMinutes);

  if (candlesOpen >= TIME_STOP_CANDLES && currentR < 0.1) {
    return {
      shouldClose: true,
      exitPrice: currentPrice,
      candlesOpen,
      reason: `Trade open for ${candlesOpen} candles with minimal profit (${(currentR * 100).toFixed(0)}% of target)`,
    };
  }

  return { shouldClose: false, candlesOpen };
}

function parseTimeframeToMinutes(tf) {
  const match = tf.match(/^(\d+)([mhd])$/);
  if (!match) return 15; // default 15m
  const val = parseInt(match[1]);
  const unit = match[2];
  switch (unit) {
    case 'm': return val;
    case 'h': return val * 60;
    case 'd': return val * 1440;
    default: return 15;
  }
}

// ── Partial TP ──────────────────────────────────────────────

async function executePartialTP(trade, currentPrice, currentR, marketData) {
  const partialSize = parseFloat(trade.position_size_usd) * PARTIAL_TP_PCT;
  const remainingSize = parseFloat(trade.position_size_usd) * (1 - PARTIAL_TP_PCT);

  // Calculate PnL on partial close
  const entry = parseFloat(trade.entry_price);
  const isLong = trade.side === 'LONG';
  const pnlPct = isLong
    ? ((currentPrice - entry) / entry) * 100
    : ((entry - currentPrice) / entry) * 100;
  const pnlUsd = partialSize * (pnlPct / 100);

  // Update trade record: record partial exit
  const { error } = await supabase
    .from('mock_trades')
    .update({
      partial_exit_price: currentPrice,
      partial_exit_pct: PARTIAL_TP_PCT,
      position_size_usd: Math.round(remainingSize * 100) / 100,
      // Reduce SL proportionally for remaining position
      stop_loss: isLong
        ? Math.max(parseFloat(trade.stop_loss), entry * 0.995) // Move SL to -0.5% for remaining
        : Math.min(parseFloat(trade.stop_loss), entry * 1.005),
    })
    .eq('id', trade.id);

  if (error) {
    console.error(`[ExitEngine] Partial TP error for trade ${trade.id}:`, error);
    return null;
  }

  // Credit partial profit to account
  await creditPartialProfit(trade, pnlUsd);

  return {
    action: 'partial_tp',
    tradeId: trade.id,
    symbol: trade.symbol,
    partialExitPrice: currentPrice,
    partialPnlUsd: Math.round(pnlUsd * 100) / 100,
    remainingSize: Math.round(remainingSize * 100) / 100,
    reason: `Partial TP at ${(currentR * 100).toFixed(0)}% of target (${PARTIAL_TP_PCT * 100}% position closed)`,
  };
}

async function creditPartialProfit(trade, pnlUsd) {
  try {
    const { data: account } = await supabase
      .from('mock_accounts')
      .select('balance, total_pnl')
      .eq('id', trade.account_id)
      .single();

    if (account) {
      await supabase
        .from('mock_accounts')
        .update({
          balance: Math.round((account.balance + pnlUsd) * 100) / 100,
          total_pnl: Math.round((account.total_pnl + pnlUsd) * 100) / 100,
        })
        .eq('id', trade.account_id);
    }
  } catch (err) {
    console.error(`[ExitEngine] Credit partial profit error:`, err);
  }
}

// ── Breakeven Stop ──────────────────────────────────────────

function shouldMoveToBreakeven(trade, currentPrice, currentR, marketData) {
  // Don't move if already moved
  const currentSL = parseFloat(trade.stop_loss);
  const entry = parseFloat(trade.entry_price);
  const isLong = trade.side === 'LONG';

  if (isLong && currentSL >= entry) return { shouldMove: false }; // Already at breakeven or better
  if (!isLong && currentSL <= entry) return { shouldMove: false };

  if (currentR >= BREAKEVEN_R_MULTIPLE) {
    const newSL = isLong ? entry * 1.001 : entry * 0.999; // Slight buffer above/below entry
    return {
      shouldMove: true,
      newStopLoss: Math.round(newSL * 100) / 100,
      reason: `Breakeven: price moved ${(currentR * 100).toFixed(0)}% of target (>= ${BREAKEVEN_R_MULTIPLE}R)`,
    };
  }

  return { shouldMove: false };
}

async function moveStopToBreakeven(trade, newStopLoss) {
  const { error } = await supabase
    .from('mock_trades')
    .update({ stop_loss: newStopLoss })
    .eq('id', trade.id);

  if (error) {
    console.error(`[ExitEngine] Breakeven move error for trade ${trade.id}:`, error);
  }
}

// ── Trailing Stop ───────────────────────────────────────────

function shouldActivateTrailing(trade, currentPrice, currentR, marketData) {
  // Don't re-activate if already trailing
  if (trade.trailing_stop_pct) return { shouldActivate: false };

  if (currentR >= TRAILING_ACTIVATE_R_MULTIPLE) {
    // Check volume confirmation
    const volumeOk = !marketData.volume || marketData.volume > 0;

    if (volumeOk) {
      // Calculate trailing percentage based on volatility
      const atrPct = marketData.atrPct || 1.5;
      const trailPct = getTrailingPct(atrPct);

      return {
        shouldActivate: true,
        trailPct,
        reason: `Trailing activated at ${(currentR * 100).toFixed(0)}% of target (ATR: ${atrPct.toFixed(1)}%, trail: ${(trailPct * 100).toFixed(2)}%)`,
      };
    }
  }

  return { shouldActivate: false };
}

function getTrailingPct(atrPct) {
  // Base trailing: 0.5% for normal volatility
  // Scale with volatility
  const baseTrail = 0.005;
  const volatilityMultiplier = Math.max(0.5, Math.min(2.0, atrPct / 1.5));
  return Math.round(baseTrail * volatilityMultiplier * 10000) / 10000;
}

async function activateTrailingStop(trade, currentPrice, trailPct) {
  const entry = parseFloat(trade.entry_price);
  const isLong = trade.side === 'LONG';
  const trailDistance = entry * trailPct;

  const newStopLoss = isLong
    ? currentPrice - trailDistance
    : currentPrice + trailDistance;

  const { error } = await supabase
    .from('mock_trades')
    .update({
      trailing_stop_pct: trailPct,
      stop_loss: Math.round(newStopLoss * 100) / 100,
    })
    .eq('id', trade.id);

  if (error) {
    console.error(`[ExitEngine] Activate trailing error for trade ${trade.id}:`, error);
  }
}

async function updateTrailingStop(trade, currentPrice, marketData) {
  const trailPct = parseFloat(trade.trailing_stop_pct);
  const currentSL = parseFloat(trade.stop_loss);
  const entry = parseFloat(trade.entry_price);
  const isLong = trade.side === 'LONG';

  if (!trailPct || !currentSL) return null;

  const trailDistance = entry * trailPct;

  // Volatility-adjusted trailing: widen trail in high volatility
  const atrPct = marketData.atrPct || 1.5;
  const adjustedTrailPct = trailPct * (1 + (atrPct - 1.5) * VOLATILITY_ADJUSTMENT_FACTOR);
  const adjustedDistance = entry * Math.max(trailPct, adjustedTrailPct);

  let newStopLoss;
  if (isLong) {
    newStopLoss = currentPrice - adjustedDistance;
    // Only move up, never down
    if (newStopLoss <= currentSL) return null;
  } else {
    newStopLoss = currentPrice + adjustedDistance;
    // Only move down, never up
    if (newStopLoss >= currentSL) return null;
  }

  newStopLoss = Math.round(newStopLoss * 100) / 100;

  const { error } = await supabase
    .from('mock_trades')
    .update({ stop_loss: newStopLoss })
    .eq('id', trade.id);

  if (error) {
    console.error(`[ExitEngine] Update trailing error for trade ${trade.id}:`, error);
    return null;
  }

  return newStopLoss;
}

// ── Execute Full Exit ───────────────────────────────────────

async function executeExit(trade, exitPrice, exitReason, meta = {}) {
  const entry = parseFloat(trade.entry_price);
  const isLong = trade.side === 'LONG';

  const pnlPct = isLong
    ? ((exitPrice - entry) / entry) * 100
    : ((entry - exitPrice) / entry) * 100;

  const positionSize = parseFloat(trade.position_size_usd);
  const pnlUsd = positionSize * (pnlPct / 100);

  const rMultiple = meta.rMultiple || 0;

  // Update trade record
  const { error } = await supabase
    .from('mock_trades')
    .update({
      exit_price: exitPrice,
      exit_reason: exitReason,
      pnl_pct: Math.round(pnlPct * 100) / 100,
      pnl_usd: Math.round(pnlUsd * 100) / 100,
      r_multiple_at_close: Math.round(rMultiple * 100) / 100,
      closed_at: new Date().toISOString(),
      status: 'closed',
    })
    .eq('id', trade.id);

  if (error) {
    console.error(`[ExitEngine] Exit error for trade ${trade.id}:`, error);
    return null;
  }

  // Update account balance
  try {
    const { data: account } = await supabase
      .from('mock_accounts')
      .select('balance, total_pnl, total_trades, wins, losses')
      .eq('id', trade.account_id)
      .single();

    if (account) {
      await supabase
        .from('mock_accounts')
        .update({
          balance: Math.round((account.balance + pnlUsd) * 100) / 100,
          total_pnl: Math.round((account.total_pnl + pnlUsd) * 100) / 100,
          total_trades: (account.total_trades || 0) + 1,
          wins: (account.wins || 0) + (pnlUsd > 0 ? 1 : 0),
          losses: (account.losses || 0) + (pnlUsd <= 0 ? 1 : 0),
        })
        .eq('id', trade.account_id);
    }
  } catch (err) {
    console.error(`[ExitEngine] Account update error:`, err);
  }

  return {
    action: 'closed',
    tradeId: trade.id,
    symbol: trade.symbol,
    exitPrice,
    exitReason,
    pnlUsd: Math.round(pnlUsd * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100,
    rMultiple: Math.round(rMultiple * 100) / 100,
    reason: meta.reason || exitReason,
  };
}
