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
    }
  ]
};
