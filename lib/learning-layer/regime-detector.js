// ============================================================
// Regime Detector — Identifies current market regime
// Uses recent signal outcomes + market data to classify the
// market into: trending, ranging, volatile, quiet
//
// Each regime has different optimal strategy profiles.
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';
import { getRecentOutcomes } from './outcome-recorder.js';

/**
 * Fetch recent market volatility data from brain_signal_memory.
 */
async function getMarketVolatility(hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('brain_signal_memory')
    .select('entry_price, generated_at, symbol')
    .gte('generated_at', since)
    .order('generated_at', { ascending: true })
    .limit(200);

  if (error || !data?.length) return { avgVolatility: 0.5, sampleCount: 0 };

  // Calculate price volatility from consecutive entries
  let totalVol = 0;
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const prev = Number(data[i - 1].entry_price || 0);
    const curr = Number(data[i].entry_price || 0);
    if (prev > 0 && curr > 0) {
      const change = Math.abs(curr - prev) / prev;
      totalVol += change;
      count++;
    }
  }

  const avgVolatility = count > 0 ? totalVol / count : 0.5;
  return { avgVolatility, sampleCount: count };
}

/**
 * Fetch recent win rate to gauge market "cooperativeness".
 */
async function getRecentWinRate(hours = 24) {
  const outcomes = await getRecentOutcomes(hours);
  if (!outcomes.length) return 0.5;

  const wins = outcomes.filter((s) => Number(s.resolved_pnl || 0) > 0).length;
  return wins / outcomes.length;
}

/**
 * Detect the current market regime.
 * @returns {Promise<Object>} { regime, volatility, winRate, description }
 */
export async function detectMarketRegime() {
  const vol = await getMarketVolatility(24);
  const winRate = await getRecentWinRate(24);

  let regime = 'unknown';
  let description = '';
  let score = 0;

  // Classify based on volatility and win rate
  const isVolatile = vol.avgVolatility > 0.015; // >1.5% avg move
  const isQuiet = vol.avgVolatility < 0.005; // <0.5% avg move
  const isHighWin = winRate > 0.55;
  const isLowWin = winRate < 0.4;

  if (isVolatile && isHighWin) {
    regime = 'trending';
    description = 'Strong directional moves, strategies following trend are winning';
    score = 0.8;
  } else if (isVolatile && isLowWin) {
    regime = 'choppy';
    description = 'High volatility but low win rate — market is whipsawing';
    score = 0.3;
  } else if (!isVolatile && !isQuiet && isHighWin) {
    regime = 'ranging';
    description = 'Mean-reversion strategies likely working best';
    score = 0.6;
  } else if (isQuiet) {
    regime = 'quiet';
    description = 'Low volatility — scalping or waiting for breakout';
    score = 0.4;
  } else {
    regime = 'mixed';
    description = 'No clear regime signal — use diversified approach';
    score = 0.5;
  }

  const result = {
    regime,
    volatility: Number(vol.avgVolatility.toFixed(6)),
    winRate: Number(winRate.toFixed(4)),
    score,
    description,
    detected_at: new Date().toISOString(),
    samples: vol.sampleCount,
  };

  // Save to database
  try {
    await supabase.from('tll_regime_log').insert(result);
  } catch (e) {
    logger.error('[regime-detector] Save error:', e.message);
  }

  return result;
}
