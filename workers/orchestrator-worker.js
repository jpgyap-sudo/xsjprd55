// ============================================================
// Orchestrator Worker — Single process that runs ALL cyclical
// background tasks on schedules. Replaces 30 separate PM2 workers.
//
// Design:
//   - One Node.js process, one event loop
//   - Each task runs on its own schedule via setInterval
//   - Tasks are staggered on startup to avoid CPU spikes
//   - Each task has a mutex (isRunning guard) to prevent overlap
//   - Errors are caught per-task so one failure doesn't kill others
//   - Debug/dev tasks are NOT scheduled — they run via API only
// ============================================================

import 'dotenv/config';

// ── Task imports (all cyclical workers) ─────────────────────
// Trading (critical)
import { runMockTradingWorker } from './mock-trading-worker.js';
import { runAggressiveWorker } from './aggressive-mock-worker.js';
import { runPerpetualTraderCycle } from './perpetual-trader-worker.js';
import { runStrategyMonitor } from './strategy-monitor-worker.js';

// Data feeds
import { runNewsIngestCycle } from './news-ingest-worker.js';
import { runLiquidationIntelWorker } from './liquidation-intel-worker.js';
import { runLiquidationHeatmapWorker } from './liquidation-heatmap-worker.js';
import { runOpenInterestWorker } from './open-interest-worker.js';
import { runSocialCrawlerWorker } from './social-crawler-worker.js';
import { runWalletTrackerWorker } from './wallet-tracker-worker.js';
import { runSocialNewsCycle } from './social-news-worker.js';

// Learning (infrequent)
import { runLearningLoop } from '../lib/learning-loop.js';
import { runLearningLayer } from '../lib/learning-layer/index.js';
import { runLearningCycle as runBrainLearningCycle } from '../lib/brain/learning-engine.js';
import { runLearningCycle as runSimLearningCycle } from './simulation-learning-worker.js';
import { syncBacktestData } from './backtest-sync-worker.js';

// Maintenance
import { runDataHealthWorker } from './data-health-worker.js';
import { runNotificationWorker } from './notification-worker.js';
import { runResearchAgentWorker } from './research-agent-worker.js';
import { runContinuousBacktester } from './continuous-backtester.js';
import { runDiagnosticWorker } from './diagnostic-worker.js';

// Brain
import { runTradingBrain } from '../lib/brain/brain-router.js';

import { logger } from '../lib/logger.js';
import { recordWorkerHeartbeat } from '../lib/worker-health.js';

// ── Configuration ───────────────────────────────────────────
const WORKER_NAME = 'orchestrator';

const SCHEDULES = {
  // ── Trading (critical, frequent) ──
  'mock-trading': {
    interval: parseInt(process.env.MOCK_TRADING_INTERVAL_MS || '60000', 10),
    fn: runMockTradingWorker,
    enabled: process.env.ENABLE_MOCK_TRADING_WORKER !== 'false',
    stagger: 0,
    maxMemory: 256,
  },
  'aggressive-mock': {
    interval: parseInt(process.env.AGGRESSIVE_MOCK_INTERVAL_MS || '120000', 10),
    fn: runAggressiveWorker,
    enabled: process.env.ENABLE_MOCK_TRADING_WORKER !== 'false',
    stagger: 5_000,
    maxMemory: 256,
  },
  'perpetual-trader': {
    interval: parseInt(process.env.PERPETUAL_TRADER_INTERVAL_SECONDS || '60', 10) * 1000,
    fn: runPerpetualTraderCycle,
    enabled: true,
    stagger: 10_000,
    maxMemory: 256,
  },
  'strategy-monitor': {
    interval: 30 * 60 * 1000,
    fn: runStrategyMonitor,
    enabled: process.env.ENABLE_STRATEGY_MONITOR_WORKER !== 'false',
    stagger: 20_000,
    maxMemory: 128,
  },

  // ── Data Feeds (important, moderate frequency) ──
  'news-ingest': {
    interval: parseInt(process.env.NEWS_INGEST_INTERVAL_SECONDS || '180', 10) * 1000,
    fn: runNewsIngestCycle,
    enabled: true,
    stagger: 25_000,
    maxMemory: 128,
  },
  'liquidation-intel': {
    interval: 30 * 60 * 1000,
    fn: runLiquidationIntelWorker,
    enabled: true,
    stagger: 30_000,
    maxMemory: 64,
  },
  'liquidation-heatmap': {
    interval: 5 * 60 * 1000,
    fn: runLiquidationHeatmapWorker,
    enabled: true,
    stagger: 35_000,
    maxMemory: 128,
  },
  'open-interest': {
    interval: 3 * 60 * 1000,
    fn: runOpenInterestWorker,
    enabled: true,
    stagger: 40_000,
    maxMemory: 128,
  },
  'social-crawler': {
    interval: 15 * 60 * 1000,
    fn: runSocialCrawlerWorker,
    enabled: process.env.ENABLE_SOCIAL_CRAWLER_WORKER !== 'false',
    stagger: 45_000,
    maxMemory: 128,
  },
  'wallet-tracker': {
    interval: parseInt(process.env.WALLET_TRACKER_INTERVAL_MS || '300000', 10),
    fn: runWalletTrackerWorker,
    enabled: true,
    stagger: 50_000,
    maxMemory: 128,
  },
  'social-news': {
    interval: 5 * 60 * 1000,
    fn: runSocialNewsCycle,
    enabled: true,
    stagger: 55_000,
    maxMemory: 128,
  },

  // ── Learning (infrequent) ──
  'learning-loop': {
    interval: (parseInt(process.env.LEARNING_INTERVAL_HOURS) || 6) * 60 * 60 * 1000,
    fn: runLearningLoop,
    enabled: process.env.ENABLE_LEARNING_WORKER !== 'false',
    stagger: 60_000,
    maxMemory: 256,
  },
  'tll': {
    interval: parseInt(process.env.TLL_INTERVAL_MS || '1800000', 10),
    fn: runLearningLayer,
    enabled: process.env.TLL_ENABLED !== 'false',
    stagger: 65_000,
    maxMemory: 256,
  },
  'brain-learning': {
    interval: parseInt(process.env.BRAIN_LEARNING_INTERVAL_MS || '86400000', 10),
    fn: runBrainLearningCycle,
    enabled: true,
    stagger: 70_000,
    maxMemory: 256,
  },
  'simulation-learning': {
    interval: parseInt(process.env.SIMULATION_LEARNING_INTERVAL_MS || '1800000', 10),
    fn: runSimLearningCycle,
    enabled: process.env.ENABLE_SIMULATION_LEARNING !== 'false',
    stagger: 75_000,
    maxMemory: 128,
  },
  'backtest-sync': {
    interval: 5 * 60 * 1000,
    fn: syncBacktestData,
    enabled: process.env.ENABLE_CONTINUOUS_BACKTESTER !== 'false',
    stagger: 80_000,
    maxMemory: 128,
  },
  'continuous-backtester': {
    interval: 5 * 60 * 1000,
    fn: runContinuousBacktester,
    enabled: process.env.ENABLE_CONTINUOUS_BACKTESTER !== 'false',
    stagger: 85_000,
    maxMemory: 128,
  },

  // ── Maintenance (moderate frequency) ──
  'data-health': {
    interval: 60 * 1000,
    fn: runDataHealthWorker,
    enabled: true,
    stagger: 90_000,
    maxMemory: 64,
  },
  'notification': {
    interval: 60 * 1000,
    fn: runNotificationWorker,
    enabled: process.env.ENABLE_NOTIFICATION_WORKER !== 'false',
    stagger: 95_000,
    maxMemory: 64,
  },
  'research-agent': {
    interval: 10 * 60 * 1000,
    fn: runResearchAgentWorker,
    enabled: true,
    stagger: 105_000,
    maxMemory: 256,
  },
  'diagnostic': {
    interval: 10 * 60 * 1000,
    fn: runDiagnosticWorker,
    enabled: true,
    stagger: 110_000,
    maxMemory: 128,
  },
};

// ── Signal generator (calls local API) ──────────────────────
const SIGNAL_GEN_INTERVAL_MS = 15 * 60 * 1000;

async function runSignalGenerator() {
  try {
    const SERVER_PORT = process.env.PORT || 3000;
    const API_URL = `http://localhost:${SERVER_PORT}/api/signals`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      logger.info(`[${WORKER_NAME}] signal-generator — ${data.signals?.length || 0} signals`);
    }
  } catch (e) {
    logger.debug(`[${WORKER_NAME}] signal-generator — ${e.message}`);
  }
}

// ── TLL notification worker (inline) ────────────────────────
const TLL_NOTIFY_INTERVAL_MS = parseInt(process.env.TLL_NOTIFY_INTERVAL_MS || '300000', 10);
const TLL_NOTIFY_ENABLED = process.env.TLL_NOTIFY_ENABLED !== 'false';

// ── Brain scanning (runs per symbol/timeframe combo) ────────
const BRAIN_SYMBOLS = (process.env.BRAIN_SYMBOLS || 'BTCUSDT,ETHUSDT').split(',').map(s => s.trim()).filter(Boolean);
const BRAIN_TIMEFRAMES = (process.env.BRAIN_TIMEFRAMES || '15m,1h,4h').split(',').map(t => t.trim()).filter(Boolean);
const BRAIN_INTERVAL_MS = parseInt(process.env.BRAIN_SCAN_INTERVAL_MS || '300000', 10);
const BRAIN_MODE = process.env.BRAIN_LIVE_MODE === 'true' ? 'live' : 'paper';

// ── State ───────────────────────────────────────────────────
const running = new Map(); // taskName -> boolean (mutex)
const memoryUsage = new Map(); // taskName -> { lastDuration, lastMemory }
let tickCount = 0;

// ── Memory monitoring ───────────────────────────────────────
function getMemoryMB() {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024),
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
    external: Math.round(usage.external / 1024 / 1024),
  };
}

// ── Safe task runner with mutex, error handling, and memory tracking ──
async function runTask(taskName, taskFn) {
  if (running.get(taskName)) {
    logger.debug(`[${WORKER_NAME}] ${taskName} — skipped (still running)`);
    return;
  }

  running.set(taskName, true);
  const started = Date.now();
  const memBefore = getMemoryMB();

  try {
    await taskFn();
    const duration = Date.now() - started;
    const memAfter = getMemoryMB();
    memoryUsage.set(taskName, { lastDuration: duration, lastMemory: memAfter.heapUsed });

    if (duration > 5000) {
      logger.info(`[${WORKER_NAME}] ${taskName} — completed in ${duration}ms (heap: ${memBefore.heapUsed}→${memAfter.heapUsed}MB)`);
    }
  } catch (err) {
    const duration = Date.now() - started;
    logger.error(`[${WORKER_NAME}] ${taskName} — failed after ${duration}ms: ${err.message}`);
    if (err.stack) {
      logger.debug(`[${WORKER_NAME}] ${taskName} stack: ${err.stack.split('\n').slice(0, 3).join(' | ')}`);
    }
  } finally {
    running.set(taskName, false);
  }
}

// ── Brain scan task (runs per symbol/timeframe) ─────────────
async function runBrainScan() {
  for (const symbol of BRAIN_SYMBOLS) {
    for (const timeframe of BRAIN_TIMEFRAMES) {
      try {
        const decision = await runTradingBrain({ symbol, timeframe, mode: BRAIN_MODE });
        logger.info(`[${WORKER_NAME}] brain ${symbol} ${timeframe}: ${decision.side} @ ${decision.confidence} — ${decision.risk_verdict}`);
      } catch (err) {
        logger.error(`[${WORKER_NAME}] brain ${symbol} ${timeframe}: ${err.message}`);
      }
    }
  }
}

// ── Heartbeat ───────────────────────────────────────────────
async function reportHeartbeat() {
  try {
    const mem = getMemoryMB();
    const activeTasks = [];
    for (const [name, isRunning] of running) {
      if (isRunning) activeTasks.push(name);
    }
    await recordWorkerHeartbeat(WORKER_NAME, {
      memory_mb: mem,
      active_tasks: activeTasks,
      scheduled_tasks: Object.keys(SCHEDULES).length,
      tick_count: tickCount,
      uptime_seconds: Math.floor(process.uptime()),
    });
  } catch (_) {
    // Heartbeat failures are non-critical
  }
}

// ── Status endpoint helper (for API) ────────────────────────
export function getOrchestratorStatus() {
  const mem = getMemoryMB();
  const tasks = [];
  for (const [name, schedule] of Object.entries(SCHEDULES)) {
    tasks.push({
      name,
      enabled: schedule.enabled,
      interval_ms: schedule.interval,
      is_running: running.get(name) || false,
      last_duration_ms: memoryUsage.get(name)?.lastDuration || null,
      last_memory_mb: memoryUsage.get(name)?.lastMemory || null,
    });
  }
  return {
    worker: WORKER_NAME,
    uptime_seconds: Math.floor(process.uptime()),
    memory: mem,
    tick_count: tickCount,
    brain: {
      symbols: BRAIN_SYMBOLS,
      timeframes: BRAIN_TIMEFRAMES,
      interval_ms: BRAIN_INTERVAL_MS,
      mode: BRAIN_MODE,
    },
    tasks,
  };
}

// ── Run a single task by name (for API-triggered execution) ─
export async function runTaskByName(taskName) {
  const schedule = SCHEDULES[taskName];
  if (!schedule) {
    // Check if it's a brain task
    if (taskName === 'brain') {
      await runBrainScan();
      return { ok: true, task: taskName };
    }
    if (taskName === 'signal-generator') {
      await runSignalGenerator();
      return { ok: true, task: taskName };
    }
    throw new Error(`Unknown task: ${taskName}`);
  }
  if (!schedule.enabled) {
    throw new Error(`Task disabled: ${taskName}`);
  }
  await runTask(taskName, schedule.fn);
  return { ok: true, task: taskName };
}

// ── Initialize all schedules ────────────────────────────────
function init() {
  logger.info(`[${WORKER_NAME}] Starting orchestrator with ${Object.keys(SCHEDULES).length} scheduled tasks`);
  logger.info(`[${WORKER_NAME}] Brain scan: ${BRAIN_SYMBOLS.join(',')} × ${BRAIN_TIMEFRAMES.join(',')} every ${BRAIN_INTERVAL_MS}ms`);

  const mem = getMemoryMB();
  logger.info(`[${WORKER_NAME}] Initial memory: RSS=${mem.rss}MB, heap=${mem.heapUsed}/${mem.heapTotal}MB`);

  // Register each task with staggered startup
  for (const [taskName, schedule] of Object.entries(SCHEDULES)) {
    if (!schedule.enabled) {
      logger.info(`[${WORKER_NAME}] ${taskName} — disabled by config, skipping`);
      continue;
    }

    // First run after stagger delay
    setTimeout(() => {
      runTask(taskName, schedule.fn);
    }, schedule.stagger);

    // Then on interval
    setInterval(() => {
      runTask(taskName, schedule.fn);
    }, schedule.interval);

    logger.info(`[${WORKER_NAME}] ${taskName} — scheduled every ${schedule.interval / 1000}s (stagger: ${schedule.stagger}ms)`);
  }

  // Signal generator (not exported, inline here)
  setTimeout(() => runSignalGenerator(), 30_000);
  setInterval(runSignalGenerator, SIGNAL_GEN_INTERVAL_MS);
  logger.info(`[${WORKER_NAME}] signal-generator — scheduled every ${SIGNAL_GEN_INTERVAL_MS / 1000}s`);

  // Brain scan
  setTimeout(() => runBrainScan(), 120_000); // 2min delay for brain
  setInterval(() => runBrainScan(), BRAIN_INTERVAL_MS);
  logger.info(`[${WORKER_NAME}] brain — scheduled every ${BRAIN_INTERVAL_MS / 1000}s`);

  // Heartbeat every 60s
  setInterval(reportHeartbeat, 60_000);

  // Memory usage report every 15min
  setInterval(() => {
    const mem = getMemoryMB();
    logger.info(`[${WORKER_NAME}] Memory report: RSS=${mem.rss}MB, heap=${mem.heapUsed}/${mem.heapTotal}MB`);
  }, 15 * 60 * 1000);

  logger.info(`[${WORKER_NAME}] All tasks scheduled — orchestrator ready`);
}

// ── Start ───────────────────────────────────────────────────
init();

// ── Graceful shutdown ───────────────────────────────────────
process.on('SIGINT', () => {
  logger.info(`[${WORKER_NAME}] Shutting down...`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info(`[${WORKER_NAME}] Shutting down...`);
  process.exit(0);
});
