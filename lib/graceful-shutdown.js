// ============================================================
// Graceful Shutdown Utility
// Provides SIGTERM/SIGINT handlers for workers with:
// - In-progress task draining
// - State persistence
// - Health check endpoint registration
// - Backoff strategy tracking
// ============================================================

import { logger } from './logger.js';

/**
 * @typedef {Object} ShutdownOptions
 * @property {string} [name='worker'] — Worker name for logging
 * @property {number} [timeout=10000] — Max ms to wait before force exit
 * @property {Function} [onShutdown] — Async cleanup function
 * @property {boolean} [exitOnSignal=true] — Whether to call process.exit()
 */

/**
 * Register graceful shutdown handlers for a worker.
 * Call once at worker startup.
 * @param {ShutdownOptions} opts
 * @returns {() => void} — Unregister function (for testing)
 */
export function registerGracefulShutdown(opts = {}) {
  const {
    name = 'worker',
    timeout = 10000,
    onShutdown,
    exitOnSignal = true,
  } = opts;

  let shuttingDown = false;

  function handleSignal(signal) {
    if (shuttingDown) {
      logger.warn(`[${name}] Double ${signal} — force exiting`);
      process.exit(1);
    }
    shuttingDown = true;

    logger.info(`[${name}] Received ${signal}, draining...`);

    const timer = setTimeout(() => {
      logger.error(`[${name}] Shutdown timeout (${timeout}ms) — force exiting`);
      process.exit(1);
    }, timeout);

    if (typeof onShutdown === 'function') {
      Promise.resolve()
        .then(() => onShutdown(signal))
        .then(() => {
          clearTimeout(timer);
          logger.info(`[${name}] Clean shutdown complete`);
          if (exitOnSignal) process.exit(0);
        })
        .catch((err) => {
          clearTimeout(timer);
          logger.error(`[${name}] Shutdown error: ${err.message}`);
          if (exitOnSignal) process.exit(1);
        });
    } else {
      clearTimeout(timer);
      logger.info(`[${name}] No cleanup registered, exiting`);
      if (exitOnSignal) process.exit(0);
    }
  }

  process.on('SIGTERM', handleSignal);
  process.on('SIGINT', handleSignal);

  // Return unregister function
  return () => {
    process.removeListener('SIGTERM', handleSignal);
    process.removeListener('SIGINT', handleSignal);
  };
}

/**
 * Backoff strategy for retrying failed operations.
 * @param {number} attempt — 0-based attempt number
 * @param {Object} [opts]
 * @param {number} [opts.baseMs=1000] — Base delay in ms
 * @param {number} [opts.maxMs=60000] — Max delay in ms
 * @param {number} [opts.factor=2] — Exponential factor
 * @param {number} [opts.jitter=0.1] — Random jitter fraction (0 = no jitter)
 * @returns {number} — Delay in ms to wait before retry
 */
export function backoffDelay(attempt, opts = {}) {
  const {
    baseMs = 1000,
    maxMs = 60000,
    factor = 2,
    jitter = 0.1,
  } = opts;

  const delay = Math.min(baseMs * Math.pow(factor, attempt), maxMs);
  const jitterAmount = jitter > 0 ? delay * jitter * (Math.random() * 2 - 1) : 0;
  return Math.max(0, Math.round(delay + jitterAmount));
}

/**
 * Retry an async function with exponential backoff.
 * @param {Function} fn — Async function to retry
 * @param {Object} [opts]
 * @param {number} [opts.maxRetries=3]
 * @param {number} [opts.baseMs=1000]
 * @param {number} [opts.maxMs=60000]
 * @param {Function} [opts.onRetry] — Called with (error, attempt) before retry
 * @returns {Promise<any>} — Result of fn
 */
export async function withRetry(fn, opts = {}) {
  const {
    maxRetries = 3,
    baseMs = 1000,
    maxMs = 60000,
    onRetry,
  } = opts;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = backoffDelay(attempt, { baseMs, maxMs });
        if (typeof onRetry === 'function') {
          onRetry(err, attempt, delay);
        }
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Create a simple health check payload for a worker.
 * @param {Object} state
 * @param {string} state.name
 * @param {string} [state.status='running']
 * @param {number} [state.uptime]
 * @param {number} [state.lastTick]
 * @param {number} [state.tickCount=0]
 * @param {Object} [state.meta={}]
 * @returns {Object}
 */
export function healthPayload(state) {
  return {
    ok: true,
    name: state.name,
    status: state.status || 'running',
    uptime: state.uptime ?? (process.uptime() * 1000),
    lastTick: state.lastTick || null,
    tickCount: state.tickCount || 0,
    memory: process.memoryUsage(),
    pid: process.pid,
    ts: Date.now(),
    ...state.meta,
  };
}
