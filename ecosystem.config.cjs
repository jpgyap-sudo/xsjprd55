// ============================================================
// PM2 Ecosystem Config — VPS Process Management (OPTIMIZED)
//
// Previously: 30 always-running workers consuming 30+ Node.js
// processes on a 1 vCPU / 2GB RAM droplet.
//
// Now: 3 processes total.
//   1. trading-signal-bot  — Express server (API + WebSocket)
//   2. orchestrator        — Single process running ALL cyclical
//      background tasks on staggered schedules
//   3. deploy-checker      — Cron-based deploy checker (kept
//      separate because it needs to run even if orchestrator
//      is busy)
//
// All debug/dev workers are now on-demand via:
//   POST /api/run-worker/:taskName
//
// Docs: https://pm2.keymetrics.io/docs/usage/application-declaration/
// ============================================================

module.exports = {
  apps: [
    // ── 1. Main Express Server ──────────────────────────────
    {
      name: 'trading-signal-bot',
      script: './server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: true,
      max_memory_restart: '512M',
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      listen_timeout: 10000,
      pmx: true,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },

    // ── 2. Orchestrator (replaces 28 workers) ────────────────
    {
      name: 'orchestrator',
      script: './workers/orchestrator-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps',

        // ── Trading ──
        ENABLE_MOCK_TRADING_WORKER: 'true',
        MOCK_TRADING_INTERVAL_MS: '60000',
        AGGRESSIVE_MOCK_INTERVAL_MS: '120000',
        PERPETUAL_TRADER_INTERVAL_SECONDS: '60',
        ENABLE_STRATEGY_MONITOR_WORKER: 'true',

        // ── Data Feeds ──
        NEWS_INGEST_INTERVAL_SECONDS: '180',
        NEWS_INGEST_MAX_AGE_MINUTES: '720',
        ENABLE_SOCIAL_CRAWLER_WORKER: 'true',
        WALLET_TRACKER_INTERVAL_MS: '300000',

        // ── Learning ──
        LEARNING_INTERVAL_HOURS: '6',
        TLL_ENABLED: 'true',
        TLL_INTERVAL_MS: '1800000',
        BRAIN_LEARNING_INTERVAL_MS: '86400000',
        ENABLE_SIMULATION_LEARNING: 'true',
        SIMULATION_LEARNING_INTERVAL_MS: '1800000',
        ENABLE_CONTINUOUS_BACKTESTER: 'true',

        // ── Brain ──
        BRAIN_SCAN_INTERVAL_MS: '300000',
        BRAIN_SYMBOLS: 'BTCUSDT,ETHUSDT',
        BRAIN_TIMEFRAMES: '15m,1h,4h',
        BRAIN_LIVE_MODE: 'false',

        // ── Maintenance ──
        ENABLE_NOTIFICATION_WORKER: 'true',

        // ── TLL Notifications ──
        TLL_NOTIFY_ENABLED: 'true',
        TLL_NOTIFY_INTERVAL_MS: '300000',

        // ── Research ──
        ENABLE_RESEARCH_AGENT: 'true'
      },
      autorestart: true,
      max_memory_restart: '512M',
      log_file: './logs/orchestrator-combined.log',
      out_file: './logs/orchestrator-out.log',
      error_file: './logs/orchestrator-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 10000,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s'
    },

    // ── 3. Deploy Checker (cron-based, kept separate) ────────
    {
      name: 'deploy-checker',
      script: './workers/deploy-checker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: false,
      cron_restart: '*/10 * * * *',
      max_memory_restart: '128M',
      log_file: './logs/deploy-checker-combined.log',
      out_file: './logs/deploy-checker-out.log',
      error_file: './logs/deploy-checker-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 3,
      min_uptime: '1s'
    }
  ]
};
