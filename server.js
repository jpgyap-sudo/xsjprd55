// ============================================================
// Standalone Server Entry Point — VPS Deployment
// Replaces Vercel serverless with an Express-like HTTP server.
// Supports all existing API routes + cron scheduling.
// ============================================================

import 'dotenv/config';

import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { logger } from './lib/logger.js';
import { config } from './lib/config.js';

// ── Import API route handlers ───────────────────────────────
import telegramHandler from './api/telegram.js';
import signalsHandler from './api/signals.js';
import marketHandler from './api/market.js';
import lunarcrushHandler from './api/lunarcrush.js';
import weeklyAnalysisHandler from './api/weekly-analysis.js';
import debugHandler from './api/debug.js';
import askHandler from './api/ask.js';
import configHandler from './api/config.js';
import liquidationHandler from './api/liquidation.js';
import systemHealthHandler from './api/system-health.js';
import analyzeHandler from './api/analyze.js';
import backtestHandler from './api/backtest.js';
import backtestDashboardHandler from './api/backtest/dashboard.js';
import backtestTradeDetailHandler from './api/backtest/trade-detail.js';
import learningHandler from './api/learning.js';
import botHandler from './api/bot.js';
import catalystHandler from './api/catalyst.js';
import healthHandler from './api/health.js';
import newsFeedHandler from './api/news-feed.js';
import newsSignalHandler from './api/news-signal.js';
import signalHandler from './api/signal.js';
import walletTrackerHandler from './api/wallet-tracker.js';
import agentImprovementHandler from './api/agent-improvement.js';
import socialSentimentHandler from './api/social-sentiment.js';

const PORT = config.PORT || 3000;
const HOST = config.HOST || '0.0.0.0';

// Route registry: pathname → handler module
const routes = {
  '/api/telegram': telegramHandler,
  '/api/signals': signalsHandler,
  '/api/signal': signalHandler,
  '/api/market': marketHandler,
  '/api/lunarcrush': lunarcrushHandler,
  '/api/weekly-analysis': weeklyAnalysisHandler,
  '/api/debug': debugHandler,
  '/api/ask': askHandler,
  '/api/config': configHandler,
  '/api/liquidation': liquidationHandler,
  '/api/system-health': systemHealthHandler,
  '/api/analyze': analyzeHandler,
  '/api/backtest': backtestHandler,
  '/api/backtest/dashboard': backtestDashboardHandler,
  '/api/backtest/trade-detail': backtestTradeDetailHandler,
  '/api/learning': learningHandler,
  '/api/bot': botHandler,
  '/api/catalyst': catalystHandler,
  '/api/health': healthHandler,
  '/api/news-feed': newsFeedHandler,
  '/api/news-signal': newsSignalHandler,
  '/api/wallet-tracker': walletTrackerHandler,
  '/api/agent-improvement': agentImprovementHandler,
  '/api/agent-improvement/summary': agentImprovementHandler,
  '/api/social-sentiment': socialSentimentHandler,
  '/api/social-sentiment/trends': socialSentimentHandler,
};

// ── Request / Response helpers ──────────────────────────────
function createReq(req, bodyBuffer) {
  const parsed = url.parse(req.url, true);
  return {
    method: req.method,
    url: req.url,
    pathname: parsed.pathname,
    query: parsed.query,
    headers: req.headers,
    body: bodyBuffer ? safeJsonParse(bodyBuffer) : undefined,
    // Minimal compatibility shim for Vercel-like env
    env: process.env,
  };
}

function createRes(res) {
  const headers = { 'Content-Type': 'application/json' };
  return {
    status(code) {
      res.statusCode = code;
      return this;
    },
    json(data) {
      if (!res.headersSent) {
        Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
        res.end(JSON.stringify(data));
      }
      return this;
    },
    send(data) {
      if (!res.headersSent) {
        Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
        res.end(typeof data === 'string' ? data : JSON.stringify(data));
      }
      return this;
    },
    setHeader(k, v) {
      headers[k] = v;
      return this;
    }
  };
}

function safeJsonParse(buf) {
  try {
    return JSON.parse(buf.toString());
  } catch {
    return {};
  }
}

// ── Static files (public/) ──────────────────────────────────
function serveStatic(reqPath, res) {
  const filePath = path.join(process.cwd(), 'public', reqPath === '/' ? 'index.html' : reqPath);
  if (!filePath.startsWith(path.join(process.cwd(), 'public'))) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const mime = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    }[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.end(data);
  });
}

// ── HTTP Server ─────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const start = Date.now();
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS headers for dashboard access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Collect body for POST requests
  let bodyBuffer = Buffer.alloc(0);
  if (req.method === 'POST' || req.method === 'PUT') {
    for await (const chunk of req) {
      bodyBuffer = Buffer.concat([bodyBuffer, chunk]);
    }
  }

  // Route to API handler or static file
  const handler = routes[pathname];
  if (handler) {
    try {
      const vReq = createReq(req, bodyBuffer);
      const vRes = createRes(res);
      await handler(vReq, vRes);
    } catch (err) {
      logger.error(`[SERVER] Route error ${pathname}: ${err.message}`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Internal server error', path: pathname }));
      }
    }
  } else if (pathname.startsWith('/public/') || pathname === '/') {
    serveStatic(pathname === '/' ? '/' : pathname.replace('/public', ''), res);
  } else {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found', path: pathname }));
  }

  const duration = Date.now() - start;
  logger.info(`[HTTP] ${req.method} ${pathname} ${res.statusCode} ${duration}ms`);
});

// ── Cron Scheduling (VPS replaces Vercel cron) ──────────────
function startScheduler() {
  const { CRON_SIGNALS, CRON_MARKET, CRON_WEEKLY } = config;

  if (CRON_SIGNALS !== 'false') {
    cron.schedule(CRON_SIGNALS, async () => {
      logger.info('[CRON] Running signal scan...');
      try {
        const vReq = { method: 'GET', url: '/api/signals', query: {}, body: {}, headers: {} };
        const vRes = {
          status() { return this; },
          json() { return this; },
          send() { return this; },
          setHeader() { return this; }
        };
        await signalsHandler(vReq, vRes);
        logger.info('[CRON] Signal scan complete');
      } catch (err) {
        logger.error(`[CRON] Signal scan failed: ${err.message}`);
      }
    });
    logger.info(`[CRON] Signal scan scheduled: ${CRON_SIGNALS}`);
  }

  if (CRON_MARKET !== 'false') {
    cron.schedule(CRON_MARKET, async () => {
      logger.info('[CRON] Running market data cache...');
      try {
        const vReq = { method: 'GET', url: '/api/market', query: {}, body: {}, headers: {} };
        const vRes = { status() { return this; }, json() { return this; }, send() { return this; }, setHeader() { return this; } };
        await marketHandler(vReq, vRes);
        logger.info('[CRON] Market cache complete');
      } catch (err) {
        logger.error(`[CRON] Market cache failed: ${err.message}`);
      }
    });
    logger.info(`[CRON] Market cache scheduled: ${CRON_MARKET}`);
  }

  if (CRON_WEEKLY !== 'false') {
    cron.schedule(CRON_WEEKLY, async () => {
      logger.info('[CRON] Running weekly analysis...');
      try {
        const vReq = { method: 'GET', url: '/api/weekly-analysis', query: {}, body: {}, headers: {} };
        const vRes = { status() { return this; }, json() { return this; }, send() { return this; }, setHeader() { return this; } };
        await weeklyAnalysisHandler(vReq, vRes);
        logger.info('[CRON] Weekly analysis complete');
      } catch (err) {
        logger.error(`[CRON] Weekly analysis failed: ${err.message}`);
      }
    });
    logger.info(`[CRON] Weekly analysis scheduled: ${CRON_WEEKLY}`);
  }
}

// ── Background Workers (VPS only) ───────────────────────────
async function startWorkers() {
  logger.info('[WORKERS] Starting background workers...');
  const workers = [];
  if (config.ENABLE_OI_WORKER) {
    const { runOpenInterestWorker } = await import('./workers/open-interest-worker.js');
    workers.push({ name: 'OI', fn: runOpenInterestWorker, interval: 3 * 60 * 1000 });
  }
  if (config.ENABLE_LIQUIDATION_WORKER) {
    const { runLiquidationHeatmapWorker } = await import('./workers/liquidation-heatmap-worker.js');
    workers.push({ name: 'Liquidation', fn: runLiquidationHeatmapWorker, interval: 5 * 60 * 1000 });
  }
  if (config.ENABLE_HEALTH_WORKER) {
    const { runDataHealthWorker } = await import('./workers/data-health-worker.js');
    workers.push({ name: 'Health', fn: runDataHealthWorker, interval: 60 * 1000 });
  }
  if (config.ENABLE_NOTIFICATION_WORKER) {
    const { runNotificationWorker } = await import('./workers/notification-worker.js');
    workers.push({ name: 'Notification', fn: runNotificationWorker, interval: 60 * 1000 });
  }
  if (config.ENABLE_CONTINUOUS_BACKTESTER) {
    const { runContinuousBacktester } = await import('./workers/continuous-backtester.js');
    workers.push({ name: 'Backtester', fn: runContinuousBacktester, interval: 5 * 60 * 1000 });
  }
  if (config.ENABLE_MOCK_TRADING_WORKER) {
    const { runMockTradingWorker } = await import('./workers/mock-trading-worker.js');
    workers.push({ name: 'MockTrading', fn: runMockTradingWorker, interval: 3 * 60 * 1000 });
  }
  if (config.ENABLE_WALLET_TRACKER_WORKER) {
    const { runWalletTrackerWorker } = await import('./workers/wallet-tracker-worker.js');
    workers.push({ name: 'WalletTracker', fn: runWalletTrackerWorker, interval: config.WALLET_TRACKER_INTERVAL_MS || 5 * 60 * 1000 });
  }
  if (config.ENABLE_APP_IMPROVEMENT_WORKER) {
    const { runAppImprovementWorker } = await import('./workers/app-improvement-worker.js');
    workers.push({ name: 'Advisor', fn: runAppImprovementWorker, interval: 60 * 60 * 1000 });
  }
  if (config.ENABLE_DIAGNOSTIC_WORKER) {
    const { runDiagnosticWorker } = await import('./workers/diagnostic-worker.js');
    workers.push({ name: 'Diagnostic', fn: runDiagnosticWorker, interval: 10 * 60 * 1000 });
  }
  if (config.ENABLE_SOCIAL_CRAWLER_WORKER) {
    const { runSocialCrawlerWorker } = await import('./workers/social-crawler-worker.js');
    workers.push({ name: 'SocialCrawler', fn: runSocialCrawlerWorker, interval: 15 * 60 * 1000 });
  }
  if (config.ENABLE_LEARNING_WORKER) {
    const { startLearningWorker } = await import('./workers/learning-loop-worker.js');
    startLearningWorker();
  }
  for (const w of workers) {
    try {
      await w.fn();
      setInterval(w.fn, w.interval);
      logger.info(`[WORKERS] ${w.name} worker started (${w.interval}ms)`);
    } catch (err) {
      logger.error(`[WORKERS] ${w.name} worker failed to start: ${err.message}`);
    }
  }
}

// ── Graceful shutdown ───────────────────────────────────────
function shutdown(signal) {
  logger.info(`[SERVER] Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    logger.info('[SERVER] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => {
    logger.error('[SERVER] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Start ───────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  logger.info(`[SERVER] Trading Signal Bot v${process.env.npm_package_version || '2.1.0'} running on http://${HOST}:${PORT}`);
  logger.info(`[SERVER] Deployment target: ${config.DEPLOYMENT_TARGET}`);
  if (config.DEPLOYMENT_TARGET === 'vps') {
    startScheduler();
    startWorkers();
  }
});
