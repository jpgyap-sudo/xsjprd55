// ============================================================
// Strategy Extractor — xsjprd55 ML Loop
// Parses research text into structured strategy proposals.
// v2: Added duplicate detection via rules hashing and source credibility.
// ============================================================

import { db } from './db.js';
import { saveStrategyProposal, markResearchSourceUsed } from './supabase-db.js';
import { logger } from '../logger.js';
import { checkDuplicate, hashProposal, saveProposalHash } from './duplicateDetector.js';
import { getSourceCredibility } from './promotionGate.js';

const FEATURE_MAP = [
  { feature: 'funding_rate', patterns: ['funding rate', 'funding'], weight: 0.5 },
  { feature: 'open_interest_change_pct', patterns: ['open interest', 'oi'], weight: 0.4 },
  { feature: 'liquidation_imbalance', patterns: ['liquidation', 'liq'], weight: 0.5 },
  { feature: 'social_sentiment', patterns: ['sentiment', 'social', 'fear', 'greed'], weight: 0.3 },
  { feature: 'volume_change_pct', patterns: ['volume', 'vol spike'], weight: 0.4 },
  { feature: 'volatility_pct', patterns: ['volatility', 'volatile', 'atr'], weight: 0.4 },
  { feature: 'whale_flow_score', patterns: ['whale', 'large tx', 'inflow'], weight: 0.3 },
  { feature: 'ema_cross_score', patterns: ['ema cross', 'ma cross', 'moving average'], weight: 0.6 },
  { feature: 'rsi_divergence', patterns: ['rsi', 'relative strength'], weight: 0.5 },
  { feature: 'support_resistance_score', patterns: ['support', 'resistance', 's/r', 'key level'], weight: 0.5 },
  { feature: 'macro_score', patterns: ['macro', 'dxy', 'usd', 'fed', 'interest rate'], weight: 0.3 },
  { feature: 'btc_dominance_score', patterns: ['btc dominance', 'btc.d'], weight: 0.3 },
  { feature: 'order_book_depth', patterns: ['order book', 'depth', 'bid ask', 'spread'], weight: 0.4 },
];

/**
 * Extract threshold value and operator from text for a given keyword.
 * @param {string} text
 * @param {string} keyword
 * @returns {{value:number|null, operator:string}}
 */
function extractThreshold(text, keyword) {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return { value: null, operator: 'gt' };

  const after = text.slice(idx + keyword.length, idx + keyword.length + 30);
  const numMatch = after.match(/([><=!]+)\s*([+-]?\d*\.?\d+)/);
  if (numMatch) {
    return {
      value: parseFloat(numMatch[2]),
      operator: numMatch[1].includes('>') ? 'gt' : numMatch[1].includes('<') ? 'lt' : 'gte',
    };
  }

  return { value: null, operator: 'gt' };
}

/**
 * Infer trade side from text.
 * @param {string} text
 * @returns {'LONG'|'SHORT'|null}
 */
function inferSide(text) {
  const lower = text.toLowerCase();
  const longScore = (lower.match(/\blong\b/g) || []).length;
  const shortScore = (lower.match(/\bshort\b/g) || []).length;
  if (longScore > shortScore) return 'LONG';
  if (shortScore > longScore) return 'SHORT';
  return null;
}

/**
 * Extract strategies from research text content.
 * Uses duplicate detection to avoid re-creating the same strategy.
 * @param {string} content
 * @param {string} [sourceName]
 * @returns {Array<{name:string, description:string, rules:Array, confidence:number, tags:string[], rulesHash?:string}>}
 */
export function extractStrategiesFromText(content, sourceName = 'unknown') {
  const lower = content.toLowerCase();
  const strategies = [];
  const tags = [];

  for (const mapping of FEATURE_MAP) {
    for (const pattern of mapping.patterns) {
      if (lower.includes(pattern.toLowerCase())) {
        tags.push(mapping.feature);
        const { value, operator } = extractThreshold(content, pattern);
        const rules = [{
          feature: mapping.feature,
          operator,
          value: value ?? getDefaultThreshold(mapping.feature),
          weight: mapping.weight,
        }];
        const proposal = {
          name: `extracted_${mapping.feature}`,
          description: `Extracted rule for ${mapping.feature} from research text. Source: ${sourceName}`,
          rules,
          confidence: Math.min(mapping.weight + 0.1, 0.95),
          tags: [mapping.feature],
        };

        // Check for duplicates before adding
        const dupCheck = checkDuplicate(proposal);
        if (!dupCheck.isDuplicate) {
          proposal.rulesHash = hashProposal(proposal);
          strategies.push(proposal);
        }
        break;
      }
    }
  }

  // If we have multiple rules, merge them into a composite strategy
  if (strategies.length >= 2) {
    const side = inferSide(content);
    const allRules = strategies.flatMap((s) => s.rules);
    const compositeProposal = {
      name: `composite_${Date.now().toString(36)}`,
      description: `Composite strategy extracted from research. Inferred side: ${side || 'unknown'}. Source: ${sourceName}`,
      rules: allRules,
      confidence: Math.min(strategies.reduce((sum, s) => sum + s.confidence, 0) / strategies.length + 0.05, 0.95),
      tags: [...new Set(tags)],
    };

    // Check for duplicates on the composite
    const dupCheck = checkDuplicate(compositeProposal);
    if (!dupCheck.isDuplicate) {
      compositeProposal.rulesHash = hashProposal(compositeProposal);
      strategies.push(compositeProposal);
    }
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
 * Uses Supabase adapter first, falls back to SQLite.
 * Includes duplicate detection and source credibility scoring.
 * @returns {{extracted:number, saved:number}}
 */
export async function extractAndSaveFromResearch() {
  const rows = db.prepare(`
    SELECT id, content, source_name FROM research_sources WHERE used = 0 ORDER BY created_at DESC LIMIT 50
  `).all();

  let extracted = 0;
  let saved = 0;
  const markUsed = db.prepare(`UPDATE research_sources SET used = 1 WHERE id = ?`);
  const insert = db.prepare(`
    INSERT INTO strategy_proposals (created_at, name, description, rules_json, confidence, tested, promoted, rejected, rules_hash, source_name)
    VALUES (datetime('now'), ?, ?, ?, ?, 0, 0, 0, ?, ?)
  `);

  for (const row of rows) {
    const sourceName = row.source_name || 'unknown';
    const sourceCredibility = getSourceCredibility(sourceName);

    // Low credibility sources can still suggest ideas but with reduced confidence
    const credibilityMultiplier = Math.min(sourceCredibility / 0.5, 1.0);

    const strategies = extractStrategiesFromText(row.content, sourceName);
    extracted += strategies.length;

    for (const s of strategies) {
      // Apply credibility multiplier to confidence
      const adjustedConfidence = s.confidence * credibilityMultiplier;

      try {
        // Try Supabase first
        await saveStrategyProposal({
          name: s.name,
          description: s.description,
          rulesJson: JSON.stringify(s.rules),
          confidence: adjustedConfidence,
          tags: s.tags,
          rulesHash: s.rulesHash || null,
          sourceName: sourceName,
        });
        saved++;
      } catch (e) {
        // Fallback to SQLite
        try {
          insert.run(s.name, s.description, JSON.stringify(s.rules), adjustedConfidence, s.rulesHash || null, sourceName);
          saved++;
        } catch (e2) {
          logger.warn(`[STRATEGY-EXTRACTOR] Save failed (both Supabase and SQLite): ${e2.message}`);
        }
      }

      // Save the proposal hash for future duplicate detection
      if (s.rulesHash) {
        try {
          saveProposalHash(s.rulesHash, s.name);
        } catch (e) {
          // Non-critical
        }
      }
    }

    // Mark source as used via Supabase adapter, fallback to SQLite
    try {
      await markResearchSourceUsed(row.id);
    } catch (e) {
      markUsed.run(row.id);
    }
  }

  logger.info(`[STRATEGY-EXTRACTOR] Extracted ${extracted} strategies, saved ${saved} proposals`);
  return { extracted, saved };
}
