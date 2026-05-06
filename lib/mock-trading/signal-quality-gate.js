// ============================================================
// Signal Quality Gate — Multi-Factor Signal Validation
// Rejects low-quality signals before they reach execution.
// All checks must pass for a signal to be approved.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { isComboThrottled } from './strategy-scorecard.js';
import { getDynamicThreshold } from './dynamic-confidence.js';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

const MIN_CONFIDENCE = parseFloat(process.env.SIGNAL_QUALITY_MIN_CONFIDENCE) || 0.65;
const MIN_RR = parseFloat(process.env.SIGNAL_QUALITY_MIN_RR) || 1.5;
const MAX_SIGNAL_AGE_MINUTES = parseInt(process.env.SIGNAL_QUALITY_MAX_AGE) || 5;
const MAX_CONCURRENT_TRADES = parseInt(process.env.MAX_CONCURRENT_TRADES) || 10;
const GATE_PAPER_MODE = process.env.GATE_PAPER_MODE || 'warn'; // 'warn' | 'block'

// ── Main Gate ───────────────────────────────────────────────

/**
 * Evaluate a signal against all quality gates.
 * @param {object} signal - Signal object { symbol, side, entry_price, stop_loss, take_profit, confidence, strategy, timeframe, generated_at, metadata }
 * @param {object} context - { openTrades[], recentVolume, mode: 'paper'|'live' }
 * @returns {object} { passed: boolean, reason?: string, score: number, warnings?: string[] }
 */
export async function evaluateSignalQuality(signal, context = {}) {
  const mode = context.mode || config.TRADING_MODE || 'paper';
  const warnings = [];
  const failures = [];

  // ── 1. Confidence Check ─────────────────────────────────
  const confidenceResult = await checkConfidence(signal, context);
  if (!confidenceResult.passed) {
    failures.push(confidenceResult.reason);
  } else if (confidenceResult.warning) {
    warnings.push(confidenceResult.warning);
  }

  // ── 2. Risk/Reward Check ────────────────────────────────
  const rrResult = checkRiskReward(signal);
  if (!rrResult.passed) {
    failures.push(rrResult.reason);
  } else if (rrResult.warning) {
    warnings.push(rrResult.warning);
  }

  // ── 3. Signal Age Check ─────────────────────────────────
  const ageResult = checkSignalAge(signal);
  if (!ageResult.passed) {
    failures.push(ageResult.reason);
  }

  // ── 4. Volume Check ─────────────────────────────────────
  const volumeResult = checkVolume(signal, context);
  if (!volumeResult.passed) {
    failures.push(volumeResult.reason);
  } else if (volumeResult.warning) {
    warnings.push(volumeResult.warning);
  }

  // ── 5. Duplicate Position Check ─────────────────────────
  const dupResult = await checkDuplicatePosition(signal, context);
  if (!dupResult.passed) {
    failures.push(dupResult.reason);
  }

  // ── 6. Max Concurrent Trades ────────────────────────────
  const concurrentResult = checkConcurrentTrades(context);
  if (!concurrentResult.passed) {
    failures.push(concurrentResult.reason);
  }

  // ── 7. Strategy Throttle Check ──────────────────────────
  const throttleResult = await isComboThrottled(
    signal.strategy || 'unknown',
    signal.symbol,
    signal.timeframe || '15m',
    context.marketRegime || 'any'
  );
  if (!throttleResult.allowed) {
    failures.push(`Strategy throttled: ${throttleResult.reason}`);
  }
  if (throttleResult.isTestTrade) {
    warnings.push(`Test trade mode: ${throttleResult.reason}`);
  }

  // ── Result ──────────────────────────────────────────────
  const score = computeQualityScore(signal, failures.length);

  if (failures.length > 0) {
    if (mode === 'paper' && GATE_PAPER_MODE === 'warn') {
      // Paper mode: warn but allow (for learning)
      return {
        passed: true,
        reason: null,
        score,
        warnings: [...warnings, ...failures.map(f => `[GATE_WARN] ${f}`)],
        gateResults: { confidence: confidenceResult, rr: rrResult, age: ageResult, volume: volumeResult, duplicate: dupResult, concurrent: concurrentResult, throttle: throttleResult },
      };
    }
    return {
      passed: false,
      reason: failures.join('; '),
      score,
      warnings,
      gateResults: { confidence: confidenceResult, rr: rrResult, age: ageResult, volume: volumeResult, duplicate: dupResult, concurrent: concurrentResult, throttle: throttleResult },
    };
  }

  return {
    passed: true,
    reason: null,
    score,
    warnings,
    gateResults: { confidence: confidenceResult, rr: rrResult, age: ageResult, volume: volumeResult, duplicate: dupResult, concurrent: concurrentResult, throttle: throttleResult },
  };
}

// ── Individual Checks ───────────────────────────────────────

async function checkConfidence(signal, context) {
  const baseThreshold = MIN_CONFIDENCE;

  // Get dynamic threshold if available
  let effectiveThreshold = baseThreshold;
  try {
    const dynamic = await getDynamicThreshold(
      signal.strategy || 'unknown',
      signal.symbol,
      signal.timeframe || '15m',
      context.marketRegime
    );
    effectiveThreshold = dynamic.threshold;
  } catch {
    // Fall back to base threshold
  }

  const confidence = signal.confidence || signal.probability || 0;
  if (confidence < effectiveThreshold) {
    return {
      passed: false,
      reason: `Confidence ${(confidence * 100).toFixed(0)}% below threshold ${(effectiveThreshold * 100).toFixed(0)}%`,
    };
  }

  if (confidence < effectiveThreshold + 0.05) {
    return {
      passed: true,
      warning: `Confidence ${(confidence * 100).toFixed(0)}% is marginal (threshold: ${(effectiveThreshold * 100).toFixed(0)}%)`,
    };
  }

  return { passed: true };
}

function checkRiskReward(signal) {
  const entry = parseFloat(signal.entry_price);
  const stopLoss = parseFloat(signal.stop_loss);
  const takeProfit = parseFloat(signal.take_profit);

  if (!entry || !stopLoss || !takeProfit) {
    return { passed: false, reason: 'Missing entry, SL, or TP price' };
  }

  const isLong = signal.side === 'LONG' || signal.side === 'BUY';
  let risk, reward;

  if (isLong) {
    risk = Math.abs(entry - stopLoss) / entry;
    reward = Math.abs(takeProfit - entry) / entry;
  } else {
    risk = Math.abs(stopLoss - entry) / entry;
    reward = Math.abs(entry - takeProfit) / entry;
  }

  if (risk === 0) {
    return { passed: false, reason: 'Zero risk (SL equals entry)' };
  }

  const rr = reward / risk;

  if (rr < MIN_RR) {
    return {
      passed: false,
      reason: `R/R ${rr.toFixed(2)} below minimum ${MIN_RR.toFixed(2)}`,
    };
  }

  if (rr < MIN_RR * 1.2) {
    return {
      passed: true,
      warning: `R/R ${rr.toFixed(2)} is marginal (minimum: ${MIN_RR.toFixed(2)})`,
    };
  }

  return { passed: true };
}

function checkSignalAge(signal) {
  if (!signal.generated_at) return { passed: true }; // No timestamp, skip check

  const generatedAt = new Date(signal.generated_at).getTime();
  const now = Date.now();
  const ageMinutes = (now - generatedAt) / 60000;

  // For intraday timeframes (15m, 1h), enforce strict age limit
  const timeframe = signal.timeframe || '15m';
  const isIntraday = ['15m', '30m', '1h', '2h', '4h'].includes(timeframe);

  if (isIntraday && ageMinutes > MAX_SIGNAL_AGE_MINUTES) {
    return {
      passed: false,
      reason: `Signal age ${Math.round(ageMinutes)}m exceeds max ${MAX_SIGNAL_AGE_MINUTES}m for ${timeframe} timeframe`,
    };
  }

  if (ageMinutes > MAX_SIGNAL_AGE_MINUTES * 2) {
    return {
      passed: false,
      reason: `Signal age ${Math.round(ageMinutes)}m exceeds ${MAX_SIGNAL_AGE_MINUTES * 2}m limit`,
    };
  }

  return { passed: true };
}

function checkVolume(signal, context) {
  const volumeChange = signal.metadata?.volume_change_pct
    || signal.volume_change_pct
    || context.recentVolume?.changePct;

  if (volumeChange === undefined || volumeChange === null) {
    return { passed: true }; // No volume data, skip check
  }

  if (volumeChange < -50) {
    return {
      passed: false,
      reason: `Volume ${volumeChange.toFixed(0)}% below average (threshold: -50%)`,
    };
  }

  if (volumeChange < -30) {
    return {
      passed: true,
      warning: `Volume ${volumeChange.toFixed(0)}% below average — low liquidity risk`,
    };
  }

  return { passed: true };
}

async function checkDuplicatePosition(signal, context) {
  const openTrades = context.openTrades || [];

  const existing = openTrades.find(t =>
    t.symbol === signal.symbol
  );

  if (existing) {
    return {
      passed: false,
      reason: `Duplicate position: ${signal.symbol} already has an open trade (${existing.side}, ID: ${existing.id})`,
    };
  }

  return { passed: true };
}

function checkConcurrentTrades(context) {
  const openTrades = context.openTrades || [];

  if (openTrades.length >= MAX_CONCURRENT_TRADES) {
    return {
      passed: false,
      reason: `Max concurrent trades reached (${openTrades.length}/${MAX_CONCURRENT_TRADES})`,
    };
  }

  if (openTrades.length >= MAX_CONCURRENT_TRADES * 0.8) {
    return {
      passed: true,
      warning: `Approaching max concurrent trades (${openTrades.length}/${MAX_CONCURRENT_TRADES})`,
    };
  }

  return { passed: true };
}

// ── Quality Score ───────────────────────────────────────────

function computeQualityScore(signal, failureCount) {
  let score = 1.0;

  // Deduct for each failure
  score -= failureCount * 0.15;

  // Bonus for high confidence
  const confidence = signal.confidence || signal.probability || 0;
  if (confidence >= 0.80) score += 0.10;
  if (confidence >= 0.90) score += 0.10;

  // Bonus for good R/R
  const entry = parseFloat(signal.entry_price);
  const stopLoss = parseFloat(signal.stop_loss);
  const takeProfit = parseFloat(signal.take_profit);
  if (entry && stopLoss && takeProfit) {
    const isLong = signal.side === 'LONG' || signal.side === 'BUY';
    const risk = Math.abs(entry - stopLoss) / entry;
    const reward = Math.abs(takeProfit - entry) / entry;
    const rr = risk > 0 ? reward / risk : 0;
    if (rr >= 2.5) score += 0.10;
    if (rr >= 3.0) score += 0.05;
  }

  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

// ── Batch Gate ──────────────────────────────────────────────

/**
 * Evaluate multiple signals and return only those that pass.
 */
export async function filterSignals(signals, context = {}) {
  const results = [];

  for (const signal of signals) {
    const evaluation = await evaluateSignalQuality(signal, context);
    results.push({
      signal,
      evaluation,
    });
  }

  return {
    passed: results.filter(r => r.evaluation.passed),
    rejected: results.filter(r => !r.evaluation.passed),
    all: results,
  };
}
