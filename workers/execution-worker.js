// ============================================================
// Execution Worker v3 — Aggressive Signal Execution Optimizer
// Polls signals → evaluates with ML/RL/TV confluence → opens
// positions with adaptive leverage → monitors with trailing stops.
// Runs continuously on VPS (pm2) or as Vercel cron.
// ============================================================

import { supabase, isSupabaseNoOp } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import {
  evaluateSignalForExecution,
  openExecution,
  monitorExecutions,
  getOrCreateExecutionAccount,
} from '../lib/mock-trading/execution-engine.js';

const POLL_INTERVAL_MS = Number(process.env.EXECUTION_POLL_INTERVAL_MS || 30_000);
const MAX_SIGNAL_AGE_MINUTES = Number(process.env.MAX_SIGNAL_AGE_MINUTES || 720); // 12h default — processes any signal still valid
const ENABLED = config.ENABLE_MOCK_TRADING_WORKER !== false;

let isRunning = false;

async function pollAndExecute() {
  if (isRunning) return;
  isRunning = true;

  try {
    // 1. Fetch active signals (paper mode: include expired too for backfill)
    const now = new Date().toISOString();
    const isPaper = config.TRADING_MODE === 'paper' || !config.TRADING_MODE;
    let query = supabase
      .from('signals')
      .select('id, symbol, side, entry_price, stop_loss, take_profit, confidence, strategy, timeframe, generated_at, metadata, valid_until, mode')
      .eq('status', 'active')
      .order('generated_at', { ascending: false })
      .limit(50);

    // In live mode, only pick non-expired signals. In paper mode, be permissive.
    if (!isPaper) {
      query = query.gt('valid_until', now);
    }

    const { data: signals, error } = await query;

    if (error) {
      logger.error('[EXEC-WORKER] Signal fetch error:', error.message);
      isRunning = false;
      return;
    }

    if (!signals?.length) {
      isRunning = false;
      return;
    }

    let executed = 0;
    let skipped = 0;

    for (const signal of signals) {
      try {
        // Re-check for open trades right before opening (avoids race condition
        // with aggressive-mock-worker which also opens trades on the same symbols)
        const { data: existingTrade } = await supabase
          .from('mock_trades')
          .select('id')
          .eq('symbol', signal.symbol)
          .eq('status', 'open')
          .limit(1);
        if (existingTrade?.length) {
          skipped++;
          continue;
        }

        // Evaluate signal for execution worthiness
        const evaluation = await evaluateSignalForExecution(signal);
        if (!evaluation.execute) {
          logger.debug(`[EXEC-WORKER] SKIP ${signal.symbol} — ${evaluation.reason}`);
          skipped++;
          continue;
        }

        // Open execution
        const result = await openExecution(signal, evaluation);
        if (result.error) {
          logger.warn(`[EXEC-WORKER] OPEN FAILED ${signal.symbol}: ${result.error}`);
          skipped++;
          continue;
        }

        logger.info(`[EXEC-WORKER] OPENED ${signal.symbol} ${signal.side} lev=${result.trade?.leverage}x`);
        executed++;
      } catch (e) {
        logger.error(`[EXEC-WORKER] Error processing ${signal.symbol}:`, e.message);
      }
    }

    if (executed > 0 || skipped > 0) {
      logger.info(`[EXEC-WORKER] Cycle complete — executed=${executed}, skipped=${skipped}`);
    }
  } catch (e) {
    logger.error('[EXEC-WORKER] Poll cycle error:', e.message);
  } finally {
    isRunning = false;
  }
}

async function monitorLoop() {
  try {
    const closed = await monitorExecutions();
    if (closed?.length) {
      logger.info(`[EXEC-WORKER] Monitor closed ${closed.length} trades`);
    }
  } catch (e) {
    logger.error('[EXEC-WORKER] Monitor error:', e.message);
  }
}

async function main() {
  if (!ENABLED) {
    logger.info('[EXEC-WORKER] Disabled via config');
    return;
  }

  if (isSupabaseNoOp()) {
    logger.error('[EXEC-WORKER] Supabase is in NO-OP mode. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.');
    return;
  }

  // Ensure account exists (retry with backoff)
  let account = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      account = await getOrCreateExecutionAccount();
      if (account) break;
    } catch (e) {
      logger.warn(`[EXEC-WORKER] Account setup attempt ${attempt}/5 failed: ${e.message}`);
    }
    if (attempt < 5) {
      const delay = attempt * 2000;
      logger.info(`[EXEC-WORKER] Retrying account creation in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  if (!account) {
    logger.error('[EXEC-WORKER] CRITICAL: Account is null after 5 attempts — cannot start. Check Supabase connection and mock_accounts table.');
    logger.error('[EXEC-WORKER] Run SQL from supabase/fix-trader-not-trading.sql');
    return;
  }

  const balance = account.current_balance ?? account.starting_balance ?? 1_000_000;
  logger.info(`[EXEC-WORKER] Account ready — id=${account.id}, name=${account.name}, balance=$${Number(balance).toLocaleString()}`);

  logger.info(`[EXEC-WORKER] Starting — poll every ${POLL_INTERVAL_MS}ms, trading mode=${config.TRADING_MODE || 'paper'}`);

  // Immediate first runs
  try {
    await pollAndExecute();
    await monitorLoop();
  } catch (e) {
    logger.error('[EXEC-WORKER] Initial execution failed:', e.message);
  }

  // Loops
  setInterval(pollAndExecute, POLL_INTERVAL_MS);
  setInterval(monitorLoop, 15_000); // Monitor every 15s
  
  logger.info('[EXEC-WORKER] Worker is now RUNNING and actively polling for signals');
}

main().catch((e) => {
  logger.error('[EXEC-WORKER] Fatal:', e);
  process.exit(1);
});
