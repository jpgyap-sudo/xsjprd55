// ============================================================
// Perpetual Trader Worker — Signal-driven paper trading engine
// Polls for new signals, opens perpetual trades, monitors SL/TP.
// Runs every 60s on VPS via PM2.
// ============================================================

import { supabase, isSupabaseNoOp } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { openPerpetualTrade, monitorPerpetualTrades, resetDailyStats } from '../lib/perpetual-trader/engine.js';
import { isMainModule } from '../lib/entrypoint.js';

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
 */
async function pollAndTrade() {
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

export async function runPerpetualTraderCycle() {
  const started = Date.now();
  if (isSupabaseNoOp()) {
    logger.error('[perp-worker] Supabase is in NO-OP mode. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.');
    return { ok: false, error: 'Supabase NO-OP' };
  }
  logger.info('[perp-worker] Starting cycle...');

  await checkDailyReset();

  const monitorResult = await monitorTrades();
  const tradeResult = await pollAndTrade();

  // Prune processed set to prevent memory leak
  if (PROCESSED_SIGNALS.size > 5000) {
    const toKeep = Array.from(PROCESSED_SIGNALS).slice(-2000);
    PROCESSED_SIGNALS.clear();
    for (const id of toKeep) PROCESSED_SIGNALS.add(id);
  }

  const duration = Date.now() - started;
  logger.info(`[perp-worker] Cycle complete in ${duration}ms: opened=${tradeResult.opened}, monitored=${monitorResult.checked}, closed=${monitorResult.closed}`);

  return {
    ok: true,
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
