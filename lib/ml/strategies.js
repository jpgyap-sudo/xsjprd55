// ============================================================
// Built-in Strategies + Strategy Lab Runner — xsjprd55
// 5 core strategies adapted from reference package.
// ============================================================

import { buildFeatures } from './features.js';

/**
 * @typedef {Object} SignalDecision
 * @property {string} strategy
 * @property {'LONG'|'SHORT'|'NONE'} side
 * @property {number} confidence 0..1
 * @property {string} rationale
 */

/**
 * @param {number} score
 * @returns {'LONG'|'SHORT'|'NONE'}
 */
function sideFromScore(score) {
  if (score > 0.15) return 'LONG';
  if (score < -0.15) return 'SHORT';
  return 'NONE';
}

/**
 * @param {import('./features.js').MarketRawInput} input
 * @returns {SignalDecision}
 */
function liquidationSqueeze(input) {
  const f = buildFeatures(input);
  const liqImb = f.liquidation_imbalance;
  const oiChange = f.open_interest_change_pct;
  const funding = f.funding_rate;
  const confidence = Math.min(Math.abs(liqImb) * 2.5, 0.98);

  let side = 'NONE';
  if (liqImb > 0.25 && oiChange > 1.5 && funding > 0.005) side = 'SHORT';
  else if (liqImb < -0.25 && oiChange > 1.5 && funding < -0.005) side = 'LONG';

  return {
    strategy: 'liquidation_squeeze',
    side,
    confidence: side === 'NONE' ? 0 : confidence,
    rationale: `liq_imb=${liqImb.toFixed(3)}, oi_chg=${oiChange.toFixed(2)}%, funding=${funding.toFixed(4)}`,
  };
}

/**
 * @param {import('./features.js').MarketRawInput} input
 * @returns {SignalDecision}
 */
function trendFollowing(input) {
  const f = buildFeatures(input);
  const btc = f.btc_trend_score;
  const whale = f.whale_flow_score;
  const score = (btc * 0.6) + (whale * 0.4);
  const side = sideFromScore(score);

  return {
    strategy: 'trend_following',
    side,
    confidence: Math.min(Math.abs(score), 0.98),
    rationale: `btc_trend=${btc.toFixed(3)}, whale=${whale.toFixed(3)}, score=${score.toFixed(3)}`,
  };
}

/**
 * @param {import('./features.js').MarketRawInput} input
 * @returns {SignalDecision}
 */
function meanReversionFunding(input) {
  const f = buildFeatures(input);
  const funding = f.funding_rate;
  const vol = f.volatility_pct;
  const side = funding > 0.008 && vol > 1.5 ? 'SHORT' : funding < -0.008 && vol > 1.5 ? 'LONG' : 'NONE';

  return {
    strategy: 'mean_reversion_funding',
    side,
    confidence: side === 'NONE' ? 0 : Math.min(Math.abs(funding) * 80 + vol * 0.05, 0.98),
    rationale: `funding=${funding.toFixed(4)}, vol=${vol.toFixed(2)}%`,
  };
}

/**
 * @param {import('./features.js').MarketRawInput} input
 * @returns {SignalDecision}
 */
function sentimentBreakout(input) {
  const f = buildFeatures(input);
  const social = f.social_sentiment;
  const news = f.news_sentiment;
  const vol = f.volatility_pct;
  const score = (social * 0.5) + (news * 0.5);
  const side = Math.abs(score) > 0.3 && vol > 2 ? sideFromScore(score) : 'NONE';

  return {
    strategy: 'sentiment_breakout',
    side,
    confidence: side === 'NONE' ? 0 : Math.min(Math.abs(score) + vol * 0.02, 0.98),
    rationale: `social=${social.toFixed(3)}, news=${news.toFixed(3)}, vol=${vol.toFixed(2)}%`,
  };
}

/**
 * @param {import('./features.js').MarketRawInput} input
 * @returns {SignalDecision}
 */
function defensiveNoTrade(input) {
  const f = buildFeatures(input);
  const spread = f.spread_bps;
  const vol = f.volatility_pct;
  const isBad = spread > 50 || vol < 0.3 || (f.funding_rate > 0.015 && f.open_interest_change_pct > 5);

  return {
    strategy: 'defensive_no_trade_filter',
    side: isBad ? 'NONE' : 'LONG', // pass-through; used as veto
    confidence: isBad ? 0.02 : 0.5,
    rationale: `spread=${spread.toFixed(1)}bps, vol=${vol.toFixed(2)}%, bad=${isBad}`,
  };
}

export const STRATEGIES = {
  liquidation_squeeze: liquidationSqueeze,
  trend_following: trendFollowing,
  mean_reversion_funding: meanReversionFunding,
  sentiment_breakout: sentimentBreakout,
  defensive_no_trade_filter: defensiveNoTrade,
};

/**
 * Run all built-in strategies against market input.
 * @param {import('./features.js').MarketRawInput} input
 * @returns {SignalDecision[]}
 */
export function runStrategyLab(input) {
  return Object.entries(STRATEGIES).map(([name, fn]) => fn(input));
}
