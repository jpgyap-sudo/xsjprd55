// ============================================================
// Bad Trading Windows Filter — Block Dangerous Market Conditions
// Prevents new entries during news spikes, extreme funding,
// thin liquidity, and post-liquidation cascades.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

// ── Main: Check Trading Window ──────────────────────────────

/**
 * Check if the current market window is safe for trading.
 * @param {string} symbol - Trading pair
 * @param {object} marketContext - { fundingRate, volumeChangePct, spread, newsSentimentScore, liqRiskScore }
 * @param {object} [signal] - Optional signal object { strategy }
 * @returns {object} { allowed: boolean, reason?: string, windowType?: string }
 */
export async function checkTradingWindow(symbol, marketContext = {}, signal = null) {
  const blocks = [];

  // ── 1. Major News Spike ─────────────────────────────────
  const newsResult = checkNewsSpike(marketContext);
  if (!newsResult.allowed) {
    blocks.push(newsResult);
  }

  // ── 2. Extreme Funding Rate ─────────────────────────────
  const fundingResult = checkExtremeFunding(marketContext);
  if (!fundingResult.allowed) {
    blocks.push(fundingResult);
  }

  // ── 3. Thin Liquidity ───────────────────────────────────
  const liquidityResult = checkThinLiquidity(marketContext);
  if (!liquidityResult.allowed) {
    blocks.push(liquidityResult);
  }

  // ── 4. Post-Liquidation Cascade ─────────────────────────
  const liqResult = checkLiquidationCascade(marketContext, signal);
  if (!liqResult.allowed) {
    blocks.push(liqResult);
  }

  // ── 5. Weekend Low Liquidity ────────────────────────────
  const weekendResult = checkWeekendLowLiquidity(symbol);
  if (!weekendResult.allowed) {
    blocks.push(weekendResult);
  }

  if (blocks.length > 0) {
    return {
      allowed: false,
      reason: blocks.map(b => b.reason).join('; '),
      windowType: blocks[0].windowType,
      blocks,
    };
  }

  return { allowed: true, reason: null, windowType: 'normal', blocks: [] };
}

// ── Individual Checks ───────────────────────────────────────

function checkNewsSpike(context) {
  const newsScore = context.newsSentimentScore || 0;

  if (Math.abs(newsScore) > 0.8) {
    return {
      allowed: false,
      reason: `Major news spike detected (sentiment: ${newsScore.toFixed(2)}). Blocking new entries.`,
      windowType: 'news_spike',
    };
  }

  if (Math.abs(newsScore) > 0.6) {
    return {
      allowed: true,
      warning: `Elevated news activity (sentiment: ${newsScore.toFixed(2)}). Consider reducing size.`,
      windowType: 'elevated_news',
    };
  }

  return { allowed: true, windowType: 'normal' };
}

function checkExtremeFunding(context) {
  const fundingRate = context.fundingRate || 0;

  // Annualized funding rate
  // Assuming 3 funding intervals per day (8h each) = 1095 intervals per year
  const annualizedFunding = fundingRate * 1095 * 100; // as percentage

  if (annualizedFunding > 100 || annualizedFunding < -100) {
    return {
      allowed: false,
      reason: `Extreme funding rate (annualized: ${annualizedFunding.toFixed(0)}%). Blocking new entries.`,
      windowType: 'extreme_funding',
    };
  }

  if (annualizedFunding > 50 || annualizedFunding < -50) {
    return {
      allowed: true,
      warning: `High funding rate (annualized: ${annualizedFunding.toFixed(0)}%). Elevated risk.`,
      windowType: 'high_funding',
    };
  }

  return { allowed: true, windowType: 'normal' };
}

function checkThinLiquidity(context) {
  const volumeChange = context.volumeChangePct;
  const spread = context.spreadBps || 0;

  if (volumeChange !== undefined && volumeChange < -50 && spread > 20) {
    return {
      allowed: false,
      reason: `Thin liquidity: volume ${volumeChange.toFixed(0)}% below average, spread ${spread.toFixed(0)} bps. Blocking new entries.`,
      windowType: 'thin_liquidity',
    };
  }

  if (volumeChange !== undefined && volumeChange < -30) {
    return {
      allowed: true,
      warning: `Volume ${volumeChange.toFixed(0)}% below average. Reduced liquidity risk.`,
      windowType: 'low_volume',
    };
  }

  return { allowed: true, windowType: 'normal' };
}

function checkLiquidationCascade(context, signal) {
  const liqRiskScore = context.liqRiskScore || 0;

  if (liqRiskScore > 80) {
    // Allow breakout strategies during liquidation cascades (they can profit from volatility)
    const strategy = signal?.strategy || '';
    const isBreakoutStrategy = strategy.includes('Volume') || strategy.includes('Breakout') || strategy === 'tv_ta_scan';

    if (isBreakoutStrategy) {
      return {
        allowed: true,
        warning: `High liquidation risk (score: ${liqRiskScore}). Breakout strategy may benefit from volatility.`,
        windowType: 'liq_cascade_breakout',
      };
    }

    // Block mean-reversion strategies during cascades
    const isMeanReversion = strategy.includes('RSI') || strategy.includes('Bounce');
    if (isMeanReversion) {
      return {
        allowed: false,
        reason: `Post-liquidation cascade (risk score: ${liqRiskScore}). Mean-reversion strategies blocked.`,
        windowType: 'liq_cascade',
      };
    }

    return {
      allowed: false,
      reason: `High liquidation risk (score: ${liqRiskScore}). Blocking new entries.`,
      windowType: 'liq_cascade',
    };
  }

  if (liqRiskScore > 60) {
    return {
      allowed: true,
      warning: `Elevated liquidation risk (score: ${liqRiskScore}). Consider reducing position size.`,
      windowType: 'elevated_liq',
    };
  }

  return { allowed: true, windowType: 'normal' };
}

function checkWeekendLowLiquidity(symbol) {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sunday, 6=Saturday
  const hour = now.getUTCHours();

  // Saturday 00:00-04:00 UTC for altcoins
  const isAltcoin = !symbol.includes('BTC') && !symbol.includes('ETH');

  if (isAltcoin && day === 6 && hour >= 0 && hour < 4) {
    return {
      allowed: false,
      reason: `Weekend low liquidity window (Sat ${hour}:00 UTC). Altcoin trading blocked.`,
      windowType: 'weekend_low_liq',
    };
  }

  return { allowed: true, windowType: 'normal' };
}

// ── Batch Check ─────────────────────────────────────────────

/**
 * Check trading window for multiple symbols.
 */
export async function checkMultipleWindows(symbols, marketContexts = {}) {
  const results = {};

  for (const symbol of symbols) {
    const context = marketContexts[symbol] || {};
    results[symbol] = await checkTradingWindow(symbol, context);
  }

  return results;
}
