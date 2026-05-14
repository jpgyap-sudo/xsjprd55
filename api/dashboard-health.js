// ============================================================
// Dashboard Health — /api/dashboard-health
// Returns a lightweight health summary for the dashboard
// Used by the frontend to verify the dashboard itself is healthy
// ============================================================

import { config } from '../lib/config.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const health = {
      ok: true,
      status: 'healthy',
      uptime: process.uptime(),
      uptimeFormatted: formatUptime(process.uptime()),
      nodeVersion: process.version,
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
      environment: {
        ai_provider: config.AI_PROVIDER || 'not set',
        trading_mode: config.TRADING_MODE || 'paper',
        deployment_target: config.DEPLOYMENT_TARGET || 'local',
      },
      apiCount: await getApiCount(),
    };

    return res.status(200).json(health);
  } catch (e) {
    console.error('[dashboard-health] Error:', e);
    return res.status(200).json({ ok: true, status: 'degraded', error: e.message });
  }
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

async function getApiCount() {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const apiDir = path.join(process.cwd(), 'api');
    if (!fs.existsSync(apiDir)) return 0;
    const entries = fs.readdirSync(apiDir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.js')) {
        count++;
      } else if (entry.isDirectory()) {
        const subDir = path.join(apiDir, entry.name);
        const subFiles = fs.readdirSync(subDir);
        count += subFiles.filter(f => f.endsWith('.js')).length;
      }
    }
    return count;
  } catch {
    return 0;
  }
}
