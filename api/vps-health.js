import os from 'os';
import { execSync } from 'child_process';
import { supabase } from '../lib/supabase.js';
import { getWorkerGroup } from '../lib/worker-catalog.js';

function safeExec(command) {
  try {
    return execSync(command, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function getPm2Snapshot() {
  const raw = safeExec('npx pm2 jlist --no-color 2>/dev/null || pm2 jlist --no-color 2>/dev/null');
  if (!raw) return { processes: [], summary: null };
  try {
    const processes = JSON.parse(raw).map((p) => ({
      name: p.name,
      group: getWorkerGroup(p.name),
      status: p.pm2_env?.status || 'unknown',
      restarts: p.pm2_env?.restart_time || 0,
      memory: p.monit?.memory || 0,
      cpu: p.monit?.cpu || 0,
    }));
    return {
      processes,
      summary: {
        total: processes.length,
        online: processes.filter((p) => p.status === 'online').length,
        errored: processes.filter((p) => p.status === 'errored' || p.status === 'error').length,
        stopped: processes.filter((p) => p.status === 'stopped').length,
        totalMemory: processes.reduce((sum, p) => sum + p.memory, 0),
      },
    };
  } catch {
    return { processes: [], summary: null };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const [heartbeatRows, latestDeploy] = await Promise.all([
    supabase.from('worker_heartbeats').select('*'),
    supabase.from('deploy_history').select('*').order('checked_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const pm2 = getPm2Snapshot();
  const heartbeats = (heartbeatRows.data || []).map((row) => ({
    workerName: row.worker_name,
    group: getWorkerGroup(row.worker_name),
    status: row.status,
    lastCycleAt: row.last_cycle_at,
    ageMinutes: row.last_cycle_at ? Math.round((Date.now() - new Date(row.last_cycle_at).getTime()) / 60000) : null,
  }));

  return res.status(200).json({
    ok: true,
    host: {
      hostname: os.hostname(),
      uptimeSeconds: os.uptime(),
      loadAvg: os.loadavg(),
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      platform: os.platform(),
      release: os.release(),
    },
    pm2,
    workers: {
      ready: !heartbeatRows.error,
      error: heartbeatRows.error?.message || null,
      totalHeartbeatRows: heartbeats.length,
      stale: heartbeats.filter((h) => h.ageMinutes == null || h.ageMinutes > 10),
      heartbeats,
    },
    latestDeploy: latestDeploy.data || null,
    latestDeployError: latestDeploy.error?.message || null,
    shell: {
      diskRoot: safeExec("df -h / | tail -1"),
      swap: safeExec("swapon --show --noheadings"),
    },
    ts: new Date().toISOString(),
  });
}
