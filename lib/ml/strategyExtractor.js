// ============================================================
// Strategy Extractor — Assello Research Agent Extension
// Extracts structured strategy rules from text / research items.
// ============================================================

import { db } from './db.js';
import { logger } from '../logger.js';

/**
 * @typedef {Object} ExtractedRule
 * @property {string} feature
 * @property {'gt'|'lt'|'eq'|'between'} operator
 * @property {number} value
 * @property {number} [value2]
 * @property {number} weight
 */

/**
 * @typedef {Object} ExtractedStrategy
 * @property {string} name
 * @property {string} description
 * @property {ExtractedRule[]} rules
 * @property {number} confidence
 * @property {string[]} tags
 */

// --- Keyword → feature mapping ------------------------------------------------
const FEATURE_MAP = [
  { patterns: ['funding rate', 'funding', 'negative funding', 'positive funding'], feature: 'funding_rate', weight: 0.8 },
  { patterns: ['open interest', 'oi ', 'oi spike', 'oi drop'], feature: 'open_interest_change_pct', weight: 0.7 },
  { patterns: ['liquidation', 'liq', 'short squeeze', 'long squeeze', 'cascading liq'], feature: 'liquidation_imbalance', weight: 0.9 },
  { patterns: ['sentiment', 'bullish', 'bearish', 'greed', 'fear'], feature: 'social_sentiment', weight: 0.6 },
  { patterns: ['volume', 'volume spike', 'low volume', 'high volume'], feature: 'volume_change_pct', weight: 0.6 },
  { patterns: ['volatility', 'iv crush', 'iv spike', 'vol crush'], feature: 'volatility_pct', weight: 0.5 },
  { patterns: ['whale', 'wallet', 'inflow', 'outflow', 'exchange flow'], feature: 'whale_flow_score', weight: 0.7 },
  { patterns: ['ema', 'cross', 'golden cross', 'death cross', '50 ema', '200 ema'], feature: 'ema_cross_score', weight: 0.75 },
  { patterns: ['rsi', 'oversold', 'overbought', 'rsi divergence'], feature: 'rsi_divergence', weight: 0.7 },
  { patterns: ['support', 'resistance', 'breakout', 'break down', 'channel'], feature: 'support_resistance_score', weight: 0.65 },
  { patterns: ['macro', 'etf', 'regulation', 'sec', 'fed', 'rate cut', 'rate hike'], feature: 'macro_score', weight: 0.55 },
  { patterns: ['btc dominance', 'altseason', 'alt season', 'dominance'], feature: 'btc_dominance_score', weight: 0.5 },
  { patterns: ['order book', 'bid wall', 'ask wall', 'depth'], feature: 'order_book_depth', weight: 0.6 },
];

// --- Side inference keywords --------------------------------------------------
const LONG_SIGNALS = ['long', 'buy', 'bullish', 'breakout', 'oversold', 'support', 'bounce', 'accumulation', 'uptrend'];
const SHORT_SIGNALS = ['short', 'sell', 'bearish', 'break down', 'overbought', 'resistance', 'rejection', 'distribution', 'downtrend'];

/**
 * Extract numeric thresholds from text near a keyword.
 * @param {string} text
 * @param {string} keyword
 * @returns {{value:number|null, operator:'gt'|'lt'|'eq'}}
 */
function extractThreshold(text, keyword) {
  const idx = text.toLowerCase().indexOf(keyword);
  if (idx === -1) return { value: null, operator: 'gt' };
  const window = text.slice(Math.max(0, idx - 40), idx + 40);
  // Look for patterns like "above 0.5", "below -0.01", "> 2%", "< -5"
  const match = window.match(/(?:above|>|greater than|over)\s+(-?\d+\.?\d*)\s*%?/i);
  if (match) return { value: parseFloat(match[1]), operator: 'gt' };
  const match2 = window.match(/(?:below|<|less than|under)\s+(-?\d+\.?\d*)\s*%?/i);
  if (match2) return { value: parseFloat(match2[1]), operator: 'lt' };
  const match3 = window.match(/(-?\d+\.?\d*)\s*%?\s*(?:or higher|or more)/i);
  if (match3) return { value: parseFloat(match3[1]), operator: 'gt' };
  const match4 = window.match(/(-?\d+\.?\d*)\s*%?\s*(?:or lower|or less)/i);
  if (match4) return { value: parseFloat(match4[1]), operator: 'lt' };
  return { value: null, operator: 'gt' };
}

/**
 * Infer side direction from text.
 * @param {string} text
 * @returns {'LONG'|'SHORT'|'BOTH'|null}
 */
function inferSide(text) {
  const lower = text.toLowerCase();
  const longCount = LONG_SIGNALS.filter((kw) => lower.includes(kw)).length;
  const shortCount = SHORT_SIGNALS.filter((kw) => lower.includes(kw)).length;
  if (longCount > shortCount + 1) return 'LONG';
  if (shortCount > longCount + 1) return 'SHORT';
  if (longCount > 0 && shortCount > 0) return 'BOTH';
  return null;
}

/**
 * Extract strategies from a research content string.
 * @param {string} content
 * @returns {ExtractedStrategy[]}
 */
export function extractStrategiesFromText(content) {
  const lower = content.toLowerCase();
  const strategies = [];
  const tags = [];

  for (const mapping of FEATURE_MAP) {
    for (const pattern of mapping.patterns) {
      if (lower.includes(pattern.toLowerCase())) {
        tags.push(mapping.feature);
        const { value, operator } = extractThreshold(content, pattern);
        strategies.push({
          name: `extracted_${mapping.feature}`,
          description: `Extracted rule for ${mapping.feature} from research text.`,
          rules: [{
            feature: mapping.feature,
            operator,
            value: value ?? getDefaultThreshold(mapping.feature),
            weight: mapping.weight,
          }],
          confidence: Math.min(mapping.weight + 0.1, 0.95),
          tags: [mapping.feature],
        });
        break;
      }
    }
  }

  // If we have multiple rules, merge them into a composite strategy
  if (strategies.length >= 2) {
    const side = inferSide(content);
    const allRules = strategies.flatMap((s) => s.rules);
    strategies.push({
      name: `composite_${Date.now().toString(36)}`,
      description: `Composite strategy extracted from research. Inferred side: ${side || 'unknown'}.`,
      rules: allRules,
      confidence: Math.min(strategies.reduce((sum, s) => sum + s.confidence, 0) / strategies.length + 0.05, 0.95),
      tags: [...new Set(tags)],
    });
  }

  return strategies;
}

/**
 * Default threshold when extraction fails.
 * @param {string} feature
 * @returns {number}
 */
function getDefaultThreshold(feature) {
  const defaults = {
    funding_rate: -0.005,
    open_interest_change_pct: 2,
    liquidation_imbalance: 0.2,
    social_sentiment: 0.3,
    volume_change_pct: 50,
    volatility_pct: 2,
    whale_flow_score: 0.3,
    ema_cross_score: 0.5,
    rsi_divergence: 0.5,
    support_resistance_score: 0.5,
    macro_score: 0.5,
    btc_dominance_score: 0.5,
    order_book_depth: 0.5,
  };
  return defaults[feature] ?? 0.5;
}

/**
 * Run extraction on all unused research sources and save proposals.
 * @returns {{extracted:number, saved:number}}
 */
export function extractAndSaveFromResearch() {
  const rows = db.prepare(`
    SELECT id, content FROM research_sources WHERE used = 0 ORDER BY created_at DESC LIMIT 50
  `).all();

  let extracted = 0;
  let saved = 0;
  const markUsed = db.prepare(`UPDATE research_sources SET used = 1 WHERE id = ?`);
  const insert = db.prepare(`
    INSERT INTO strategy_proposals (created_at, name, description, rules_json, confidence, tested, promoted, rejected)
    VALUES (datetime('now'), ?, ?, ?, ?, 0, 0, 0)
  `);

  for (const row of rows) {
    const strategies = extractStrategiesFromText(row.content);
    extracted += strategies.length;
    for (const s of strategies) {
      try {
        insert.run(s.name, s.description, JSON.stringify(s.rules), s.confidence);
        saved++;
      } catch (e) {
        logger.warn(`[STRATEGY-EXTRACTOR] Save failed: ${e.message}`);
      }
    }
    markUsed.run(row.id);
  }

  logger.info(`[STRATEGY-EXTRACTOR] Extracted ${extracted} strategies, saved ${saved} proposals`);
  return { extracted, saved };
}
