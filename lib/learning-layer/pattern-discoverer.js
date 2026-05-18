// ============================================================
// Pattern Discoverer — Clusters winning/losing conditions
// Analyzes resolved signal outcomes to find recurring patterns
// in market context that predict success or failure.
//
// Inspired by SuperRoo's neural coding signal extraction.
// v2: Uses Ollama for compound/higher-order pattern discovery
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { getRecentOutcomes } from './outcome-recorder.js';

const MIN_PATTERN_SAMPLES = 5;
const MIN_WIN_RATE_FOR_PATTERN = 0.65;

/**
 * Analyze a set of outcomes to find feature-based patterns.
 * Groups by feature ranges and calculates win rates.
 */
function analyzeFeaturePatterns(outcomes) {
  const patterns = [];

  // Feature extractors: each returns a bucketed value from a signal
  const features = [
    {
      name: 'rsi_range',
      extract: (s) => {
        const rsi = s.score?.breakdown?.rsi ?? s.metadata?.market_rsi_14;
        if (rsi == null) return null;
        if (rsi < 30) return 'oversold';
        if (rsi > 70) return 'overbought';
        if (rsi < 45) return 'low';
        if (rsi > 55) return 'high';
        return 'neutral';
      },
    },
    {
      name: 'timeframe',
      extract: (s) => s.timeframe || 'unknown',
    },
    {
      name: 'side',
      extract: (s) => s.side || 'UNKNOWN',
    },
    {
      name: 'volatility_regime',
      extract: (s) => {
        const vol = s.metadata?.market_vol_spike;
        if (vol == null) return null;
        return vol > 1.5 ? 'high_vol' : vol > 0.8 ? 'normal' : 'low_vol';
      },
    },
    {
      name: 'news_sentiment',
      extract: (s) => {
        const ns = s.metadata?.news_sentiment_score ?? s.context_summary?.news_sentiment;
        if (ns == null) return null;
        if (ns > 0.3) return 'bullish';
        if (ns < -0.3) return 'bearish';
        return 'neutral';
      },
    },
    {
      name: 'liquidation_bias',
      extract: (s) => {
        const bias = s.metadata?.liq_bias ?? s.context_summary?.liquidation_bias;
        if (bias == null) return null;
        if (bias > 0.2) return 'long_heavy';
        if (bias < -0.2) return 'short_heavy';
        return 'balanced';
      },
    },
    {
      name: 'confidence_tier',
      extract: (s) => {
        const c = s.confidence ?? 0;
        if (c >= 0.8) return 'high';
        if (c >= 0.6) return 'medium';
        return 'low';
      },
    },
    {
      name: 'hour_of_day',
      extract: (s) => {
        const d = new Date(s.generated_at);
        const h = d.getUTCHours();
        if (h >= 0 && h < 6) return 'asia_sleep';
        if (h >= 6 && h < 12) return 'asia_open';
        if (h >= 12 && h < 18) return 'london_open';
        return 'us_open';
      },
    },
  ];

  for (const feature of features) {
    const buckets = {};

    for (const s of outcomes) {
      const value = feature.extract(s);
      if (value == null) continue;

      if (!buckets[value]) {
        buckets[value] = { wins: 0, losses: 0, total: 0, totalPnl: 0 };
      }
      const pnl = Number(s.resolved_pnl || 0);
      buckets[value].total++;
      buckets[value].totalPnl += pnl;
      if (pnl > 0) buckets[value].wins++;
      else if (pnl < 0) buckets[value].losses++;
    }

    for (const [value, stats] of Object.entries(buckets)) {
      if (stats.total < MIN_PATTERN_SAMPLES) continue;
      const winRate = stats.wins / stats.total;
      const avgPnl = stats.totalPnl / stats.total;

      if (winRate >= MIN_WIN_RATE_FOR_PATTERN || winRate <= 1 - MIN_WIN_RATE_FOR_PATTERN) {
        patterns.push({
          feature: feature.name,
          value,
          samples: stats.total,
          wins: stats.wins,
          losses: stats.losses,
          win_rate: Number(winRate.toFixed(4)),
          avg_pnl: Number(avgPnl.toFixed(6)),
          signal: winRate >= MIN_WIN_RATE_FOR_PATTERN ? 'favorable' : 'unfavorable',
          confidence: Math.min(stats.total / 50, 1),
        });
      }
    }
  }

  return patterns;
}

/**
 * Discover compound patterns (2-feature combinations).
 */
function analyzeCompoundPatterns(outcomes) {
  const patterns = [];

  // Group by (side, timeframe) pairs
  const groups = {};
  for (const s of outcomes) {
    const key = `${s.side}|${s.timeframe}`;
    if (!groups[key]) groups[key] = { wins: 0, losses: 0, total: 0, totalPnl: 0 };
    const pnl = Number(s.resolved_pnl || 0);
    groups[key].total++;
    groups[key].totalPnl += pnl;
    if (pnl > 0) groups[key].wins++;
    else if (pnl < 0) groups[key].losses++;
  }

  for (const [key, stats] of Object.entries(groups)) {
    if (stats.total < MIN_PATTERN_SAMPLES) continue;
    const [side, timeframe] = key.split('|');
    const winRate = stats.wins / stats.total;

    if (winRate >= MIN_WIN_RATE_FOR_PATTERN || winRate <= 1 - MIN_WIN_RATE_FOR_PATTERN) {
      patterns.push({
        feature: 'side_timeframe',
        value: `${side}_${timeframe}`,
        samples: stats.total,
        wins: stats.wins,
        losses: stats.losses,
        win_rate: Number(winRate.toFixed(4)),
        avg_pnl: Number((stats.totalPnl / stats.total).toFixed(6)),
        signal: winRate >= MIN_WIN_RATE_FOR_PATTERN ? 'favorable' : 'unfavorable',
        confidence: Math.min(stats.total / 50, 1),
        compound: true,
      });
    }
  }

  return patterns;
}

/**
 * Ollama-powered higher-order pattern discovery.
 * Uses local LLM to find non-obvious relationships in outcome data
 * that statistical methods might miss.
 */
async function analyzeWithOllama(outcomes) {
  const baseUrl = config.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = config.OLLAMA_MODEL || 'phi3:mini';

  // Sample outcomes for Ollama (limit to avoid token overflow)
  const sample = outcomes.slice(0, 30).map(s => ({
    symbol: s.symbol,
    side: s.side,
    timeframe: s.timeframe,
    strategy: s.strategy,
    confidence: s.confidence,
    pnl: s.resolved_pnl,
    rsi: s.score?.breakdown?.rsi ?? s.metadata?.market_rsi_14,
    volatility: s.metadata?.market_vol_spike,
    newsSentiment: s.metadata?.news_sentiment_score,
    hour: s.generated_at ? new Date(s.generated_at).getUTCHours() : null
  }));

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a pattern discovery AI for trading data. Analyze the given outcomes and find NON-OBVIOUS patterns that simple statistics might miss. Return ONLY a JSON array:
[
  {
    "feature": "<descriptive name like 'rsi_volatility_combo'>",
    "value": "<bucket value>",
    "description": "<what the pattern is>",
    "win_rate": <0-1>,
    "samples": <count>,
    "signal": "favorable" | "unfavorable"
  }
]
Focus on 2-3 feature combinations and temporal patterns. Max 5 patterns. Do NOT include any other text.`
          },
          {
            role: 'user',
            content: JSON.stringify(sample)
          }
        ],
        options: { temperature: 0.1, max_tokens: 512 }
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = await response.json();
    const content = data.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in response');

    const patterns = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(patterns)) throw new Error('Response is not an array');

    return patterns
      .filter(p => p.samples >= MIN_PATTERN_SAMPLES && p.win_rate != null)
      .map(p => ({
        feature: `ollama_${p.feature}`,
        value: String(p.value || 'unknown'),
        samples: p.samples,
        wins: Math.round(p.samples * p.win_rate),
        losses: Math.round(p.samples * (1 - p.win_rate)),
        win_rate: Number(Number(p.win_rate).toFixed(4)),
        avg_pnl: 0,
        signal: p.win_rate >= MIN_WIN_RATE_FOR_PATTERN ? 'favorable' : 'unfavorable',
        confidence: Math.min(p.samples / 50, 0.8),
        compound: true,
        source: 'ollama_discovery'
      }));
  } catch (err) {
    logger.debug(`[pattern-discoverer] Ollama analysis unavailable: ${err.message}`);
    return [];
  }
}

/**
 * Run pattern discovery on recent resolved outcomes.
 * Saves discovered patterns to tll_patterns table.
 * Uses Ollama for higher-order pattern discovery when available.
 * @returns {Promise<Array>} Discovered patterns
 */
export async function discoverPatterns() {
  const outcomes = await getRecentOutcomes(48);

  if (!outcomes.length) {
    logger.info('[pattern-discoverer] No outcomes to analyze');
    return [];
  }

  logger.info(`[pattern-discoverer] Analyzing ${outcomes.length} outcomes`);

  const simplePatterns = analyzeFeaturePatterns(outcomes);
  const compoundPatterns = analyzeCompoundPatterns(outcomes);
  let allPatterns = [...simplePatterns, ...compoundPatterns];

  // Try Ollama for higher-order patterns
  try {
    const ollamaPatterns = await analyzeWithOllama(outcomes);
    if (ollamaPatterns.length > 0) {
      logger.info(`[pattern-discoverer] Ollama discovered ${ollamaPatterns.length} higher-order patterns`);
      allPatterns = [...allPatterns, ...ollamaPatterns];
    }
  } catch (e) {
    logger.debug(`[pattern-discoverer] Ollama pattern discovery skipped: ${e.message}`);
  }

  // Save patterns to database
  let saved = 0;
  for (const pattern of allPatterns) {
    try {
      const { error } = await supabase.from('tll_patterns').upsert(
        {
          feature: pattern.feature,
          value: pattern.value,
          samples: pattern.samples,
          wins: pattern.wins,
          losses: pattern.losses,
          win_rate: pattern.win_rate,
          avg_pnl: pattern.avg_pnl,
          signal: pattern.signal,
          confidence: pattern.confidence,
          compound: pattern.compound || false,
          discovered_at: new Date().toISOString(),
        },
        {
          onConflict: 'feature,value',
          ignoreDuplicates: false,
        }
      );
      if (!error) saved++;
    } catch (e) {
      logger.error(`[pattern-discoverer] Save error: ${e.message}`);
    }
  }

  logger.info(`[pattern-discoverer] Saved ${saved}/${allPatterns.length} patterns (${allPatterns.filter(p => p.source === 'ollama_discovery').length} from Ollama)`);
  return allPatterns;
}
