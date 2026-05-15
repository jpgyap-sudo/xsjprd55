// ============================================================
// PM2 Restart API — Fix corrupted PM2 daemon via HTTP
// POST /api/pm2-restart
// Runs: pm2 update && pm2 save && pm2 restart ecosystem.config.cjs
// ============================================================
import { execSync } from 'child_process';
import { logger } from '../lib/logger.js';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed. Use POST.' });
  }

  // Require secret for safety
  const secret = req.headers['x-api-secret'] || req.query.secret;
  const expected = process.env.API_SECRET || process.env.SECRET_KEY;
  if (expected && secret !== expected) {
    return res.status(401).json({ ok: false, error: 'Unauthorized. Provide x-api-secret header or ?secret= query param.' });
  }

  const results = { steps: [], errors: [] };
  const started = Date.now();

  try {
    // Step 1: pm2 update (fix daemon corruption)
    logger.info('[PM2-RESTART] Running pm2 update...');
    try {
      const updateOut = execSync('npx pm2 update 2>&1', {
        timeout: 30000,
        cwd: process.cwd(),
        env: { ...process.env, PATH: process.env.PATH }
      }).toString();
      results.steps.push({ step: 'pm2 update', output: updateOut.slice(0, 2000) });
      logger.info(`[PM2-RESTART] pm2 update OK`);
    } catch (e) {
      const errMsg = e.stdout?.toString() || e.message || 'unknown';
      results.errors.push({ step: 'pm2 update', error: errMsg.slice(0, 1000) });
      logger.error(`[PM2-RESTART] pm2 update failed: ${errMsg}`);
    }

    // Step 2: pm2 save
    logger.info('[PM2-RESTART] Running pm2 save...');
    try {
      const saveOut = execSync('npx pm2 save 2>&1', {
        timeout: 15000,
        cwd: process.cwd(),
        env: { ...process.env, PATH: process.env.PATH }
      }).toString();
      results.steps.push({ step: 'pm2 save', output: saveOut.slice(0, 1000) });
      logger.info(`[PM2-RESTART] pm2 save OK`);
    } catch (e) {
      const errMsg = e.stdout?.toString() || e.message || 'unknown';
      results.errors.push({ step: 'pm2 save', error: errMsg.slice(0, 1000) });
      logger.error(`[PM2-RESTART] pm2 save failed: ${errMsg}`);
    }

    // Step 3: pm2 restart ecosystem.config.cjs
    logger.info('[PM2-RESTART] Running pm2 restart ecosystem.config.cjs...');
    try {
      const restartOut = execSync('npx pm2 restart ecosystem.config.cjs 2>&1', {
        timeout: 60000,
        cwd: process.cwd(),
        env: { ...process.env, PATH: process.env.PATH }
      }).toString();
      results.steps.push({ step: 'pm2 restart ecosystem', output: restartOut.slice(0, 2000) });
      logger.info(`[PM2-RESTART] pm2 restart OK`);
    } catch (e) {
      const errMsg = e.stdout?.toString() || e.message || 'unknown';
      results.errors.push({ step: 'pm2 restart', error: errMsg.slice(0, 1000) });
      logger.error(`[PM2-RESTART] pm2 restart failed: ${errMsg}`);
    }

    // Step 4: Verify PM2 status
    logger.info('[PM2-RESTART] Verifying PM2 status...');
    try {
      const statusOut = execSync('npx pm2 jlist 2>&1', {
        timeout: 10000,
        cwd: process.cwd(),
        env: { ...process.env, PATH: process.env.PATH }
      }).toString();
      const processes = JSON.parse(statusOut);
      results.steps.push({
        step: 'pm2 status',
        running: processes.filter(p => p.pm2_env?.status === 'online').length,
        total: processes.length,
        processes: processes.map(p => ({
          name: p.name,
          status: p.pm2_env?.status,
          pid: p.pid,
          uptime: p.pm2_env?.pm_uptime ? Math.floor((Date.now() - new Date(p.pm2_env.pm_uptime).getTime()) / 1000) + 's' : 'N/A'
        }))
      });
      logger.info(`[PM2-RESTART] PM2 status: ${results.steps[results.steps.length - 1].running}/${results.steps[results.steps.length - 1].total} running`);
    } catch (e) {
      results.errors.push({ step: 'pm2 status', error: e.message });
    }

    const duration = Date.now() - started;
    const ok = results.errors.length === 0;

    logger.info(`[PM2-RESTART] Complete in ${duration}ms — ${ok ? 'ALL OK' : results.errors.length + ' errors'}`);

    return res.status(ok ? 200 : 500).json({
      ok,
      duration_ms: duration,
      steps: results.steps,
      errors: results.errors,
      message: ok
        ? 'PM2 daemon fixed and all workers restarted successfully'
        : `PM2 restart completed with ${results.errors.length} errors — check details`
    });
  } catch (e) {
    logger.error(`[PM2-RESTART] Fatal: ${e.message}`);
    return res.status(500).json({
      ok: false,
      error: e.message,
      steps: results.steps,
      errors: results.errors
    });
  }
}
