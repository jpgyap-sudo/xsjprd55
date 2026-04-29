// ============================================================
// Execution Worker v3 — Aggressive Signal Execution Optimizer
// Polls signals → evaluates with ML/RL/TV confluence → opens
// positions with adaptive leverage → monitors with trailing stops.
// Runs continuously on VPS (pm2) or as Vercel cron.
// ============================================================

import { supabase } from '../lib/supabase.js';
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
    // 1. Fetch signals that are still valid (not expired) and haven't been traded yet
    const now = new Date().toISOString();
    const { data: signals, error } = await supabase
      .from('signals')
      .select('id, symbol, side, entry_price, stop_loss, take_profit, confidence, strategy, timeframe, generated_at, metadata, valid_until')
      .eq('status', 'active')
      .gt('valid_until', now)
      .order('generated_at', { ascending: false })
      .limit(20);

    if (error) {
      logger.error('[EXEC-WORKER] Signal fetch error:', error.message);
      isRunning = false;
      return;
    }

    if (!signals?.length) {
      isRunning = false;
      return;
    }

    // 2. Deduplicate: skip symbols already open
    const { data: openTrades } = await supabase
      .from('mock_trades')
      .select('symbol')
      .eq('status', 'open');
    const openSymbols = new Set((openTrades || []).map(t => t.symbol));

    let executed = 0;
    let skipped = 0;

    for (const signal of signals) {
      try {
        // Skip if already have open position on this symbol
        if (openSymbols.has(signal.symbol)) {
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
        openSymbols.add(signal.symbol);
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

  // Ensure account exists
  try {
    const account = await getOrCreateExecutionAccount();
    if (!account) {
      logger.error('[EXEC-WORKER] Account is null — cannot start');
      return;
    }
    const balance = account.current_balance ?? account.starting_balance ?? 1_000_000;
    logger.info(`[EXEC-WORKER] Account ready — balance=$${Number(balance).toLocaleString()}`);
  } catch (e) {
    logger.error('[EXEC-WORKER] Account setup failed:', e.message);
  }

  logger.info(`[EXEC-WORKER] Starting — poll every ${POLL_INTERVAL_MS}ms`);

  // Immediate first runs
  await pollAndExecute();
  await monitorLoop();

  // Loops
  setInterval(pollAndExecute, POLL_INTERVAL_MS);
  setInterval(monitorLoop, 15_000); // Monitor every 15s
}

main().catch((e) => {
  logger.error('[EXEC-WORKER] Fatal:', e);
  process.exit(1);
});
