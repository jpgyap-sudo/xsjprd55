// ============================================================
// Source Credibility Scoring
// Gives every research source a credibility score.
// TradingView, Binance funding, and internal mock feedback
// outrank generic headlines. Low-credibility sources can suggest
// ideas but cannot directly create promotable strategies.
// ============================================================

import { logger } from '../logger.js';

/**
 * Source credibility configuration.
 * Scale: 0.0 (untrusted) to 1.0 (highly trusted).
 */
export const SOURCE_CREDIBILITY_MAP = {
  // Exchange data — highest trust
  binance_funding: { score: 0.90, category: 'exchange', label: 'Binance Funding' },
  binance_futures_data: { score: 0.90, category: 'exchange', label: 'Binance Futures' },
  binance_spot: { score: 0.85, category: 'exchange', label: 'Binance Spot' },
  bybit_funding: { score: 0.85, category: 'exchange', label: 'Bybit Funding' },
  okx_funding: { score: 0.85, category: 'exchange', label: 'OKX Funding' },
  hyperliquid_intel: { score: 0.75, category: 'exchange', label: 'Hyperliquid' },

  // Technical analysis — high trust
  tradingview_ideas: { score: 0.85, category: 'technical', label: 'TradingView Ideas' },
  tradingview_ta: { score: 0.85, category: 'technical', label: 'TradingView TA' },

  // Market data aggregators — medium-high trust
  coingecko_global: { score: 0.70, category: 'market_data', label: 'CoinGecko Global' },
  coingecko_market: { score: 0.70, category: 'market_data', label: 'CoinGecko Market' },
  coingecko_trending: { score: 0.65, category: 'market_data', label: 'CoinGecko Trending' },
  lunarcrush: { score: 0.60, category: 'social', label: 'LunarCrush' },

  // Macro / news — medium trust
  macro_analysis: { score: 0.65, category: 'macro', label: 'Macro Analysis' },
  news_api: { score: 0.50, category: 'news', label: 'News API' },
  cryptopanic_news: { score: 0.50, category: 'news', label: 'CryptoPanic' },
  theblock: { score: 0.60, category: 'news', label: 'The Block' },
  coindesk: { score: 0.55, category: 'news', label: 'CoinDesk' },

  // Social media — low trust
  social_sentiment_x: { score: 0.30, category: 'social', label: 'X/Twitter Sentiment' },
  reddit_crypto: { score: 0.25, category: 'social', label: 'Reddit Crypto' },
  telegram_signals: { score: 0.15, category: 'social', label: 'Telegram Signals' },
  discord: { score: 0.20, category: 'social', label: 'Discord' },

  // Internal — highest trust
  mock_feedback: { score: 0.95, category: 'internal', label: 'Mock Trading Feedback' },
  backtest_results: { score: 0.85, category: 'internal', label: 'Backtest Results' },

  // Default fallback
  default: { score: 0.40, category: 'unknown', label: 'Unknown Source' },
};

/**
 * Get credibility info for a source name.
 * @param {string} sourceName
 * @returns {{score:number, category:string, label:string}}
 */
export function getSourceInfo(sourceName) {
  return SOURCE_CREDIBILITY_MAP[sourceName] ?? SOURCE_CREDIBILITY_MAP.default;
}

/**
 * Get the credibility score for a source.
 * @param {string} sourceName
 * @returns {number}
 */
export function getSourceScore(sourceName) {
  return getSourceInfo(sourceName).score;
}

/**
 * Check if a source is credible enough to generate promotable strategies.
 * @param {string} sourceName
 * @param {number} [threshold=0.5]
 * @returns {boolean}
 */
export function isSourceCredible(sourceName, threshold = 0.5) {
  return getSourceScore(sourceName) >= threshold;
}

/**
 * Get the credibility category for a source.
 * @param {string} sourceName
 * @returns {string}
 */
export function getSourceCategory(sourceName) {
  return getSourceInfo(sourceName).category;
}

/**
 * Adjust a strategy's promotion score based on source credibility.
 * @param {number} baseScore — original promotion score (0..1)
 * @param {string} sourceName
 * @param {number} [weight=0.15] — how much credibility influences the score
 * @returns {number}
 */
export function adjustScoreByCredibility(baseScore, sourceName, weight = 0.15) {
  const cred = getSourceScore(sourceName);
  // Blend: higher credibility = closer to base score, lower = penalized
  const adjusted = baseScore * (0.5 + cred * 0.5);
  return Number((baseScore * (1 - weight) + adjusted * weight).toFixed(4));
}

/**
 * Get a human-readable credibility badge.
 * @param {string} sourceName
 * @returns {{label:string, color:string, icon:string}}
 */
export function getCredibilityBadge(sourceName) {
  const info = getSourceInfo(sourceName);
  const score = info.score;

  let color, icon;
  if (score >= 0.8) { color = '#22c55e'; icon = '🟢'; }      // High
  else if (score >= 0.6) { color = '#eab308'; icon = '🟡'; }  // Medium
  else if (score >= 0.4) { color = '#f97316'; icon = '🟠'; }  // Low
  else { color = '#ef4444'; icon = '🔴'; }                     // Untrusted

  return { label: info.label, color, icon, score: info.score, category: info.category };
}

/**
 * Log credibility info for debugging.
 * @param {string} sourceName
 */
export function logCredibility(sourceName) {
  const badge = getCredibilityBadge(sourceName);
  logger.info(`[CREDIBILITY] ${badge.icon} ${badge.label}: ${badge.score.toFixed(2)} (${badge.category})`);
}
