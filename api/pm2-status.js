// ============================================================
// PM2 Process Status API
// GET /api/pm2-status
// Returns real-time PM2 process list with status, memory, CPU,
// uptime, restarts, and log paths for all managed workers.
// Falls back to ecosystem config listing if PM2 is unavailable.
// ============================================================

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../lib/logger.js';
import { getWorkerGroup, groupWorkerNames } from '../lib/worker-catalog.js';

const ECOSYSTEM_PATH = path.join(process.cwd(), 'ecosystem.config.cjs');

/**
 * Parse the ecosystem config to extract all defined worker names.
 */
function getDefinedWorkers() {
  try {
    if (!fs.existsSync(ECOSYSTEM_PATH)) return [];
    const content = fs.readFileSync(ECOSYSTEM_PATH, 'utf8');
    const names = [];
    const regex = /name:\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      names.push(match[1]);
    }
    return names;
  } catch {
    return [];
  }
}

/**
 * Parse PM2 list JSON output into structured process objects.
 */
function parsePm2List(raw) {
  try {
    const lines = raw.trim().split('\n');
    // Find the JSON block (pm2 jlist outputs JSON, but pm2 list outputs table)
    // Try pm2 jlist format first
    const jlistMatch = raw.match(/\[[\s\S]*\]/);
    if (jlistMatch) {
      const processes = JSON.parse(jlistMatch[0]);
      return processes.map(p => ({
        pid: p.pid,
        name: p.name,
        status: p.pm2_env?.status || 'unknown',
        cpu: p.monit?.cpu ?? 0,
        memory: p.monit?.memory ?? 0,
        memoryFormatted: formatBytes(p.monit?.memory ?? 0),
        uptime: p.pm2_env?.pm_uptime ? Math.floor((Date.now() - new Date(p.pm2_env.pm_uptime).getTime()) / 1000) : 0,
        uptimeFormatted: formatUptime(p.pm2_env?.pm_uptime ? Math.floor((Date.now() - new Date(p.pm2_env.pm_uptime).getTime()) / 1000) : 0),
        restarts: p.pm2_env?.restart_time ?? 0,
        unstableRestarts: p.pm2_env?.unstable_restarts ?? 0,
        execMode: p.pm2_env?.exec_mode || 'fork',
        instances: p.pm2_env?.instances || 1,
        pmId: p.pm_id,
        script: p.pm2_env?.pm_exec_path || '',
        logFile: p.pm2_env?.pm_log_path || '',
        outLog: p.pm2_env?.pm_out_log_path || '',
        errorLog: p.pm2_env?.pm_err_log_path || '',
        created: p.pm2_env?.created_at ? new Date(p.pm2_env.created_at).toISOString() : null,
        group: getWorkerGroup(p.name),
      }));
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Get PM2 process list via `pm2 jlist` (JSON format).
 */
function getPm2Processes() {
  try {
    const raw = execSync('npx pm2 jlist --no-color 2>/dev/null || pm2 jlist --no-color 2>/dev/null', {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return parsePm2List(raw);
  } catch {
    return [];
  }
}

/**
 * Get PM2 daemon uptime.
 */
function getPm2DaemonUptime() {
  try {
    const raw = execSync('npx pm2 ping --no-color 2>/dev/null || pm2 ping --no-color 2>/dev/null', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (raw.includes('pong')) {
      return { alive: true, response: raw.trim() };
    }
    return { alive: false, response: raw.trim() };
  } catch {
    return { alive: false, response: null };
  }
}

/**
 * Get PM2 version.
 */
function getPm2Version() {
  try {
    const raw = execSync('npx pm2 --version --no-color 2>/dev/null || pm2 --version --no-color 2>/dev/null', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return raw.trim();
  } catch {
    return null;
  }
}

/**
 * Build a status summary from the process list.
 */
function buildSummary(processes, definedWorkers) {
  const running = processes.filter(p => p.status === 'online').length;
  const stopped = processes.filter(p => p.status === 'stopped').length;
  const errored = processes.filter(p => p.status === 'errored' || p.status === 'error').length;
  const launching = processes.filter(p => p.status === 'launching' || p.status === 'starting').length;
  const other = processes.filter(p => !['online', 'stopped', 'errored', 'error', 'launching', 'starting'].includes(p.status)).length;

  const totalMemory = processes.reduce((sum, p) => sum + p.memory, 0);
  const totalCpu = processes.reduce((sum, p) => sum + p.cpu, 0);

  // Find processes with high restarts or memory
  const warnings = [];
  for (const p of processes) {
    if (p.restarts > 5) {
      warnings.push({ name: p.name, issue: 'high_restarts', value: p.restarts });
    }
    if (p.memory > 300 * 1024 * 1024) {
      warnings.push({ name: p.name, issue: 'high_memory', value: formatBytes(p.memory) });
    }
    if (p.status === 'errored' || p.status === 'error') {
      warnings.push({ name: p.name, issue: 'errored', value: p.status });
    }
  }

  // Find missing workers (defined but not running)
  const runningNames = new Set(processes.map(p => p.name));
  const missing = definedWorkers.filter(name => !runningNames.has(name));

  return {
    total: processes.length,
    defined: definedWorkers.length,
    running,
    stopped,
    errored,
    launching,
    other,
    totalMemory,
    totalMemoryFormatted: formatBytes(totalMemory),
    totalCpu: Math.round(totalCpu * 10) / 10,
    warnings,
    missing,
    coveragePct: definedWorkers.length > 0
      ? Math.round((processes.length / definedWorkers.length) * 100)
      : 0,
    groups: groupWorkerNames(definedWorkers),
  };
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '0s';
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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const definedWorkers = getDefinedWorkers();
    const daemon = getPm2DaemonUptime();
    const version = getPm2Version();
    const processes = getPm2Processes();
    const summary = buildSummary(processes, definedWorkers);

    const result = {
      ok: daemon.alive,
      pm2: {
        version,
        daemonAlive: daemon.alive,
        daemonResponse: daemon.response,
      },
      summary,
      processes: processes.map(p => ({
        pmId: p.pmId,
        name: p.name,
        pid: p.pid,
        status: p.status,
        cpu: p.cpu,
        memory: p.memory,
        memoryFormatted: p.memoryFormatted,
        uptime: p.uptime,
        uptimeFormatted: p.uptimeFormatted,
        restarts: p.restarts,
        unstableRestarts: p.unstableRestarts,
        execMode: p.execMode,
        instances: p.instances,
        script: p.script,
        logFile: p.logFile,
        outLog: p.outLog,
        errorLog: p.errorLog,
        created: p.created,
        group: p.group,
      })),
      definedWorkers,
      timestamp: new Date().toISOString(),
    };

    return res.status(200).json(result);
  } catch (err) {
    logger.error(`[PM2-STATUS] error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
