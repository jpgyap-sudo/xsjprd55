// ============================================================
// PM2 Log Rotate Setup
// Configures pm2-logrotate for automatic log rotation.
// Run: pm2 start scripts/pm2-logrotate-setup.js --no-autorestart
// Or: node scripts/pm2-logrotate-setup.js
// ============================================================

const { execSync } = require('child_process');

const config = {
  // Max size of a log file before rotation (10MB)
  max_size: '10M',
  // Retain 10 rotated files per worker
  retain: 10,
  // Compress rotated logs with gzip
  compress: true,
  // Rotate every 6 hours regardless of size
  rotateInterval: '0 */6 * * *',
  // Rotate on process exit too
  rotateModule: true,
  // UTC time for log timestamps
  dateFormat: 'YYYY-MM-DD_HH-mm-ss',
  // Worker interval to check log sizes (30s)
  workerInterval: 30,
};

console.log('Configuring pm2-logrotate...');

try {
  for (const [key, value] of Object.entries(config)) {
    const cmd = `pm2 set pm2-logrotate:${key} ${value}`;
    console.log(`  ${cmd}`);
    execSync(cmd, { stdio: 'pipe' });
  }
  console.log('\n✅ pm2-logrotate configured successfully');
  console.log('Current config:');
  const result = execSync('pm2 conf pm2-logrotate', { stdio: 'pipe', encoding: 'utf8' });
  console.log(result);
} catch (err) {
  console.error('❌ Failed to configure pm2-logrotate:', err.message);
  process.exit(1);
}
