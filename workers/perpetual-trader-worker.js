// ============================================================
// Perpetual Trader Worker — Signal-driven paper trading engine
// Polls for new signals, opens perpetual trades, monitors SL/TP.
// Runs every 60s on VPS via PM2.
// Wired to Central Brain for risk gate checks and TLL for
// regime awareness, skill-based filtering, and strategy weights.
// ============================================================

import { supabase, isSupabaseNoOp } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { openPerpetualTrade, monitorPerpetualTrades, resetDailyStats, closePerpetualTrade } from '../lib/perpetual-trader/engine.js';
import { isMainModule } from '../lib/entrypoint.js';
import { brainRiskCheck, logAgentEvent } from '../lib/brain-integration.js';
import { fetchPublicPrice } from '../lib/market-price.js';
import { getTllRegimeForMockTrading, getActiveTllSkills, checkSignalAgainstTllSkills, getTllStrategyWeights } from '../lib/learning-layer/mock-trading-bridge.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const PROCESSED_SIGNALS = new Set();
const TRANSIENT_SKIP_REASONS = [
  'Price unavailable',
  'Could not fetch price',
  'network',
  'timeout',
  'fetch',
  'schema cache',
  'does not exist',
];

export function shouldRetrySignal(reason = '') {
  const normalized = String(reason).toLowerCase();
  return TRANSIENT_SKIP_REASONS.some((item) => normalized.includes(item.toLowerCase()));
}

/**
 * Poll for new unprocessed signals and open trades
 * @param {object} tllRegime - TLL regime data
 * @param {Array} tllSkills - Active TLL skills
 * @param {object} tllWeights - TLL strategy weights
 */
async function pollAndTrade(tllRegime = null, tllSkills = [], tllWeights = {}) {
  const results = { processed: 0, opened: 0, skipped: 0, errors: 0 };

  try {
    const nowMs = Date.now();
    const recentWindowIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Get recent signals not yet traded by perpetual trader. The perpetual
    // engine tracks its own processed state via perpetual_mock_trades below.
    const { data: signals, error } = await supabase
      .from('signals')
      .select('*')
      .eq('status', 'active')
      .gte('generated_at', recentWindowIso)
      .order('generated_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    const tradableSignals = (signals || []).filter((signal) => {
      if (!signal.valid_until) return true;
      return new Date(signal.valid_until).getTime() >= nowMs;
    });
    if (tradableSignals.length === 0) return results;

    for (const signal of tradableSignals) {
      if (PROCESSED_SIGNALS.has(signal.id)) {
        results.skipped++;
        continue;
      }

      try {
        // Check if already have an open trade for this signal
        const { data: existing } = await supabase
          .from('perpetual_mock_trades')
          .select('id')
          .eq('signal_id', signal.id)
          .limit(1)
          .maybeSingle();

        if (existing) {
          PROCESSED_SIGNALS.add(signal.id);
          results.skipped++;
          continue;
        }

        // ── Central Brain Risk Gate ──────────────────────────
        const riskCheck = await brainRiskCheck({
          symbol: signal.symbol,
          timeframe: signal.timeframe || '15m',
          side: signal.side,
          mode: process.env.TRADING_MODE || 'paper'
        });

        if (!riskCheck.approved) {
          results.skipped++;
          logger.info(`[perp-worker] Brain BLOCKED ${signal.symbol}: ${riskCheck.verdict} (conf=${riskCheck.confidence?.toFixed(2)})`);
          await logAgentEvent('perpetual_trader', 'brain_blocked_trade', {
            signal_id: signal.id,
            symbol: signal.symbol,
            verdict: riskCheck.verdict,
            confidence: riskCheck.confidence
          });
          // Don't permanently skip — brain may approve later
          continue;
        }

        await logAgentEvent('perpetual_trader', 'brain_approved_trade', {
          signal_id: signal.id,
          symbol: signal.symbol,
          confidence: riskCheck.confidence,
          verdict: riskCheck.verdict
        });
        // ── End Brain Risk Gate ─────────────────────────────

        // ── TLL Regime Check ──────────────────────────────────
        const normalizedSide = (signal.side || '').toLowerCase();
        if (tllRegime && tllRegime.regime === 'high_volatility') {
          results.skipped++;
          logger.debug(`[perp-worker] TLL blocked ${signal.symbol}: high_volatility regime`);
          await logAgentEvent('perpetual_trader', 'tll_blocked_trade', {
            signal_id: signal.id,
            symbol: signal.symbol,
            side: normalizedSide,
            reason: 'high_volatility_regime',
            regime: tllRegime.regime,
          });
          continue;
        }

        // ── TLL Skill Check ───────────────────────────────────
        if (tllSkills.length > 0) {
          const skillCheck = checkSignalAgainstTllSkills(
            { side: normalizedSide, symbol: signal.symbol, strategy: signal.strategy },
            tllSkills
          );
          if (skillCheck.conflictingSkills.length > 0 && skillCheck.boost < -0.05) {
            results.skipped++;
            logger.debug(`[perp-worker] TLL skills blocked ${signal.symbol}: ${skillCheck.conflictingSkills.join(', ')}`);
            continue;
          }
        }

        // ── TLL Strategy Weight Check ─────────────────────────
        const strategyName = signal.strategy || signal.strategy_name;
        if (strategyName && tllWeights[strategyName] === 0) {
          results.skipped++;
          logger.debug(`[perp-worker] TLL blocked ${signal.symbol}: strategy "${strategyName}" is quarantined`);
          continue;
        }

        const result = await openPerpetualTrade(signal);
        if (result.ok) {
          PROCESSED_SIGNALS.add(signal.id);
          results.opened++;
        } else {
          results.skipped++;
          logger.info(`[perp-worker] Skipped ${signal.symbol}: ${result.reason}`);
          if (!shouldRetrySignal(result.reason)) {
            PROCESSED_SIGNALS.add(signal.id);
          }
        }
      } catch (e) {
        results.errors++;
        logger.error(`[perp-worker] Trade error for ${signal.symbol}: ${e.message}`);
      }
    }

    results.processed = tradableSignals.length;
    return results;
  } catch (e) {
    logger.error(`[perp-worker] Poll failed: ${e.message}`);
    results.errors++;
    return results;
  }
}

/**
 * Monitor open trades for SL/TP hits
 */
async function monitorTrades() {
  try {
    const result = await monitorPerpetualTrades();
    if (result.closed > 0) {
      logger.info(`[perp-worker] Monitored ${result.checked} trades, closed ${result.closed}`);
    }
    return result;
  } catch (e) {
    logger.error(`[perp-worker] Monitor failed: ${e.message}`);
    return { checked: 0, closed: 0, error: e.message };
  }
}

/**
 * Check if daily reset is needed (midnight UTC)
 */
async function checkDailyReset() {
  const now = new Date();
  if (now.getUTCHours() === 0 && now.getUTCMinutes() < 2) {
    try {
      await resetDailyStats();
      logger.info('[perp-worker] Daily stats reset');
    } catch (e) {
      logger.error(`[perp-worker] Reset failed: ${e.message}`);
    }
  }
}

/**
 * Force-close stale perpetual trades that have been open too long
 * (e.g., trades from May 5 that are still open 10+ days later)
 */
async function closeStaleTrades() {
  try {
    const maxAgeHours = Number(process.env.PERPETUAL_MAX_TRADE_AGE_HOURS || 72); // 3 days default
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();

    const { data: staleTrades } = await supabase
      .from('perpetual_mock_trades')
      .select('*')
      .eq('status', 'open')
      .lt('created_at', cutoff)
      .limit(20);

    if (!staleTrades?.length) return 0;

    let closed = 0;
    for (const trade of staleTrades) {
      try {
        // Fetch current price to close at market
        const { price } = await fetchPublicPrice(trade.symbol);
        const exitPrice = price || trade.entry_price;
        await closePerpetualTrade(
          trade,
          exitPrice,
          'expired',
          `Force-closed after ${maxAgeHours}h (created ${trade.created_at})`
        );
        closed++;
        logger.info(`[perp-worker] Force-closed stale trade ${trade.id} (${trade.symbol})`);
        continue;

        // Calculate PnL
        const isLong = (trade.side || '').toLowerCase() === 'long';
        const pnlPct = isLong
          ? ((exitPrice - trade.entry_price) / trade.entry_price) * 100
          : ((trade.entry_price - exitPrice) / trade.entry_price) * 100;
        const pnl = (trade.position_size || 0) * (pnlPct / 100);

        await supabase
          .from('perpetual_mock_trades')
          .update({
            status: 'closed',
            exit_price: exitPrice,
            pnl: pnl,
            pnl_pct: pnlPct,
            closed_at: new Date().toISOString(),
            close_reason: 'stale_timeout',
            close_detail: `Force-closed after ${maxAgeHours}h (created ${trade.created_at})`
          })
          .eq('id', trade.id);

        // Update account balance — fetch current, then add PnL
        const { data: account } = await supabase
          .from('perpetual_mock_accounts')
          .select('current_balance, total_pnl')
          .eq('id', trade.account_id)
          .single();

        if (account) {
          await supabase
            .from('perpetual_mock_accounts')
            .update({
              current_balance: Number(account.current_balance || 0) + pnl,
              total_pnl: Number(account.total_pnl || 0) + pnl
            })
            .eq('id', trade.account_id);
        }

        closed++;
        logger.info(`[perp-worker] Force-closed stale trade ${trade.id} (${trade.symbol}) — PnL: $${pnl.toFixed(2)}`);
      } catch (e) {
        logger.warn(`[perp-worker] Failed to close stale trade ${trade.id}: ${e.message}`);
      }
    }

    if (closed > 0) {
      logger.info(`[perp-worker] Closed ${closed} stale trades older than ${maxAgeHours}h`);
    }
    return closed;
  } catch (e) {
    logger.warn(`[perp-worker] Stale trade cleanup failed: ${e.message}`);
    return 0;
  }
}

export async function runPerpetualTraderCycle() {
  const started = Date.now();
  if (isSupabaseNoOp()) {
    logger.error('[perp-worker] Supabase is in NO-OP mode. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.');
    return { ok: false, error: 'Supabase NO-OP' };
  }
  logger.info('[perp-worker] Starting cycle...');

  // ── Cache TLL data once per tick ──────────────────────────
  let tllRegime = null;
  let tllSkills = [];
  let tllWeights = {};
  try {
    const [regime, skills, weights] = await Promise.all([
      getTllRegimeForMockTrading(),
      getActiveTllSkills(0.6),
      getTllStrategyWeights(),
    ]);
    tllRegime = regime;
    tllSkills = skills;
    tllWeights = weights;
    if (regime.regime !== 'unknown') {
      logger.debug(`[perp-worker] TLL regime: ${regime.regime} (${regime.tllRegime})`);
    }
  } catch (e) {
    logger.debug('[perp-worker] TLL cache failed:', e.message);
  }

  await checkDailyReset();

  // Close stale trades first (trades open >72h)
  const staleClosed = await closeStaleTrades();

  const monitorResult = await monitorTrades();
  const tradeResult = await pollAndTrade(tllRegime, tllSkills, tllWeights);

  // Prune processed set to prevent memory leak
  if (PROCESSED_SIGNALS.size > 5000) {
    const toKeep = Array.from(PROCESSED_SIGNALS).slice(-2000);
    PROCESSED_SIGNALS.clear();
    for (const id of toKeep) PROCESSED_SIGNALS.add(id);
  }

  const duration = Date.now() - started;
  logger.info(`[perp-worker] Cycle complete in ${duration}ms: stale=${staleClosed}, opened=${tradeResult.opened}, monitored=${monitorResult.checked}, closed=${monitorResult.closed}`);

  return {
    ok: true,
    staleClosed,
    tradeResult,
    monitorResult,
    duration_ms: duration
  };
}

async function main() {
  const once = process.argv.includes('--once');
  const intervalSeconds = Number(process.env.PERPETUAL_TRADER_INTERVAL_SECONDS || 60);

  // Startup banner — helps verify PM2 log capture is working
  console.log('========================================');
  console.log(`[perp-worker] Starting at ${new Date().toISOString()}`);
  console.log(`[perp-worker] once=${once}, interval=${intervalSeconds}s`);
  console.log(`[perp-worker] Node version: ${process.version}`);
  console.log(`[perp-worker] PID: ${process.pid}`);
  console.log('========================================');
  logger.info(`[perp-worker] Starting. once=${once}, interval=${intervalSeconds}s`);

  // Pre-load recently processed signal IDs to avoid duplicates on restart
  try {
    const { data: recentTrades } = await supabase
      .from('perpetual_mock_trades')
      .select('signal_id')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(500);
    if (recentTrades) {
      for (const t of recentTrades) {
        if (t.signal_id) PROCESSED_SIGNALS.add(t.signal_id);
      }
    }
    logger.info(`[perp-worker] Pre-loaded ${PROCESSED_SIGNALS.size} processed signals`);
  } catch (e) {
    logger.warn(`[perp-worker] Pre-load failed: ${e.message}`);
  }

  do {
    try {
      await runPerpetualTraderCycle();
    } catch (error) {
      logger.error(`[perp-worker] Cycle failed: ${error.message}`);
    }

    if (once) break;
    await sleep(intervalSeconds * 1000);
  } while (true);
}

if (isMainModule(import.meta.url)) {
  main();
}
