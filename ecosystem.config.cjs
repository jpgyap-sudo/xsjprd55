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
    }
  ]
};
