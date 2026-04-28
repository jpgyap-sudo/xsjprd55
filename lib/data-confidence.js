// ============================================================
// Data Confidence Scoring Engine
// Scores data quality per source and overall signal confidence.
// Part of API & News Crawler Skill implementation.
// ============================================================

import { logger } from './logger.js';

// Source weights and base confidence scores
const SOURCE_BASE_CONFIDENCE = {
  'binance': 0.95,
  'bybit': 0.93,
  'okx': 0.92,
  'hyperliquid': 0.90,
  'deribit': 0.88,
  'coingecko': 0.85,
  'binance_public': 0.90,
  'cryptopanic': 0.75,
  'rss': 0.65,
  'crawler': 0.60,
};

// Penalties for various issues
const PENALTIES = {
  api_error: 0.25,
  crawler_fallback: 0.15,
  stale_data: 0.20,
  single_source: 0.10,
  high_latency: 0.05,
};

// Freshness thresholds by data type (milliseconds)
const FRESHNESS_THRESHOLDS = {
  websocket: 60_000,
  funding_rate: 900_000,
  open_interest: 300_000,
  liquidation: 60_000,
  ohlcv: 300_000,
  news: 3_600_000,
  social: 1_800_000,
};

/**
 * Score a single data point from one source.
 */
export function scoreDataPoint(opts) {
  const {
    source,
    dataType,
    timestamp,
    latencyMs,
    apiError = false,
    crawlerUsed = false,
    method = 'api', // 'api' | 'crawler' | 'cache'
  } = opts;

  let score = SOURCE_BASE_CONFIDENCE[source?.toLowerCase()] || 0.70;

  // Penalty for API error + crawler fallback
  if (apiError && crawlerUsed) {
    score -= PENALTIES.api_error;
    score -= PENALTIES.crawler_fallback;
    logger.debug(`[CONFIDENCE] ${source} ${dataType}: API error + crawler fallback applied`);
  }

  // Penalty for stale data
  const threshold = FRESHNESS_THRESHOLDS[dataType] || 600_000;
  const ageMs = timestamp ? Date.now() - new Date(timestamp).getTime() : 0;
  if (ageMs > threshold) {
    const staleRatio = Math.min(ageMs / threshold, 3);
    score -= PENALTIES.stale_data * staleRatio;
    logger.debug(`[CONFIDENCE] ${source} ${dataType}: stale data penalty (${Math.round(ageMs/1000)}s)`);
  }

  // Penalty for high latency
  if (latencyMs > 3000) {
    score -= PENALTIES.high_latency;
  }

  // Crawler method penalty
  if (method === 'crawler') {
    score -= PENALTIES.crawler_fallback;
  }

  return Math.max(0.10, Math.min(1.0, score));
}

/**
 * Cross-reference multiple sources for the same data point.
 * Detects conflicts and reduces confidence when sources disagree.
 */
export function crossReference(dataPoints) {
  // dataPoints: [{ source, value, timestamp, confidence }]
  if (!dataPoints || dataPoints.length === 0) {
    return { consensusValue: null, consensusConfidence: 0, conflicts: [], warnings: ['No data points'] };
  }

  if (dataPoints.length === 1) {
    return {
      consensusValue: dataPoints[0].value,
      consensusConfidence: dataPoints[0].confidence - PENALTIES.single_source,
      conflicts: [],
      warnings: ['Only one source available'],
    };
  }

  // For numeric values, compute weighted average and detect outliers
  const numericPoints = dataPoints.filter(d => typeof d.value === 'number' && !isNaN(d.value));

  if (numericPoints.length >= 2) {
    const weights = numericPoints.map(d => d.confidence || 0.5);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const weightedAvg = numericPoints.reduce((sum, d, i) => sum + d.value * weights[i], 0) / totalWeight;

    // Detect outliers (values >20% from weighted average)
    const conflicts = [];
    const warnings = [];
    for (const d of numericPoints) {
      const deviation = Math.abs(d.value - weightedAvg) / Math.abs(weightedAvg || 1);
      if (deviation > 0.20) {
        conflicts.push({
          source: d.source,
          value: d.value,
          deviation: deviation,
          reason: `Value deviates ${(deviation * 100).toFixed(1)}% from consensus`,
        });
      }
    }

    if (conflicts.length > 0) {
      warnings.push(`Data conflict detected: ${conflicts.length} source(s) deviate significantly`);
    }

    // Reduce confidence if conflicts exist
    const conflictPenalty = conflicts.length * 0.10;
    const baseConfidence = dataPoints.reduce((sum, d) => sum + (d.confidence || 0.5), 0) / dataPoints.length;

    return {
      consensusValue: weightedAvg,
      consensusConfidence: Math.max(0.10, baseConfidence - conflictPenalty),
      conflicts,
      warnings,
    };
  }

  // For non-numeric, just check if all agree
  const values = dataPoints.map(d => d.value);
  const allSame = values.every(v => v === values[0]);
  const avgConfidence = dataPoints.reduce((sum, d) => sum + (d.confidence || 0.5), 0) / dataPoints.length;

  return {
    consensusValue: values[0],
    consensusConfidence: allSame ? avgConfidence : avgConfidence - 0.15,
    conflicts: allSame ? [] : [{ reason: 'Sources disagree on value', values }],
    warnings: allSame ? [] : ['Non-numeric data conflict detected'],
  };
}

/**
 * Build a complete data quality report for a signal.
 */
export function buildSignalDataQuality(signal, dataPoints = []) {
  const scores = dataPoints.map(dp => ({
    ...dp,
    score: scoreDataPoint(dp),
  }));

  const overallScore = scores.length
    ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
    : 0.5;

  const fallbackUsed = scores.some(s => s.method === 'crawler' || s.crawlerUsed);
  const staleSources = scores.filter(s => s.score < 0.7).map(s => s.source);

  return {
    overallScore: Math.round(overallScore * 100) / 100,
    sourceScores: scores.map(s => ({
      source: s.source,
      dataType: s.dataType,
      score: Math.round(s.score * 100) / 100,
      method: s.method,
    })),
    fallbackUsed,
    staleSources: [...new Set(staleSources)],
    confidence: overallScore,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Log data conflicts to file for audit trail.
 */
export function logDataConflict(conflict) {
  const entry = {
    ...conflict,
    loggedAt: new Date().toISOString(),
  };
  logger.warn(`[DATA-CONFLICT] ${conflict.dataType} ${conflict.symbol}: ${conflict.reason}`);
  // Note: In production, write to persistent log file or Supabase
  return entry;
}
