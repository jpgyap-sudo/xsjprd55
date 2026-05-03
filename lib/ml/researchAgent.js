// ============================================================
// Research Agent — xsjprd55 ML Loop v2
// Stores research inputs, extracts strategy hints, creates proposals.
// Now writes through Supabase adapter (with SQLite fallback).
// ============================================================

import { db } from './db.js';
import { storeResearchSource, saveStrategyProposal, getUnusedResearchSources, markResearchSourceUsed } from './supabase-db.js';

/**
 * @typedef {Object} ResearchItem
 * @property {string} sourceName
 * @property {string} [sourceUrl]
 * @property {string} content
 */

/**
 * @typedef {Object} StrategyRule
 * @property {string} feature
 * @property {'gt'|'lt'|'eq'|'between'} operator
 * @property {number} value
 * @property {number} [value2] — for between
 * @property {number} weight 0..1
 */

/**
 * @typedef {Object} StrategyProposal
 * @property {string} name
 * @property {string} description
 * @property {StrategyRule[]} rules
 * @property {number} confidence 0..1
 */

/**
 * Store a raw research item and extract hints.
 * @param {ResearchItem} item
 * @returns {Promise<number>} inserted row id
 */
export async function storeResearchItem(item) {
  const hints = extractStrategyHints(item.content);

  // Try Supabase first, fallback to SQLite
  try {
    await storeResearchSource({ ...item, hints });
  } catch (e) {
    db.prepare(`
      INSERT INTO research_sources (created_at, source_name, source_url, content, extracted_hints_json, used)
      VALUES (datetime('now'), ?, ?, ?, ?, 0)
    `).run(item.sourceName, item.sourceUrl || null, item.content, JSON.stringify(hints));
  }

  return 1; // Return a dummy id (Supabase generates UUID)
}

/**
 * Extract keyword-based strategy hints from text.
 * @param {string} text
 * @returns {string[]}
 */
function extractStrategyHints(text) {
  const lower = text.toLowerCase();
  const hints = [];
  const keywords = [
    ['funding', 'negative funding'],
    ['open interest', 'oi spike'],
    ['liquidation', 'short squeeze', 'long squeeze'],
    ['sentiment', 'bullish', 'bearish'],
    ['volume', 'volume spike'],
    ['volatility', 'iv crush', 'iv spike'],
    ['whale', 'wallet', 'inflow', 'outflow'],
    ['ema', 'cross', 'golden cross'],
    ['rsi', 'oversold', 'overbought'],
    ['support', 'resistance', 'breakout'],
    ['macro', 'etf', 'regulation'],
  ];

  for (const group of keywords) {
    for (const kw of group) {
      if (lower.includes(kw)) {
        hints.push(group[0]);
        break;
      }
    }
  }
  return [...new Set(hints)];
}

/**
 * Generate strategy proposals from recent unused research.
 * @param {number} [limit=25]
 * @returns {Promise<StrategyProposal[]>}
 */
export async function proposeStrategiesFromRecentResearch(limit = 25) {
  let rows = [];
  try {
    rows = await getUnusedResearchSources(limit);
  } catch (e) {
    rows = db.prepare(`
      SELECT id, content, extracted_hints_json
      FROM research_sources
      WHERE used = 0
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
  }

  const proposals = [];

  for (const row of rows) {
    const hintsRaw = row.extracted_hints_json || row.extracted_hints || '[]';
    const hints = typeof hintsRaw === 'string' ? JSON.parse(hintsRaw || '[]') : hintsRaw;
    if (hints.length === 0) continue;

    const proposal = buildProposalFromHints(hints, row.content);
    if (proposal) proposals.push(proposal);

    try {
      await markResearchSourceUsed(row.id);
    } catch (e) {
      db.prepare(`UPDATE research_sources SET used = 1 WHERE id = ?`).run(row.id);
    }
  }

  return proposals;
}

/**
 * Build a StrategyProposal from extracted hint keywords.
 * @param {string[]} hints
 * @param {string} [originalText]
 * @returns {StrategyProposal|null}
 */
function buildProposalFromHints(hints, originalText = '') {
  const rules = [];
  let confidence = 0.5;

  if (hints.includes('funding')) {
    rules.push({ feature: 'funding_rate', operator: 'lt', value: -0.005, weight: 0.8 });
    confidence += 0.05;
  }
  if (hints.includes('open interest')) {
    rules.push({ feature: 'open_interest_change_pct', operator: 'gt', value: 2, weight: 0.6 });
    confidence += 0.05;
  }
  if (hints.includes('liquidation')) {
    rules.push({ feature: 'liquidation_imbalance', operator: 'gt', value: 0.2, weight: 0.9 });
    confidence += 0.08;
  }
  if (hints.includes('sentiment')) {
    rules.push({ feature: 'social_sentiment', operator: 'gt', value: 0.3, weight: 0.5 });
    confidence += 0.03;
  }
  if (hints.includes('volume')) {
    rules.push({ feature: 'volume_change_pct', operator: 'gt', value: 50, weight: 0.5 });
    confidence += 0.03;
  }
  if (hints.includes('volatility')) {
    rules.push({ feature: 'volatility_pct', operator: 'gt', value: 2, weight: 0.4 });
    confidence += 0.02;
  }
  if (hints.includes('whale')) {
    rules.push({ feature: 'whale_flow_score', operator: 'gt', value: 0.3, weight: 0.6 });
    confidence += 0.04;
  }

  if (rules.length === 0) return null;

  const name = `research_${hints.slice(0, 2).join('_')}_${Date.now().toString(36)}`;
  return {
    name,
    description: `Auto-generated from research hints: ${hints.join(', ')}. Source excerpt: ${originalText.slice(0, 120)}`,
    rules,
    confidence: Math.min(confidence, 0.95),
  };
}

/**
 * Persist a strategy proposal to the DB.
 * @param {StrategyProposal} proposal
 * @returns {Promise<number>} inserted row id
 */
export async function saveStrategyProposalToDb(proposal) {
  try {
    await saveStrategyProposal(proposal);
  } catch (e) {
    db.prepare(`
      INSERT INTO strategy_proposals (created_at, name, description, rules_json, confidence, tested, promoted, rejected)
      VALUES (datetime('now'), ?, ?, ?, ?, 0, 0, 0)
    `).run(proposal.name, proposal.description, JSON.stringify(proposal.rules), proposal.confidence);
  }
  return 1;
}

/**
 * One research cycle: ingest items → propose → save.
 * @param {ResearchItem[]} [items=[]]
 * @returns {Promise<{stored:number, proposals:number}>}
 */
export async function researchCycle(items = []) {
  let stored = 0;
  for (const item of items) {
    await storeResearchItem(item);
    stored++;
  }

  const proposals = await proposeStrategiesFromRecentResearch(50);
  let saved = 0;
  for (const p of proposals) {
    await saveStrategyProposalToDb(p);
    saved++;
  }

  return { stored, proposals: saved };
}
