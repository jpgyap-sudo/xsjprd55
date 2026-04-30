// ============================================================
// PM2 Ecosystem Config — VPS Process Management
// Docs: https://pm2.keymetrics.io/docs/usage/application-declaration/
// ============================================================

module.exports = {
  apps: [
    {
      name: 'trading-signal-bot',
      script: './server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      // Auto-restart on crash
      autorestart: true,
      // Max memory before restart
      max_memory_restart: '512M',
      // Log files
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      // Monitoring
      pmx: true,
      // Restart delay
      restart_delay: 3000,
      // Max restarts within 60s before marked as errored
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'diagnostic-agent',
      script: './workers/diagnostic-agent.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/diag-combined.log',
      out_file: './logs/diag-out.log',
      error_file: './logs/diag-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'social-news-worker',
      script: './workers/social-news-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/social-combined.log',
      out_file: './logs/social-out.log',
      error_file: './logs/social-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'debug-crawler',
      script: './workers/debug-crawler-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/debug-crawler-combined.log',
      out_file: './logs/debug-crawler-out.log',
      error_file: './logs/debug-crawler-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'api-debugger',
      script: './workers/api-debugger-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/api-debugger-combined.log',
      out_file: './logs/api-debugger-out.log',
      error_file: './logs/api-debugger-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'mock-trading-worker',
      script: './workers/mock-trading-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps',
        ENABLE_MOCK_TRADING_WORKER: 'true'
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/mock-trading-combined.log',
      out_file: './logs/mock-trading-out.log',
      error_file: './logs/mock-trading-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'execution-worker',
      script: './workers/execution-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/execution-combined.log',
      out_file: './logs/execution-out.log',
      error_file: './logs/execution-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'signal-generator-worker',
      script: './workers/signal-generator-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/signal-gen-combined.log',
      out_file: './logs/signal-gen-out.log',
      error_file: './logs/signal-gen-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'research-agent-worker',
      script: './workers/research-agent-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/research-agent-combined.log',
      out_file: './logs/research-agent-out.log',
      error_file: './logs/research-agent-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'capability-consolidator',
      script: './workers/capability-consolidator-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/capability-consolidator-combined.log',
      out_file: './logs/capability-consolidator-out.log',
      error_file: './logs/capability-consolidator-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'liquidation-intel-worker',
      script: './workers/liquidation-intel-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/liq-intel-combined.log',
      out_file: './logs/liq-intel-out.log',
      error_file: './logs/liq-intel-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'continuous-backtester',
      script: './workers/continuous-backtester.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/backtester-combined.log',
      out_file: './logs/backtester-out.log',
      error_file: './logs/backtester-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'aggressive-mock-worker',
      script: './workers/aggressive-mock-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps',
        ENABLE_MOCK_TRADING_WORKER: 'true',
        ENABLE_TV_TA_SCAN: 'true'
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/aggressive-mock-combined.log',
      out_file: './logs/aggressive-mock-out.log',
      error_file: './logs/aggressive-mock-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'news-ingest-worker',
      script: './workers/news-ingest-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps',
        NEWS_INGEST_INTERVAL_SECONDS: 180
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/news-ingest-combined.log',
      out_file: './logs/news-ingest-out.log',
      error_file: './logs/news-ingest-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'perpetual-trader-worker',
      script: './workers/perpetual-trader-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps',
        PERPETUAL_TRADER_INTERVAL_SECONDS: 60
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/perp-trader-combined.log',
      out_file: './logs/perp-trader-out.log',
      error_file: './logs/perp-trader-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'bug-fix-pipeline',
      script: './workers/bug-fix-pipeline-worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: true,
      max_memory_restart: '256M',
      log_file: './logs/bug-fix-pipeline-combined.log',
      out_file: './logs/bug-fix-pipeline-out.log',
      error_file: './logs/bug-fix-pipeline-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'secretary',
      script: './scripts/secretary.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT_TARGET: 'vps'
      },
      autorestart: true,
      max_memory_restart: '128M',
      log_file: './logs/secretary-combined.log',
      out_file: './logs/secretary-out.log',
      error_file: './logs/secretary-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
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
