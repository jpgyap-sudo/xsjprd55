// ============================================================
// Deploy Checker Worker — xsjprd55
// Checks GitHub latest commit vs VPS deployed commit,
// records result to deploy_history, sends Telegram alert.
// Run: node workers/deploy-checker.js
// Cron: */10 * * * * cd ~/xsjprd55 && node workers/deploy-checker.js
// ============================================================

import { execFileSync } from 'child_process';
import fetch from 'node-fetch';
import fs from 'fs';
import os from 'os';
import path from 'path';
import '../lib/env.js';

const VPS_IP = process.env.VPS_IP || '165.22.110.111';
const VPS_USER = process.env.VPS_USER || 'root';
const GITHUB_REPO = process.env.GITHUB_REPO || 'jpgyap-sudo/xsjprd55';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const API_BASE = process.env.API_BASE || process.env.APP_URL || `http://localhost:3000`;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SSH_TIMEOUT_MS = Number(process.env.DEPLOY_CHECK_SSH_TIMEOUT_MS || 15_000);
const HTTP_TIMEOUT_MS = Number(process.env.DEPLOY_CHECK_HTTP_TIMEOUT_MS || 10_000);
const DEFAULT_SSH_KEY = path.join(os.homedir(), '.ssh', 'id_ed25519_roo');
const VPS_SSH_KEY = process.env.VPS_SSH_KEY || (fs.existsSync(DEFAULT_SSH_KEY) ? DEFAULT_SSH_KEY : '');

function log(...args) {
  console.log(`[deploy-checker] ${new Date().toISOString()}`, ...args);
}

function sshCommand(cmd) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectionAttempts=1',
    '-o', 'ConnectTimeout=8',
    '-o', 'ServerAliveInterval=5',
    '-o', 'ServerAliveCountMax=1',
    '-o', 'StrictHostKeyChecking=accept-new',
  ];

  if (VPS_SSH_KEY) args.push('-i', VPS_SSH_KEY);

  args.push(`${VPS_USER}@${VPS_IP}`, cmd);

  return execFileSync('ssh', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: SSH_TIMEOUT_MS,
  }).trim();
}

async function getGithubLatestCommit() {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'xsjprd55-deploy-checker'
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    return {
      sha: data.sha,
      date: data.commit?.committer?.date || null,
      message: data.commit?.message?.split('\n')[0] || ''
    };
  } catch (e) {
    log('GitHub fetch failed:', e.message);
    return null;
  }
}

async function getVpsCommit() {
  try {
    const sha = sshCommand('cd ~/xsjprd55 && git rev-parse HEAD');
    const date = sshCommand('cd ~/xsjprd55 && git log -1 --format=%cI');
    return { sha, date };
  } catch (e) {
    log('VPS commit fetch failed:', e.message);
    return null;
  }
}

async function getVpsHealth() {
  try {
    const output = sshCommand(`curl -sf --max-time 8 http://localhost:3000/api/health && echo 'OK' || echo 'FAIL'`);
    return output.includes('OK');
  } catch (e) {
    return false;
  }
}

async function getVpsPm2Status() {
  try {
    const output = sshCommand('pm2 jlist');
    const list = JSON.parse(output);
    return list.map(p => ({
      name: p.name,
      status: p.pm2_env?.status,
      uptime: p.pm2_env?.pm_uptime,
      memory: p.monit?.memory,
      cpu: p.monit?.cpu
    }));
  } catch (e) {
    log('PM2 status fetch failed:', e.message);
    return [];
  }
}

async function recordDeployStatus(payload) {
  try {
    const res = await fetch(`${API_BASE}/api/deploy-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    log('Recorded deploy status:', data.deploy.id);
    return data.deploy;
  } catch (e) {
    log('Failed to record deploy status:', e.message);
    return null;
  }
}

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
  } catch (e) {
    log('Telegram send failed:', e.message);
  }
}

async function main() {
  log('Starting deploy check...');
  const startedAt = new Date().toISOString();

  const gh = await getGithubLatestCommit();
  const vps = await getVpsCommit();
  const healthOk = await getVpsHealth();
  const pm2 = await getVpsPm2Status();

  let status = 'unknown';
  let errorMsg = null;

  if (!gh || !vps) {
    status = 'failed';
    errorMsg = !gh ? 'Could not reach GitHub API' : 'Could not reach VPS via SSH';
  } else if (gh.sha === vps.sha) {
    status = 'synced';
  } else {
    status = 'behind';
    errorMsg = `VPS is behind GitHub. GH: ${gh.sha.slice(0, 8)}, VPS: ${vps.sha.slice(0, 8)}`;
  }

  if (!healthOk && status !== 'failed') {
    errorMsg = (errorMsg ? errorMsg + '; ' : '') + 'Health check failed';
    status = 'failed';
  }

  const payload = {
    github_commit: gh?.sha || null,
    github_commit_date: gh?.date || null,
    vps_commit: vps?.sha || null,
    vps_commit_date: vps?.date || null,
    status,
    error_message: errorMsg,
    deploy_started_at: startedAt,
    deploy_finished_at: new Date().toISOString(),
    health_check_ok: healthOk,
    pm2_status: pm2
  };

  await recordDeployStatus(payload);

  // Telegram alert on issues
  if (status !== 'synced') {
    const emoji = status === 'failed' ? '🔴' : '🟡';
    const msg = `${emoji} *Deploy Check: ${status.toUpperCase()}*\n\n` +
      `*GitHub:* \`${gh?.sha?.slice(0, 8) || 'N/A'}\`\n` +
      `*VPS:* \`${vps?.sha?.slice(0, 8) || 'N/A'}\`\n` +
      `*Health:* ${healthOk ? '✅ OK' : '❌ FAIL'}\n` +
      `*Time:* ${new Date().toISOString()}\n\n` +
      (errorMsg ? `*Error:* ${errorMsg}` : '');
    await sendTelegram(msg);
  }

  log('Deploy check complete. Status:', status);
  process.exit(status === 'synced' ? 0 : 1);
}

main().catch(e => {
  console.error('[deploy-checker] Fatal error:', e);
  process.exit(1);
});
