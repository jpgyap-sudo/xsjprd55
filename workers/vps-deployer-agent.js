#!/usr/bin/env node
// ============================================================
// VPS Deployer Agent v2.0 — Auto-Deploy with Change Tracking
// Tracks every bug fix, update, auto-deploys on every commit
// Full permission to control VPS node
// Usage:
//   node workers/vps-deployer-agent.js              # Check & auto-deploy if needed
//   node workers/vps-deployer-agent.js --status     # View deployment status
//   node workers/vps-deployer-agent.js --rollback   # Rollback to previous
//   node workers/vps-deployer-agent.js --history    # View deploy history
//   node workers/vps-deployer-agent.js --force      # Force deploy current commit
// Cron: */2 * * * * cd ~/xsjprd55 && node workers/vps-deployer-agent.js
// ============================================================

import { execFileSync, spawn } from 'child_process';
import fetch from 'node-fetch';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import '../lib/env.js';

const VPS_IP = process.env.VPS_IP || '165.22.110.111';
const VPS_USER = process.env.VPS_USER || 'root';
const VPS_PROJECT_PATH = process.env.VPS_PROJECT_PATH || '~/xsjprd55';
const GITHUB_REPO = process.env.GITHUB_REPO || 'jpgyap-sudo/xsjprd55';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''; // Optional, for higher rate limits
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

// Auto-deploy config
const ENABLE_AUTO_DEPLOY = process.env.ENABLE_AUTO_DEPLOY === 'true';
const AUTO_DEPLOY_INTERVAL_MINUTES = Number(process.env.AUTO_DEPLOY_INTERVAL_MINUTES || 2);
const MAINTENANCE_START_HOUR = Number(process.env.DEPLOY_MAINTENANCE_START_HOUR || 23);
const MAINTENANCE_END_HOUR = Number(process.env.DEPLOY_MAINTENANCE_END_HOUR || 6);
const MAX_CONSECUTIVE_FAILURES = 2;

// SSH config
const SSH_TIMEOUT_MS = Number(process.env.DEPLOY_SSH_TIMEOUT_MS || 30_000);
const HTTP_TIMEOUT_MS = Number(process.env.DEPLOY_HTTP_TIMEOUT_MS || 15_000);
const DEFAULT_SSH_KEY = path.join(os.homedir(), '.ssh', 'id_ed25519');
const VPS_SSH_KEY = process.env.VPS_SSH_KEY || (fs.existsSync(DEFAULT_SSH_KEY) ? DEFAULT_SSH_KEY : '');

// Initialize Supabase
const supabase = (SUPABASE_URL && SUPABASE_KEY) 
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// State tracking
const state = {
  consecutiveFailures: 0,
  lastDeployStatus: null,
  changes: [],
  affectedWorkers: new Set(),
  isMaintenanceWindow: false
};

function log(...args) {
  console.log(`[VPS-DEPLOYER] ${new Date().toISOString()}`, ...args);
}

function error(...args) {
  console.error(`[VPS-DEPLOYER] ${new Date().toISOString()} ERROR:`, ...args);
}

// ── SSH Command Execution ───────────────────────────────────
function sshCommand(cmd, timeout = SSH_TIMEOUT_MS) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectionAttempts=2',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=5',
    '-o', 'ServerAliveCountMax=2',
    '-o', 'StrictHostKeyChecking=accept-new',
  ];

  if (VPS_SSH_KEY) args.push('-i', VPS_SSH_KEY);
  args.push(`${VPS_USER}@${VPS_IP}`, cmd);

  return execFileSync('ssh', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: timeout,
  }).trim();
}

// ── Execute Remote Command with Live Output ─────────────────
function sshCommandStream(cmd, onData) {
  return new Promise((resolve, reject) => {
    const args = [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
    ];
    if (VPS_SSH_KEY) args.push('-i', VPS_SSH_KEY);
    args.push(`${VPS_USER}@${VPS_IP}`, cmd);

    const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
      const str = data.toString();
      output += str;
      if (onData) onData(str);
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`SSH command failed with code ${code}: ${errorOutput}`));
      }
    });

    child.on('error', reject);
  });
}

// ── GitHub API ──────────────────────────────────────────────
async function getGithubLatestCommit() {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`;
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'xsjprd55-deployer-agent'
    };
    if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

    const res = await fetch(url, { 
      headers,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    return {
      sha: data.sha,
      date: data.commit?.committer?.date || null,
      message: data.commit?.message?.split('\n')[0] || '',
      author: data.commit?.author?.name || '',
      files_changed: data.files?.map(f => f.filename) || []
    };
  } catch (e) {
    error('GitHub fetch failed:', e.message);
    return null;
  }
}

async function getGithubCommitsSince(sha) {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/commits?sha=${GITHUB_BRANCH}&since=${encodeURIComponent(sha)}`;
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'xsjprd55-deployer-agent'
    };
    if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

    const res = await fetch(url, { 
      headers,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    return await res.json();
  } catch (e) {
    error('GitHub commits fetch failed:', e.message);
    return [];
  }
}

async function getGithubCommitFiles(sha) {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/commits/${sha}`;
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'xsjprd55-deployer-agent'
    };
    if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

    const res = await fetch(url, { 
      headers,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    return data.files?.map(f => ({
      filename: f.filename,
      status: f.status,
      changes: f.changes,
      additions: f.additions,
      deletions: f.deletions
    })) || [];
  } catch (e) {
    error('GitHub commit files fetch failed:', e.message);
    return [];
  }
}

// ── VPS Operations ──────────────────────────────────────────
function getVpsCommit() {
  try {
    const sha = sshCommand(`cd ${VPS_PROJECT_PATH} && git rev-parse HEAD`);
    const date = sshCommand(`cd ${VPS_PROJECT_PATH} && git log -1 --format=%cI`);
    const msg = sshCommand(`cd ${VPS_PROJECT_PATH} && git log -1 --format=%s`);
    return { sha, date, message: msg };
  } catch (e) {
    error('VPS commit fetch failed:', e.message);
    return null;
  }
}

function getVpsHealth() {
  try {
    const output = sshCommand(`curl -sf --max-time 8 http://localhost:3000/api/health && echo 'OK' || echo 'FAIL'`);
    return output.includes('OK');
  } catch (e) {
    return false;
  }
}

function getVpsPm2Status() {
  try {
    const output = sshCommand('pm2 jlist');
    const list = JSON.parse(output);
    return list.map(p => ({
      name: p.name,
      status: p.pm2_env?.status,
      uptime: p.pm2_env?.pm_uptime,
      restart_time: p.pm2_env?.restart_time,
      unstable_restarts: p.pm2_env?.unstable_restarts,
      memory: p.monit?.memory,
      cpu: p.monit?.cpu
    }));
  } catch (e) {
    error('PM2 status fetch failed:', e.message);
    return [];
  }
}

// ── Change Categorization ───────────────────────────────────
function categorizeChange(filename) {
  if (filename.endsWith('.sql')) return 'schema';
  if (filename.startsWith('workers/')) return 'worker';
  if (filename.startsWith('api/')) return 'api';
  if (filename.startsWith('lib/')) return 'library';
  if (filename === 'package.json' || filename === 'package-lock.json') return 'dependency';
  if (filename.endsWith('.md')) return 'docs';
  if (filename.includes('test')) return 'test';
  if (filename.startsWith('.github/')) return 'ci';
  if (filename === '.env.example') return 'config';
  return 'other';
}

function getAffectedWorkers(files) {
  const workers = new Set();
  for (const f of files) {
    if (f.filename.startsWith('workers/')) {
      const workerName = f.filename.split('/')[1].replace('.js', '');
      workers.add(workerName);
    }
    // Also restart workers if lib/ files change (shared code)
    if (f.filename.startsWith('lib/') || f.filename === 'package.json') {
      workers.add('all');
    }
  }
  return Array.from(workers);
}

function isSchemaChange(files) {
  return files.some(f => f.filename.endsWith('.sql'));
}

// ── Deployment History ──────────────────────────────────────
async function recordDeployment(record) {
  if (!supabase) {
    log('Supabase not configured, skipping deploy history record');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('deploy_history')
      .insert(record)
      .select()
      .single();

    if (error) throw error;
    log('Recorded deployment:', data.id);
    return data;
  } catch (e) {
    error('Failed to record deployment:', e.message);
    return null;
  }
}

async function getLastDeployment() {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('deploy_history')
      .select('*')
      .order('deployed_at', { ascending: false })
      .limit(1)
      .single();

    if (error) return null;
    return data;
  } catch (e) {
    return null;
  }
}

async function getDeploymentHistory(limit = 10) {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('deploy_history')
      .select('*')
      .order('deployed_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (e) {
    error('Failed to fetch deployment history:', e.message);
    return [];
  }
}

async function updateDeploymentStatus(id, updates) {
  if (!supabase) return;

  try {
    await supabase
      .from('deploy_history')
      .update(updates)
      .eq('id', id);
  } catch (e) {
    error('Failed to update deployment status:', e.message);
  }
}

// ── Telegram Notifications ──────────────────────────────────
async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) return;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_ADMIN_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
  } catch (e) {
    error('Telegram send failed:', e.message);
  }
}

// ── Maintenance Window Check ────────────────────────────────
function isInMaintenanceWindow() {
  const hour = new Date().getHours();
  if (MAINTENANCE_START_HOUR > MAINTENANCE_END_HOUR) {
    // Overnight window (e.g., 23:00 - 06:00)
    return hour >= MAINTENANCE_START_HOUR || hour < MAINTENANCE_END_HOUR;
  }
  return hour >= MAINTENANCE_START_HOUR && hour < MAINTENANCE_END_HOUR;
}

// ── Pre-Deploy Checks ───────────────────────────────────────
async function runPreDeployChecks() {
  const checks = {
    healthOk: getVpsHealth(),
    pm2Status: getVpsPm2Status(),
    consecutiveFailures: state.consecutiveFailures
  };

  // Check if too many recent failures
  if (checks.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    throw new Error(`Too many consecutive failures (${checks.consecutiveFailures}). Manual intervention required.`);
  }

  // Check if health is failing
  if (!checks.healthOk) {
    throw new Error('VPS health check is currently failing. Aborting auto-deploy.');
  }

  return checks;
}

// ── Deployment ──────────────────────────────────────────────
async function performDeployment(githubCommit, vpsCommit, files) {
  const deployId = Date.now();
  const deployLog = [];
  const startedAt = new Date().toISOString();

  log('='.repeat(60));
  log('STARTING AUTO-DEPLOYMENT');
  log('='.repeat(60));
  log('From:', vpsCommit.sha.slice(0, 8));
  log('To:', githubCommit.sha.slice(0, 8));
  log('Files changed:', files.length);
  log('Maintenance window:', state.isMaintenanceWindow ? 'YES' : 'NO');
  log('='.repeat(60));

  // Record deployment start
  const deployRecord = {
    commit_sha: githubCommit.sha,
    commit_message: githubCommit.message,
    commit_author: githubCommit.author,
    deploy_status: 'pending',
    vps_ip: VPS_IP,
    previous_commit: vpsCommit.sha,
    files_changed: files.map(f => f.filename),
    deployed_at: startedAt
  };

  const recorded = await recordDeployment(deployRecord);
  const deployHistoryId = recorded?.id;

  try {
    // Step 1: Create backup
    log('\n[1/6] Creating backup...');
    const backupCmd = `cd ${VPS_PROJECT_PATH} && \
      cp .env .env.backup.$(date +%Y%m%d_%H%M%S) && \
      git stash && \
      git rev-parse HEAD > .last-known-good-commit`;
    sshCommand(backupCmd);
    deployLog.push('✓ Backup created');

    // Step 2: Git pull
    log('\n[2/6] Pulling latest code...');
    const pullOutput = [];
    await sshCommandStream(
      `cd ${VPS_PROJECT_PATH} && git fetch origin && git reset --hard origin/${GITHUB_BRANCH}`,
      (data) => {
        pullOutput.push(data);
        process.stdout.write(data);
      }
    );
    deployLog.push('✓ Code pulled from GitHub');

    // Step 3: Install dependencies if needed
    if (files.some(f => f.filename === 'package.json' || f.filename === 'package-lock.json')) {
      log('\n[3/6] Installing dependencies...');
      const npmOutput = [];
      await sshCommandStream(
        `cd ${VPS_PROJECT_PATH} && npm install --production`,
        (data) => {
          npmOutput.push(data);
          process.stdout.write(data);
        }
      );
      deployLog.push('✓ Dependencies installed');
    } else {
      deployLog.push('⊘ Dependencies unchanged');
    }

    // Step 4: Run schema migrations if SQL files changed
    if (isSchemaChange(files)) {
      log('\n[4/6] ⚠️  SQL schema changes detected!');
      log('      Manual approval required for database migrations.');
      deployLog.push('⚠ Schema migrations require manual approval');
      
      await sendTelegram(`⚠️ *Schema Changes Detected*\n\nCommit: \`${githubCommit.sha.slice(0, 8)}\`\n\nSQL files changed. Manual migration required.`);
      
      // Mark as requiring manual action
      await updateDeploymentStatus(deployHistoryId, {
        deploy_status: 'pending_manual',
        deploy_log: deployLog.join('\n')
      });
      
      return { success: false, manualApprovalRequired: true };
    } else {
      deployLog.push('⊘ No schema changes');
    }

    // Step 5: PM2 reload
    log('\n[5/6] Reloading PM2 processes...');
    const affectedWorkers = getAffectedWorkers(files);
    
    if (affectedWorkers.includes('all')) {
      // Restart all workers
      sshCommand('pm2 reload all');
      deployLog.push('✓ All workers reloaded');
    } else if (affectedWorkers.length > 0) {
      // Restart only affected workers
      for (const worker of affectedWorkers) {
        try {
          sshCommand(`pm2 reload ${worker}`);
          deployLog.push(`✓ Worker ${worker} reloaded`);
        } catch (e) {
          deployLog.push(`✗ Worker ${worker} reload failed: ${e.message}`);
        }
      }
    } else {
      deployLog.push('⊘ No workers affected');
    }

    // Step 6: Health check
    log('\n[6/6] Running health checks...');
    await new Promise(r => setTimeout(r, 5000)); // Wait for workers to stabilize
    
    const healthOk = getVpsHealth();
    const pm2Status = getVpsPm2Status();
    const failedProcesses = pm2Status.filter(p => p.status !== 'online');

    if (!healthOk || failedProcesses.length > 0) {
      throw new Error(`Health check failed. Health: ${healthOk}, Failed processes: ${failedProcesses.map(p => p.name).join(', ')}`);
    }

    deployLog.push('✓ Health checks passed');
    deployLog.push(`✓ All ${pm2Status.length} processes online`);

    // Success!
    const finishedAt = new Date().toISOString();
    await updateDeploymentStatus(deployHistoryId, {
      deploy_status: 'success',
      deploy_log: deployLog.join('\n'),
      health_check_passed: true,
      pm2_restarted: true
    });

    // Reset failure counter
    state.consecutiveFailures = 0;

    // Send success notification
    const summaryMsg = `✅ *Auto-Deploy Successful*\n\n` +
      `*Commit:* \`${githubCommit.sha.slice(0, 8)}\`\n` +
      `*Author:* ${githubCommit.author}\n` +
      `*Message:* ${githubCommit.message.slice(0, 100)}\n\n` +
      `*Files:* ${files.length} changed\n` +
      `*Workers:* ${affectedWorkers.join(', ') || 'none'}\n` +
      `*Duration:* ${Math.round((new Date(finishedAt) - new Date(startedAt)) / 1000)}s`;
    
    await sendTelegram(summaryMsg);

    log('\n' + '='.repeat(60));
    log('✅ DEPLOYMENT SUCCESSFUL');
    log('='.repeat(60));

    return { success: true, deployHistoryId };

  } catch (e) {
    error('\n' + '='.repeat(60));
    error('❌ DEPLOYMENT FAILED');
    error('='.repeat(60));
    error(e.message);

    state.consecutiveFailures++;

    // Record failure
    deployLog.push(`✗ Deployment failed: ${e.message}`);
    await updateDeploymentStatus(deployHistoryId, {
      deploy_status: 'failed',
      deploy_log: deployLog.join('\n'),
      health_check_passed: false
    });

    // Send failure notification
    await sendTelegram(`🔴 *Auto-Deploy Failed*\n\n` +
      `*Commit:* \`${githubCommit.sha.slice(0, 8)}\`\n` +
      `*Error:* ${e.message.slice(0, 200)}\n\n` +
      `Consecutive failures: ${state.consecutiveFailures}`);

    // Attempt rollback if we have consecutive failures
    if (state.consecutiveFailures >= 1) {
      log('\nAttempting rollback...');
      try {
        sshCommand(`cd ${VPS_PROJECT_PATH} && git reset --hard ${vpsCommit.sha}`);
        sshCommand('pm2 reload all');
        await sendTelegram('↩️ *Rollback completed* to last known good commit');
        deployLog.push('↩ Rollback executed');
      } catch (rollbackErr) {
        error('Rollback failed:', rollbackErr.message);
      }
    }

    throw e;
  }
}

// ── Show Status ─────────────────────────────────────────────
async function showStatus() {
  log('Fetching deployment status...\n');

  const [gh, vps, lastDeploy, history] = await Promise.all([
    getGithubLatestCommit(),
    getVpsCommit(),
    getLastDeployment(),
    getDeploymentHistory(5)
  ]);

  console.log('\n' + '='.repeat(60));
  console.log('VPS DEPLOYER AGENT - STATUS');
  console.log('='.repeat(60));

  if (gh && vps) {
    const synced = gh.sha === vps.sha;
    console.log(`\n📊 Sync Status: ${synced ? '✅ SYNCED' : '🟡 BEHIND'}`);
    console.log(`   GitHub: ${gh.sha.slice(0, 8)} - ${gh.message.slice(0, 50)}`);
    console.log(`   VPS:    ${vps.sha.slice(0, 8)} - ${vps.message.slice(0, 50)}`);
    
    if (!synced) {
      console.log(`\n⚠️  VPS is behind by commits`);
    }
  } else {
    console.log('\n❌ Could not fetch status');
  }

  console.log(`\n🕐 Maintenance Window: ${isInMaintenanceWindow() ? 'YES (deploys paused)' : 'NO'}`);
  console.log(`🔧 Auto-Deploy: ${ENABLE_AUTO_DEPLOY ? 'ENABLED' : 'DISABLED'}`);
  console.log(`📉 Consecutive Failures: ${state.consecutiveFailures}`);

  if (lastDeploy) {
    console.log(`\n📦 Last Deployment:`);
    console.log(`   Status: ${lastDeploy.deploy_status}`);
    console.log(`   Commit: ${lastDeploy.commit_sha?.slice(0, 8)}`);
    console.log(`   Time: ${new Date(lastDeploy.deployed_at).toLocaleString()}`);
  }

  console.log(`\n📜 Recent History:`);
  history.forEach((h, i) => {
    const emoji = h.deploy_status === 'success' ? '✅' : h.deploy_status === 'failed' ? '🔴' : '🟡';
    console.log(`   ${i + 1}. ${emoji} ${h.commit_sha?.slice(0, 8)} - ${h.deploy_status} - ${new Date(h.deployed_at).toLocaleDateString()}`);
  });

  console.log('\n' + '='.repeat(60));
}

// ── Show History ────────────────────────────────────────────
async function showHistory() {
  const history = await getDeploymentHistory(20);
  
  console.log('\n' + '='.repeat(80));
  console.log('DEPLOYMENT HISTORY (Last 20)');
  console.log('='.repeat(80));

  history.forEach((h, i) => {
    const statusEmoji = h.deploy_status === 'success' ? '✅' : 
                       h.deploy_status === 'failed' ? '🔴' : 
                       h.deploy_status === 'rolled_back' ? '↩️' : '⏳';
    
    console.log(`\n${i + 1}. ${statusEmoji} ${h.deploy_status.toUpperCase()}`);
    console.log(`   Commit: ${h.commit_sha?.slice(0, 12)}`);
    console.log(`   Author: ${h.commit_author}`);
    console.log(`   Message: ${h.commit_message?.slice(0, 60)}`);
    console.log(`   Time: ${new Date(h.deployed_at).toLocaleString()}`);
    console.log(`   Files: ${h.files_changed?.length || 0} changed`);
    if (h.health_check_passed !== null) {
      console.log(`   Health: ${h.health_check_passed ? '✅' : '❌'}`);
    }
  });

  console.log('\n' + '='.repeat(80));
}

// ── Rollback ───────────────────────────────────────────────
async function rollback() {
  log('Initiating rollback...\n');

  const history = await getDeploymentHistory(2);
  if (history.length < 2) {
    console.error('Not enough deployment history to rollback');
    return;
  }

  const current = history[0];
  const previous = history[1];

  console.log(`Current: ${current.commit_sha?.slice(0, 8)}`);
  console.log(`Rolling back to: ${previous.commit_sha?.slice(0, 8)}`);

  try {
    sshCommand(`cd ${VPS_PROJECT_PATH} && git reset --hard ${previous.commit_sha}`);
    sshCommand('pm2 reload all');
    
    await recordDeployment({
      commit_sha: previous.commit_sha,
      commit_message: `Rollback from ${current.commit_sha?.slice(0, 8)}`,
      commit_author: 'VPS Deployer Agent',
      deploy_status: 'rolled_back',
      vps_ip: VPS_IP,
      previous_commit: current.commit_sha,
      files_changed: [],
      deploy_log: `Rollback from ${current.commit_sha} to ${previous.commit_sha}`
    });

    await sendTelegram(`↩️ *Rollback Completed*\n\nRolled back to commit \`${previous.commit_sha?.slice(0, 8)}\``);
    
    console.log('✅ Rollback successful');
  } catch (e) {
    console.error('❌ Rollback failed:', e.message);
  }
}

// ── Main Loop ───────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  // CLI commands
  if (args.includes('--status')) {
    await showStatus();
    return;
  }

  if (args.includes('--history')) {
    await showHistory();
    return;
  }

  if (args.includes('--rollback')) {
    await rollback();
    return;
  }

  // Check maintenance window
  state.isMaintenanceWindow = isInMaintenanceWindow();
  if (state.isMaintenanceWindow && !args.includes('--force')) {
    log('In maintenance window (' + MAINTENANCE_START_HOUR + ':00-' + MAINTENANCE_END_HOUR + ':00). Skipping auto-deploy.');
    process.exit(0);
  }

  log('='.repeat(60));
  log('VPS DEPLOYER AGENT v2.0');
  log('='.repeat(60));
  log('VPS:', VPS_IP);
  log('Repo:', GITHUB_REPO);
  log('Branch:', GITHUB_BRANCH);
  log('Auto-deploy:', ENABLE_AUTO_DEPLOY ? 'ENABLED' : 'DISABLED');
  log('='.repeat(60));

  // Fetch current state
  const [gh, vps] = await Promise.all([
    getGithubLatestCommit(),
    getVpsCommit()
  ]);

  if (!gh || !vps) {
    error('Failed to fetch commit info');
    process.exit(1);
  }

  log('\nGitHub:', gh.sha.slice(0, 8), '-', gh.message.slice(0, 50));
  log('VPS:   ', vps.sha.slice(0, 8), '-', vps.message.slice(0, 50));

  // Check if in sync
  if (gh.sha === vps.sha) {
    log('\n✅ VPS is in sync with GitHub. No deployment needed.');
    process.exit(0);
  }

  log('\n🟡 VPS is behind GitHub. Changes detected!');

  // Get changed files
  const files = await getGithubCommitFiles(gh.sha);
  log(`Found ${files.length} files changed`);
  
  files.forEach(f => {
    const category = categorizeChange(f.filename);
    log(`  [${category}] ${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`);
  });

  // Check if auto-deploy is enabled
  if (!ENABLE_AUTO_DEPLOY && !args.includes('--force')) {
    log('\n⚠️  Auto-deploy is disabled. Set ENABLE_AUTO_DEPLOY=true to enable.');
    await sendTelegram(`🟡 *Deployment Available*\n\n` +
      `Commit: \`${gh.sha.slice(0, 8)}\`\n` +
      `Message: ${gh.message.slice(0, 100)}\n\n` +
      `Run manually: node workers/vps-deployer-agent.js --force`);
    process.exit(0);
  }

  // Run pre-deploy checks
  log('\nRunning pre-deploy checks...');
  try {
    await runPreDeployChecks();
    log('✅ Pre-deploy checks passed');
  } catch (e) {
    error('❌ Pre-deploy checks failed:', e.message);
    await sendTelegram(`🔴 *Deployment Blocked*\n\n${e.message}`);
    process.exit(1);
  }

  // Perform deployment
  try {
    const result = await performDeployment(gh, vps, files);
    
    if (result.manualApprovalRequired) {
      log('\n⚠️  Manual approval required for schema changes');
      process.exit(0);
    }

    process.exit(0);
  } catch (e) {
    error('\nDeployment failed:', e.message);
    process.exit(1);
  }
}

main().catch(e => {
  error('Fatal error:', e);
  process.exit(1);
});
