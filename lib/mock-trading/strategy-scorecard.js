// ============================================================
// Strategy Scorecard — Rolling Performance Tracking
// Tracks win rate, profit factor, avg R, drawdown per
// (strategy, symbol, timeframe, market_regime) combo.
// Also manages auto-throttle logic.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

const THROTTLE_MIN_TRADES = 10;
const THROTTLE_WIN_RATE = 0.45;
const THROTTLE_MIN_PROFIT_FACTOR = 1.0;
const THROTTLE_MIN_AVG_R = 0;
const THROTTLE_MAX_DRAWDOWN = 20;
const THROTTLE_DURATION_HOURS = 24;
const DASHBOARD_MIN_TRADES = 30;
const ROLLING_WINDOW = 50;

// ── Helpers ─────────────────────────────────────────────────

function buildKey(strategy, symbol, timeframe, regime = 'any') {
  return { strategy_name: strategy, symbol, timeframe, market_regime: regime };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ── Core: Record Trade Outcome ──────────────────────────────

/**
 * Upsert scorecard row after a trade closes.
 * @param {object} key - { strategy_name, symbol, timeframe, market_regime }
 * @param {object} tradeResult - { pnl_usd, pnl_pct, r_multiple, time_in_trade_minutes, mfe_pct, mae_pct }
 */
export async function recordTradeOutcome(key, tradeResult) {
  const { strategy_name, symbol, timeframe, market_regime } = key;

  // 1. Fetch current scorecard row (or create default)
  let { data: row, error: fetchErr } = await supabase
    .from('strategy_scorecard')
    .select('*')
    .eq('strategy_name', strategy_name)
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .eq('market_regime', market_regime)
    .maybeSingle();

  if (fetchErr && fetchErr.code !== 'PGRST116') {
    console.error(`[Scorecard] Fetch error for ${strategy_name}/${symbol}:`, fetchErr);
    return null;
  }

  const isWin = tradeResult.pnl_usd > 0;
  const now = new Date().toISOString();

  if (!row) {
    // First trade for this combo — insert fresh row
    const insertData = {
      strategy_name,
      symbol,
      timeframe,
      market_regime,
      total_trades: 1,
      wins: isWin ? 1 : 0,
      losses: isWin ? 0 : 1,
      win_rate: isWin ? 1 : 0,
      profit_factor: isWin ? (tradeResult.pnl_usd > 0 ? 999 : 0) : 0,
      avg_pnl_usd: tradeResult.pnl_usd,
      avg_pnl_pct: tradeResult.pnl_pct || 0,
      avg_r: tradeResult.r_multiple || 0,
      max_favorable_excursion: tradeResult.mfe_pct || 0,
      max_adverse_excursion: Math.abs(tradeResult.mae_pct || 0),
      avg_time_in_trade_minutes: tradeResult.time_in_trade_minutes || 0,
      consecutive_losses: isWin ? 0 : 1,
      consecutive_wins: isWin ? 1 : 0,
      dynamic_threshold: 0.65,
      last_trade_at: now,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from('strategy_scorecard')
      .insert(insertData)
      .select()
      .single();

    if (insertErr) {
      console.error(`[Scorecard] Insert error for ${strategy_name}/${symbol}:`, insertErr);
      return null;
    }
    return inserted;
  }

  // 2. Existing row — update rolling stats
  const newTotal = row.total_trades + 1;
  const newWins = row.wins + (isWin ? 1 : 0);
  const newLosses = row.losses + (isWin ? 0 : 1);
  const newWinRate = newTotal > 0 ? newWins / newTotal : 0;

  // Rolling profit factor: gross wins / |gross losses|
  // We approximate by tracking cumulative pnl
  const grossWins = row.avg_pnl_usd * row.wins > 0
    ? (row.avg_pnl_usd * row.wins) + (isWin ? tradeResult.pnl_usd : 0)
    : (isWin ? tradeResult.pnl_usd : 0);
  const grossLosses = row.avg_pnl_usd * row.losses < 0
    ? Math.abs(row.avg_pnl_usd * row.losses) + (isWin ? 0 : Math.abs(tradeResult.pnl_usd))
    : (isWin ? 0 : Math.abs(tradeResult.pnl_usd));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : (grossWins > 0 ? 999 : 0);

  // Rolling averages (exponential: weight new result by 1/min(newTotal, ROLLING_WINDOW))
  const weight = 1 / Math.min(newTotal, ROLLING_WINDOW);
  const newAvgPnl = row.avg_pnl_usd * (1 - weight) + tradeResult.pnl_usd * weight;
  const newAvgPnlPct = row.avg_pnl_pct * (1 - weight) + (tradeResult.pnl_pct || 0) * weight;
  const newAvgR = row.avg_r * (1 - weight) + (tradeResult.r_multiple || 0) * weight;
  const newAvgTime = row.avg_time_in_trade_minutes * (1 - weight) + (tradeResult.time_in_trade_minutes || 0) * weight;

  // MFE/MAE tracking (max over lifetime)
  const newMfe = Math.max(row.max_favorable_excursion || 0, tradeResult.mfe_pct || 0);
  const newMae = Math.max(row.max_adverse_excursion || 0, Math.abs(tradeResult.mae_pct || 0));

  // Consecutive streaks
  const newConsecutiveLosses = isWin ? 0 : (row.consecutive_losses || 0) + 1;
  const newConsecutiveWins = isWin ? (row.consecutive_wins || 0) + 1 : 0;

  // Dynamic threshold adjustment
  let newThreshold = row.dynamic_threshold || 0.65;
  if (newConsecutiveLosses >= 3) {
    newThreshold = clamp(newThreshold + 0.05, 0.60, 0.85);
  }
  if (newConsecutiveWins >= 10) {
    newThreshold = clamp(newThreshold - 0.02, 0.60, 0.85);
  }

  const updateData = {
    total_trades: newTotal,
    wins: newWins,
    losses: newLosses,
    win_rate: Math.round(newWinRate * 1000) / 1000,
    profit_factor: Math.round(profitFactor * 100) / 100,
    avg_pnl_usd: Math.round(newAvgPnl * 100) / 100,
    avg_pnl_pct: Math.round(newAvgPnlPct * 100) / 100,
    avg_r: Math.round(newAvgR * 100) / 100,
    max_favorable_excursion: Math.round(newMfe * 100) / 100,
    max_adverse_excursion: Math.round(newMae * 100) / 100,
    avg_time_in_trade_minutes: Math.round(newAvgTime),
    consecutive_losses: newConsecutiveLosses,
    consecutive_wins: newConsecutiveWins,
    dynamic_threshold: Math.round(newThreshold * 100) / 100,
    last_trade_at: now,
    updated_at: now,
  };

  // 3. Check throttle conditions
  const throttleResult = checkThrottleConditions(updateData);
  if (throttleResult.shouldThrottle) {
    updateData.is_throttled = true;
    updateData.throttle_reason = throttleResult.reason;
    updateData.throttle_until = new Date(Date.now() + THROTTLE_DURATION_HOURS * 3600000).toISOString();

    // Log throttle event
    await logLearningEvent('throttle_applied', {
      strategy_name, symbol, timeframe, market_regime,
      details: { reason: throttleResult.reason, winRate: newWinRate, profitFactor, avgR: newAvgR }
    });
  } else {
    // Check if throttle should be released
    if (row.is_throttled && row.throttle_until) {
      const throttleExpired = new Date(row.throttle_until) < new Date();
      if (throttleExpired && isWin) {
        updateData.is_throttled = false;
        updateData.throttle_reason = null;
        updateData.throttle_until = null;
        await logLearningEvent('throttle_released', {
          strategy_name, symbol, timeframe, market_regime,
          details: { reason: 'Test trade won, unthrottled' }
        });
      }
    }
  }

  const { data: updated, error: updateErr } = await supabase
    .from('strategy_scorecard')
    .update(updateData)
    .eq('strategy_name', strategy_name)
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .eq('market_regime', market_regime)
    .select()
    .single();

  if (updateErr) {
    console.error(`[Scorecard] Update error for ${strategy_name}/${symbol}:`, updateErr);
    return null;
  }

  return updated;
}

// ── Throttle Logic ──────────────────────────────────────────

function checkThrottleConditions(stats) {
  const reasons = [];

  if (stats.total_trades >= THROTTLE_MIN_TRADES) {
    if (stats.win_rate < THROTTLE_WIN_RATE) {
      reasons.push(`Win rate ${(stats.win_rate * 100).toFixed(0)}% below ${(THROTTLE_WIN_RATE * 100).toFixed(0)}% threshold`);
    }
    if (stats.profit_factor < THROTTLE_MIN_PROFIT_FACTOR) {
      reasons.push(`Profit factor ${stats.profit_factor.toFixed(2)} below ${THROTTLE_MIN_PROFIT_FACTOR.toFixed(1)}`);
    }
    if (stats.avg_r < THROTTLE_MIN_AVG_R && stats.total_trades >= 15) {
      reasons.push(`Avg R ${stats.avg_r.toFixed(2)} below 0 (negative expectancy)`);
    }
  }

  return {
    shouldThrottle: reasons.length > 0,
    reason: reasons.join('; ') || null,
  };
}

// ── Read Scorecard ──────────────────────────────────────────

/**
 * Get scorecard for a specific combo.
 */
export async function getScorecard(strategy, symbol, timeframe, regime = 'any') {
  const { data, error } = await supabase
    .from('strategy_scorecard')
    .select('*')
    .eq('strategy_name', strategy)
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .eq('market_regime', regime)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error(`[Scorecard] Get error:`, error);
  }
  return data || null;
}

/**
 * Get all scorecards for dashboard leaderboard.
 * @param {object} filters - Optional { strategy_name, symbol, timeframe, market_regime, is_throttled }
 */
export async function getAllScorecards(filters = {}) {
  let query = supabase.from('strategy_scorecard').select('*');

  if (filters.strategy_name) query = query.eq('strategy_name', filters.strategy_name);
  if (filters.symbol) query = query.eq('symbol', filters.symbol);
  if (filters.timeframe) query = query.eq('timeframe', filters.timeframe);
  if (filters.market_regime) query = query.eq('market_regime', filters.market_regime);
  if (filters.is_throttled !== undefined) query = query.eq('is_throttled', filters.is_throttled);

  query = query.order('total_trades', { ascending: false }).limit(200);

  const { data, error } = await query;
  if (error) {
    console.error(`[Scorecard] GetAll error:`, error);
    return [];
  }

  // Enrich with computed fields
  return (data || []).map(row => ({
    ...row,
    sampleSizeWarning: row.total_trades < DASHBOARD_MIN_TRADES,
    status: row.is_throttled
      ? 'throttled'
      : row.total_trades < THROTTLE_MIN_TRADES
        ? 'learning'
        : 'active',
  }));
}

// ── Throttle Check ──────────────────────────────────────────

/**
 * Check if a (strategy, symbol, timeframe, regime) combo is throttled.
 * Returns { allowed, reason, isTestTrade }.
 */
export async function isComboThrottled(strategy, symbol, timeframe, regime = 'any') {
  const scorecard = await getScorecard(strategy, symbol, timeframe, regime);
  if (!scorecard) return { allowed: true, reason: null, isTestTrade: false };

  if (!scorecard.is_throttled) return { allowed: true, reason: null, isTestTrade: false };

  const now = new Date();
  const throttleUntil = new Date(scorecard.throttle_until);

  if (throttleUntil <= now) {
    // Throttle expired — allow test trade
    return {
      allowed: true,
      reason: `Throttle expired, test trade allowed (50% size)`,
      isTestTrade: true,
    };
  }

  return {
    allowed: false,
    reason: scorecard.throttle_reason || `Throttled until ${throttleUntil.toISOString()}`,
    isTestTrade: false,
  };
}

// ── Learning Event Log ──────────────────────────────────────

async function logLearningEvent(eventType, payload) {
  try {
    await supabase.from('learning_feedback_log').insert({
      event_type: eventType,
      strategy_name: payload.strategy_name,
      symbol: payload.symbol,
      timeframe: payload.timeframe,
      market_regime: payload.market_regime,
      details: payload.details,
    });
  } catch (err) {
    console.error(`[Scorecard] Log event error:`, err);
  }
}

// ── Manual Throttle Override ────────────────────────────────

export async function setThrottle(strategy, symbol, timeframe, regime, throttled, reason) {
  const updateData = {
    is_throttled: throttled,
    throttle_reason: throttled ? (reason || 'Manual override') : null,
    throttle_until: throttled ? new Date(Date.now() + THROTTLE_DURATION_HOURS * 3600000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('strategy_scorecard')
    .update(updateData)
    .eq('strategy_name', strategy)
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .eq('market_regime', regime);

  if (error) {
    console.error(`[Scorecard] Set throttle error:`, error);
    return false;
  }
  return true;
}
