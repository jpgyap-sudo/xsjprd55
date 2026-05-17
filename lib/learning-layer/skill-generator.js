// ============================================================
// Skill Generator — Generates reusable "trading skills" from
// discovered patterns, similar to how SuperRoo generates
// skills from neural coding signals.
//
// A "trading skill" is a reusable rule like:
//   "When RSI < 30 on BTCUSDT 15m, LONG has 72% win rate"
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';

const MIN_SKILL_CONFIDENCE = 0.6;
const MAX_SKILLS_PER_CYCLE = 20;

/**
 * Generate a human-readable skill description from a pattern.
 */
function describeSkill(pattern) {
  const signalLabel = pattern.signal === 'favorable' ? 'profitable' : 'unprofitable';
  const direction = pattern.signal === 'favorable' ? 'take' : 'avoid';

  if (pattern.feature === 'rsi_range') {
    return `When RSI is ${pattern.value}, ${direction} trades — ${(pattern.win_rate * 100).toFixed(0)}% win rate over ${pattern.samples} samples`;
  }
  if (pattern.feature === 'side_timeframe') {
    const [side, tf] = pattern.value.split('_');
    return `${side} trades on ${tf} timeframe are ${signalLabel} — ${(pattern.win_rate * 100).toFixed(0)}% win rate`;
  }
  if (pattern.feature === 'volatility_regime') {
    return `During ${pattern.value.replace('_', ' ')} conditions, ${direction} signals — ${(pattern.win_rate * 100).toFixed(0)}% win rate`;
  }
  if (pattern.feature === 'news_sentiment') {
    return `When news sentiment is ${pattern.value}, ${direction} positions — ${(pattern.win_rate * 100).toFixed(0)}% accuracy`;
  }
  if (pattern.feature === 'hour_of_day') {
    return `During ${pattern.value.replace('_', ' ')}, ${direction} entries — ${(pattern.win_rate * 100).toFixed(0)}% win rate`;
  }
  if (pattern.feature === 'liquidation_bias') {
    return `When liquidation bias is ${pattern.value.replace('_', ' ')}, ${direction} the opposite side — ${(pattern.win_rate * 100).toFixed(0)}% win rate`;
  }
  if (pattern.feature === 'confidence_tier') {
    return `${pattern.value} confidence signals are ${signalLabel} — ${(pattern.win_rate * 100).toFixed(0)}% accuracy`;
  }

  return `${pattern.feature}=${pattern.value}: ${(pattern.win_rate * 100).toFixed(0)}% win rate — ${direction}`;
}

/**
 * Generate trading skills from discovered patterns.
 * @returns {Promise<Array>} Generated skills
 */
export async function generateTradingSkills() {
  // Fetch high-confidence patterns from the last 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: patterns, error } = await supabase
    .from('tll_patterns')
    .select('*')
    .gte('discovered_at', since)
    .gte('confidence', MIN_SKILL_CONFIDENCE)
    .order('win_rate', { ascending: false })
    .limit(MAX_SKILLS_PER_CYCLE * 2);

  if (error) {
    logger.error('[skill-generator] Fetch patterns error:', error.message);
    return [];
  }

  if (!patterns?.length) {
    logger.info('[skill-generator] No high-confidence patterns to generate skills from');
    return [];
  }

  const skills = [];
  const seenSignatures = new Set();

  for (const pattern of patterns) {
    // Deduplicate by feature+value
    const sig = `${pattern.feature}|${pattern.value}`;
    if (seenSignatures.has(sig)) continue;
    seenSignatures.add(sig);

    const description = describeSkill(pattern);

    const skill = {
      name: `skill_${pattern.feature}_${pattern.value.replace(/[^a-z0-9]/g, '_')}`,
      description,
      pattern_feature: pattern.feature,
      pattern_value: pattern.value,
      win_rate: pattern.win_rate,
      avg_pnl: pattern.avg_pnl,
      confidence: pattern.confidence,
      samples: pattern.samples,
      signal: pattern.signal,
      compound: pattern.compound || false,
      generated_at: new Date().toISOString(),
      active: true,
      metadata: {
        source_pattern_id: pattern.id,
        derived_from: 'tll_pattern_discovery',
      },
    };

    skills.push(skill);
  }

  // Save skills to database
  let saved = 0;
  for (const skill of skills) {
    try {
      const { error: insertErr } = await supabase.from('tll_skills').upsert(
        {
          name: skill.name,
          description: skill.description,
          pattern_feature: skill.pattern_feature,
          pattern_value: skill.pattern_value,
          win_rate: skill.win_rate,
          avg_pnl: skill.avg_pnl,
          confidence: skill.confidence,
          samples: skill.samples,
          signal: skill.signal,
          compound: skill.compound,
          generated_at: skill.generated_at,
          active: skill.active,
          metadata: skill.metadata,
        },
        {
          onConflict: 'name',
          ignoreDuplicates: false,
        }
      );
      if (!insertErr) saved++;
    } catch (e) {
      logger.error(`[skill-generator] Save skill error: ${e.message}`);
    }
  }

  logger.info(`[skill-generator] Generated ${saved}/${skills.length} trading skills`);
  return skills;
}
