// ============================================================
// Dynamic Strategies — xsjprd55 ML Loop v2
// Turns research proposal JSON into executable test signals.
// ============================================================

import { buildFeatures } from './features.js';
import { db } from './db.js';

/**
 * @typedef {Object} SignalDecision
 * @property {string} strategy
 * @property {'LONG'|'SHORT'|'NONE'} side
 * @property {number} confidence 0..1
 * @property {string} rationale
 */

/**
 * @param {number} value
 * @param {{feature:string, operator:'gt'|'lt'|'eq'|'between', value:number, value2?:number, weight:number}} rule
 * @returns {boolean}
 */
function passRule(value, rule) {
  switch (rule.operator) {
    case 'gt': return value > rule.value;
    case 'lt': return value < rule.value;
    case 'eq': return value === rule.value;
    case 'between': return value >= rule.value && value <= (rule.value2 ?? rule.value);
    default: return false;
  }
}

/**
 * Infer side from feature value and rule context.
 * @param {number} featureValue
 * @param {import('./researchAgent.js').StrategyRule} rule
 * @returns {'LONG'|'SHORT'|'NONE'}
 */
function inferSide(featureValue, rule) {
  const bullishFeatures = ['social_sentiment', 'news_sentiment', 'btc_trend_score', 'whale_flow_score', 'volume_change_pct'];
  const bearishFeatures = ['funding_rate', 'open_interest_change_pct', 'liquidation_imbalance'];

  if (bullishFeatures.includes(rule.feature)) {
    return rule.operator === 'gt' ? 'LONG' : 'SHORT';
  }
  if (bearishFeatures.includes(rule.feature)) {
    return rule.operator === 'lt' ? 'LONG' : 'SHORT';
  }
  return featureValue > 0 ? 'LONG' : 'SHORT';
}

/**
 * Run a dynamic strategy proposal against market input.
 * @param {import('./researchAgent.js').StrategyProposal} proposal
 * @param {import('./features.js').MarketRawInput} input
 * @returns {SignalDecision}
 */
export function runDynamicStrategy(proposal, input) {
  const features = buildFeatures(input);
  let passed = 0;
  let totalWeight = 0;
  let sideVotes = { LONG: 0, SHORT: 0 };

  for (const rule of proposal.rules) {
    const value = features[rule.feature];
    if (value === undefined) continue;
    totalWeight += rule.weight;
    if (passRule(value, rule)) {
      passed += rule.weight;
      const s = inferSide(value, rule);
      sideVotes[s] += rule.weight;
    }
  }

  const passRate = totalWeight > 0 ? passed / totalWeight : 0;
  const side = sideVotes.LONG > sideVotes.SHORT ? 'LONG' : sideVotes.SHORT > sideVotes.LONG ? 'SHORT' : 'NONE';
  const confidence = Math.min(passRate * proposal.confidence, 0.98);

  return {
    strategy: proposal.name,
    side: passRate >= 0.5 ? side : 'NONE',
    confidence,
    rationale: `proposal=${proposal.name}, passRate=${passRate.toFixed(2)}, rules=${proposal.rules.length}`,
  };
}

/**
 * Load untested candidate proposals from DB.
 * @param {number} [limit=50]
 * @returns {Array<{id:number, proposal:import('./researchAgent.js').StrategyProposal}>}
 */
export function loadCandidateProposals(limit = 50) {
  const rows = db.prepare(`
    SELECT id, name, description, rules_json, confidence
    FROM strategy_proposals
    WHERE tested = 0 AND rejected = 0
    ORDER BY confidence DESC
    LIMIT ?
  `).all(limit);

  return rows.map((r) => ({
    id: r.id,
    proposal: {
      name: r.name,
      description: r.description,
      rules: JSON.parse(r.rules_json),
      confidence: r.confidence,
    },
  }));
}

/**
 * Mark a proposal as tested.
 * @param {number} proposalId
 */
export function markProposalTested(proposalId) {
  db.prepare(`UPDATE strategy_proposals SET tested = 1 WHERE id = ?`).run(proposalId);
}

/**
 * Run the full research strategy lab: load candidates → test against input.
 * @param {import('./features.js').MarketRawInput} input
 * @returns {SignalDecision[]}
 */
export function runResearchStrategyLab(input) {
  const candidates = loadCandidateProposals(20);
  const results = [];

  for (const { id, proposal } of candidates) {
    const decision = runDynamicStrategy(proposal, input);
    if (decision.side !== 'NONE') {
      results.push(decision);
    }
    markProposalTested(id);
  }

  return results;
}
