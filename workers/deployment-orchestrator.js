// ============================================================
// Deployment Orchestrator Worker
// Unified deployment automation that ensures everything gets
// committed and deployed fast and easily
// ============================================================

import { execFileSync, execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Configuration
const CONFIG = {
    vpsIp: process.env.VPS_IP || '165.22.110.111',
    vpsUser: process.env.VPS_USER || 'root',
    vpsPath: process.env.VPS_PROJECT_PATH || '/root/xsjprd55',
    vpsSshKey: process.env.VPS_SSH_KEY || path.join(process.env.HOME || '/root', '.ssh/id_ed25519'),
    
    // Auto-deploy settings
    autoDeployEnabled: process.env.AUTO_DEPLOY_ENABLED === 'true',
    autoCommitEnabled: process.env.AUTO_COMMIT_ENABLED === 'true',
    maintenanceWindowStart: parseInt(process.env.DEPLOY_MAINTENANCE_START_HOUR || '23'),
    maintenanceWindowEnd: parseInt(process.env.DEPLOY_MAINTENANCE_END_HOUR || '6'),
    
    // Health check
    healthCheckRetries: 5,
    healthCheckDelayMs: 5000,
    
    // Notifications
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    slackWebhook: process.env.SLACK_DEPLOY_WEBHOOK,
    
    // Tracking
    deployQueueFile: path.join(REPO_ROOT, '.deploy-queue.json'),
    deployLogFile: path.join(REPO_ROOT, '.deployment-activity.log'),
    deployStateFile: path.join(REPO_ROOT, '.deploy-state.json')
};

// Deployment state management
let deployState = {
    lastDeployCommit: null,
    lastDeployTime: null,
    lastDeployStatus: null,
    consecutiveFailures: 0,
    isDeploying: false
};

function log(...args) {
    const timestamp = new Date().toISOString();
    const message = `[deploy-orchestrator] ${timestamp} ${args.join(' ')}`;
    console.log(message);
    
    // Log to file
    try {
        fs.appendFileSync(CONFIG.deployLogFile, message + '\n');
    } catch (e) {}
}

function loadDeployState() {
    try {
        if (fs.existsSync(CONFIG.deployStateFile)) {
            const content = fs.readFileSync(CONFIG.deployStateFile, 'utf8');
            deployState = { ...deployState, ...JSON.parse(content) };
        }
    } catch (e) {
        log('Error loading deploy state:', e.message);
    }
}

function saveDeployState() {
    try {
        fs.writeFileSync(CONFIG.deployStateFile, JSON.stringify(deployState, null, 2));
    } catch (e) {
        log('Error saving deploy state:', e.message);
    }
}

function sshCommand(cmd, timeoutMs = 30000) {
    const args = [
        '-o', 'BatchMode=yes',
        '-o', 'ConnectionAttempts=1',
        '-o', 'ConnectTimeout=10',
        '-o', 'ServerAliveInterval=5',
        '-o', 'ServerAliveCountMax=2',
        '-o', 'StrictHostKeyChecking=accept-new',
    ];
    
    if (CONFIG.vpsSshKey && fs.existsSync(CONFIG.vpsSshKey)) {
        args.push('-i', CONFIG.vpsSshKey);
    }
    
    args.push(`${CONFIG.vpsUser}@${CONFIG.vpsIp}`, cmd);
    
    return execFileSync('ssh', args, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs
    }).trim();
}

function isMaintenanceWindow() {
    const hour = new Date().getHours();
    if (CONFIG.maintenanceWindowStart > CONFIG.maintenanceWindowEnd) {
        // Window spans midnight
        return hour >= CONFIG.maintenanceWindowStart || hour < CONFIG.maintenanceWindowEnd;
    }
    return hour >= CONFIG.maintenanceWindowStart && hour < CONFIG.maintenanceWindowEnd;
}

function getLocalGitInfo() {
    try {
        const hash = execSync('git rev-parse HEAD', { 
            cwd: REPO_ROOT, 
            encoding: 'utf8' 
        }).trim();
        
        const shortHash = execSync('git rev-parse --short HEAD', { 
            cwd: REPO_ROOT, 
            encoding: 'utf8' 
        }).trim();
        
        const message = execSync('git log -1 --pretty=%B', { 
            cwd: REPO_ROOT, 
            encoding: 'utf8' 
        }).trim();
        
        const branch = execSync('git branch --show-current', { 
            cwd: REPO_ROOT, 
            encoding: 'utf8' 
        }).trim();
        
        const files = execSync('git diff --name-only HEAD~1 HEAD', { 
            cwd: REPO_ROOT, 
            encoding: 'utf8' 
        }).trim().split('\n').filter(Boolean);
        
        return { hash, shortHash, message, branch, files };
    } catch (e) {
        log('Error getting git info:', e.message);
        return null;
    }
}

function getVpsGitInfo() {
    try {
        const hash = sshCommand(`cd ${CONFIG.vpsPath} && git rev-parse HEAD`);
        const shortHash = sshCommand(`cd ${CONFIG.vpsPath} && git rev-parse --short HEAD`);
        const message = sshCommand(`cd ${CONFIG.vpsPath} && git log -1 --pretty=%B`);
        return { hash, shortHash, message };
    } catch (e) {
        log('Error getting VPS git info:', e.message);
        return null;
    }
}

function loadDeployQueue() {
    try {
        if (fs.existsSync(CONFIG.deployQueueFile)) {
            return JSON.parse(fs.readFileSync(CONFIG.deployQueueFile, 'utf8'));
        }
    } catch (e) {
        log('Error loading deploy queue:', e.message);
    }
    return [];
}

function saveDeployQueue(queue) {
    try {
        fs.writeFileSync(CONFIG.deployQueueFile, JSON.stringify(queue, null, 2));
    } catch (e) {
        log('Error saving deploy queue:', e.message);
    }
}

function clearDeployQueue() {
    try {
        if (fs.existsSync(CONFIG.deployQueueFile)) {
            fs.unlinkSync(CONFIG.deployQueueFile);
        }
    } catch (e) {}
}

async function notifyTelegram(message) {
    if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) return false;
    
    try {
        const { default: fetch } = await import('node-fetch');
        const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CONFIG.telegramChatId,
                text: message,
                parse_mode: 'Markdown'
            })
        });
        return res.ok;
    } catch (e) {
        log('Telegram notify failed:', e.message);
        return false;
    }
}

async function recordDeploymentToSupabase(deployData) {
    try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        const { error } = await supabase.from('deployment_history').insert({
            commit_sha: deployData.commit_sha,
            commit_message: deployData.commit_message,
            commit_author: deployData.commit_author,
            previous_commit: deployData.previous_commit,
            deployed_from: deployData.deployed_from,
            deployed_to: deployData.deployed_to,
            deployed_by: deployData.deployed_by,
            deploy_status: deployData.deploy_status,
            health_check_passed: deployData.health_check_passed,
            pm2_restarted: deployData.pm2_restarted,
            vps_ip: deployData.vps_ip,
            files_changed: deployData.files_changed,
            deploy_started_at: deployData.deploy_started_at,
            deploy_finished_at: deployData.deploy_finished_at,
            duration_ms: deployData.duration_ms,
            deploy_log: deployData.deploy_log,
            error_log: deployData.error_log
        });
        
        if (error) throw error;
        log('Recorded deployment to Supabase');
        return true;
    } catch (e) {
        log('Failed to record to Supabase:', e.message);
        return false;
    }
}

async function checkVpsHealth() {
    try {
        const output = sshCommand(
            `curl -sf --max-time 8 http://localhost:3000/api/health && echo 'OK' || echo 'FAIL'`,
            15000
        );
        return output.includes('OK');
    } catch (e) {
        return false;
    }
}

async function getVpsPm2Status() {
    try {
        const output = sshCommand('pm2 jlist');
        return JSON.parse(output);
    } catch (e) {
        log('Failed to get PM2 status:', e.message);
        return [];
    }
}

async function performDeployment(deployItem) {
    const startTime = Date.now();
    const deployLog = [];
    
    const deployData = {
        commit_sha: deployItem.commit_hash,
        commit_message: deployItem.commit_message || 'No message',
        commit_author: deployItem.agent_type || 'Unknown',
        previous_commit: deployState.lastDeployCommit,
        deployed_from: 'auto-orchestrator',
        deployed_to: 'vps',
        deployed_by: 'deployment-orchestrator',
        deploy_status: 'failed',
        health_check_passed: false,
        pm2_restarted: false,
        vps_ip: CONFIG.vpsIp,
        files_changed: deployItem.files?.file_list || [],
        deploy_started_at: new Date().toISOString(),
        deploy_finished_at: null,
        duration_ms: 0,
        deploy_log: '',
        error_log: ''
    };
    
    function logDeploy(step, message) {
        const entry = `[${new Date().toISOString()}] ${step}: ${message}`;
        deployLog.push(entry);
        log(message);
    }
    
    try {
        deployState.isDeploying = true;
        saveDeployState();
        
        logDeploy('START', `Starting deployment of ${deployItem.commit_hash}`);
        
        // Pre-deploy checks
        if (isMaintenanceWindow()) {
            throw new Error('Currently in maintenance window, skipping auto-deploy');
        }
        
        if (deployState.consecutiveFailures >= 3) {
            throw new Error('Too many consecutive failures, manual intervention required');
        }
        
        // Step 1: SSH connectivity check
        logDeploy('CHECK', 'Testing SSH connectivity...');
        sshCommand('echo "SSH OK"', 10000);
        logDeploy('CHECK', 'SSH connectivity OK');
        
        // Step 2: Backup current state
        logDeploy('BACKUP', 'Backing up current commit...');
        const backupCommit = sshCommand(`cd ${CONFIG.vpsPath} && git rev-parse HEAD`);
        logDeploy('BACKUP', `Backup commit: ${backupCommit}`);
        
        // Step 3: Git pull
        logDeploy('GIT', 'Pulling latest code...');
        const pullOutput = sshCommand(`cd ${CONFIG.vpsPath} && git pull origin main 2>&1`, 60000);
        logDeploy('GIT', 'Git pull completed');
        deployLog.push(pullOutput);
        
        // Step 4: Install dependencies (if package.json changed)
        const filesChanged = sshCommand(`cd ${CONFIG.vpsPath} && git diff --name-only HEAD~1 HEAD`);
        if (filesChanged.includes('package.json')) {
            logDeploy('DEPS', 'package.json changed, running npm install...');
            const npmOutput = sshCommand(`cd ${CONFIG.vpsPath} && npm install 2>&1`, 120000);
            logDeploy('DEPS', 'npm install completed');
            deployLog.push(npmOutput);
        }
        
        // Step 5: Run database migrations (if SQL files changed)
        if (filesChanged.includes('.sql')) {
            logDeploy('DB', 'SQL files changed, migrations may be needed');
            // Note: migrations should be run manually or via separate process
        }
        
        // Step 6: PM2 reload
        logDeploy('PM2', 'Reloading PM2 processes...');
        const pm2Output = sshCommand(`cd ${CONFIG.vpsPath} && pm2 reload all 2>&1`, 60000);
        logDeploy('PM2', 'PM2 reload completed');
        deployData.pm2_restarted = true;
        deployLog.push(pm2Output);
        
        // Step 7: Wait for services
        logDeploy('WAIT', 'Waiting for services to stabilize...');
        await new Promise(r => setTimeout(r, 10000));
        
        // Step 8: Health checks
        logDeploy('HEALTH', 'Running health checks...');
        let healthOk = false;
        
        for (let i = 1; i <= CONFIG.healthCheckRetries; i++) {
            if (await checkVpsHealth()) {
                healthOk = true;
                break;
            }
            logDeploy('HEALTH', `Health check ${i}/${CONFIG.healthCheckRetries} failed, retrying...`);
            await new Promise(r => setTimeout(r, CONFIG.healthCheckDelayMs));
        }
        
        deployData.health_check_passed = healthOk;
        
        if (!healthOk) {
            throw new Error('Health checks failed after ' + CONFIG.healthCheckRetries + ' attempts');
        }
        
        logDeploy('HEALTH', 'Health checks passed');
        
        // Step 9: Verify PM2 status
        const pm2Status = await getVpsPm2Status();
        const failedProcesses = pm2Status.filter(p => p.pm2_env?.status !== 'online');
        
        if (failedProcesses.length > 0) {
            logDeploy('WARNING', `${failedProcesses.length} processes not online`);
        }
        
        // Success!
        deployData.deploy_status = 'success';
        deployState.consecutiveFailures = 0;
        deployState.lastDeployCommit = deployItem.commit_hash;
        deployState.lastDeployTime = new Date().toISOString();
        deployState.lastDeployStatus = 'success';
        
        logDeploy('SUCCESS', `Deployment completed successfully in ${(Date.now() - startTime) / 1000}s`);
        
        // Notify
        await notifyTelegram(
            `✅ *Deployment Successful*\n\n` +
            `Commit: \`${deployItem.commit_hash?.slice(0, 8)}\`\n` +
            `Agent: ${deployItem.agent_type || 'Unknown'}\n` +
            `Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n` +
            `Health: ✅ Passed`
        );
        
    } catch (error) {
        deployData.deploy_status = 'failed';
        deployState.consecutiveFailures++;
        deployState.lastDeployStatus = 'failed';
        
        deployData.error_log = error.message;
        logDeploy('ERROR', error.message);
        
        // Notify failure
        await notifyTelegram(
            `❌ *Deployment Failed*\n\n` +
            `Commit: \`${deployItem.commit_hash?.slice(0, 8)}\`\n` +
            `Agent: ${deployItem.agent_type || 'Unknown'}\n` +
            `Error: ${error.message}\n\n` +
            `Consecutive failures: ${deployState.consecutiveFailures}`
        );
        
        // Attempt rollback if we have a previous commit
        if (deployState.lastDeployCommit && deployState.consecutiveFailures < 3) {
            logDeploy('ROLLBACK', 'Attempting rollback...');
            try {
                sshCommand(`cd ${CONFIG.vpsPath} && git reset --hard ${deployState.lastDeployCommit}`, 30000);
                sshCommand(`cd ${CONFIG.vpsPath} && pm2 reload all`, 60000);
                logDeploy('ROLLBACK', 'Rollback completed');
                deployData.deploy_status = 'rolled_back';
            } catch (rollbackError) {
                logDeploy('ROLLBACK', `Rollback failed: ${rollbackError.message}`);
            }
        }
    } finally {
        deployState.isDeploying = false;
        deployData.deploy_finished_at = new Date().toISOString();
        deployData.duration_ms = Date.now() - startTime;
        deployData.deploy_log = deployLog.join('\n');
        
        saveDeployState();
        
        // Record to Supabase
        await recordDeploymentToSupabase(deployData);
    }
    
    return deployData.deploy_status === 'success';
}

async function checkAndDeploy() {
    log('Checking for pending deployments...');
    
    // Load current state
    loadDeployState();
    
    // Check if already deploying
    if (deployState.isDeploying) {
        log('Deployment already in progress, skipping');
        return;
    }
    
    // Load deploy queue
    const queue = loadDeployQueue();
    
    if (queue.length === 0) {
        log('No pending deployments in queue');
        return;
    }
    
    log(`Found ${queue.length} pending deployments`);
    
    // Get current git info
    const localInfo = getLocalGitInfo();
    const vpsInfo = getVpsGitInfo();
    
    if (!localInfo || !vpsInfo) {
        log('Failed to get git info, aborting');
        return;
    }
    
    // Check if VPS is behind
    if (localInfo.hash === vpsInfo.hash) {
        log('VPS is up to date, clearing queue');
        clearDeployQueue();
        return;
    }
    
    log(`VPS behind: Local ${localInfo.shortHash} vs VPS ${vpsInfo.shortHash}`);
    
    // Check for uncommitted changes
    try {
        const status = execSync('git status --porcelain', { 
            cwd: REPO_ROOT, 
            encoding: 'utf8' 
        });
        
        if (status.trim()) {
            log('Uncommitted changes detected');
            
            if (CONFIG.autoCommitEnabled) {
                log('Auto-commit enabled, committing changes...');
                execSync('git add .', { cwd: REPO_ROOT });
                execSync('git commit -m "auto: commit pending changes before deploy"', { 
                    cwd: REPO_ROOT,
                    encoding: 'utf8'
                });
                
                // Push to trigger deploy
                log('Pushing to origin...');
                execSync('git push origin main', { cwd: REPO_ROOT });
                
                // Re-check queue
                const newQueue = loadDeployQueue();
                if (newQueue.length === 0) {
                    // Add current commit to queue
                    const newCommit = getLocalGitInfo();
                    newQueue.push({
                        commit_hash: newCommit.hash,
                        commit_message: newCommit.message,
                        agent_type: 'Auto-Committer',
                        queued_at: new Date().toISOString()
                    });
                    saveDeployQueue(newQueue);
                }
            } else {
                log('Auto-commit disabled, manual commit required');
                await notifyTelegram(
                    `⚠️ *Uncommitted Changes*\n\n` +
                    `There are uncommitted changes blocking deployment.\n\n` +
                    `Run:\n` +
                    `\`git add . && git commit -m "update" && git push\``
                );
                return;
            }
        }
    } catch (e) {
        log('Error checking git status:', e.message);
    }
    
    // Process queue (FIFO)
    const nextDeploy = queue[0];
    log(`Processing deployment: ${nextDeploy.commit_hash}`);
    
    const success = await performDeployment(nextDeploy);
    
    if (success) {
        // Remove from queue
        queue.shift();
        saveDeployQueue(queue);
        log('Deployment completed and removed from queue');
    } else {
        // Mark as failed but keep in queue for retry
        nextDeploy.attempts = (nextDeploy.attempts || 0) + 1;
        nextDeploy.last_error = new Date().toISOString();
        
        if (nextDeploy.attempts >= 3) {
            log(`Max retries reached for ${nextDeploy.commit_hash}, removing from queue`);
            queue.shift();
        }
        
        saveDeployQueue(queue);
    }
}

async function continuousDeployLoop() {
    log('Starting deployment orchestrator...');
    log(`Auto-deploy: ${CONFIG.autoDeployEnabled ? 'enabled' : 'disabled'}`);
    log(`Auto-commit: ${CONFIG.autoCommitEnabled ? 'enabled' : 'disabled'}`);
    
    // Initial check
    await checkAndDeploy();
    
    // Set up interval (every 2 minutes)
    setInterval(async () => {
        await checkAndDeploy();
    }, 120000);
    
    log('Orchestrator running. Checking every 2 minutes.');
}

// CLI commands
const command = process.argv[2];

if (command === 'status') {
    loadDeployState();
    console.log('=== Deployment Status ===');
    console.log(`Last deploy commit: ${deployState.lastDeployCommit || 'None'}`);
    console.log(`Last deploy time: ${deployState.lastDeployTime || 'Never'}`);
    console.log(`Last deploy status: ${deployState.lastDeployStatus || 'Unknown'}`);
    console.log(`Consecutive failures: ${deployState.consecutiveFailures}`);
    console.log(`Currently deploying: ${deployState.isDeploying}`);
    
    const queue = loadDeployQueue();
    console.log(`\nPending deployments: ${queue.length}`);
    queue.forEach((item, i) => {
        console.log(`  ${i + 1}. ${item.commit_hash?.slice(0, 8)} - ${item.agent_type || 'Unknown'}`);
    });
    
    process.exit(0);
}

if (command === 'force-deploy') {
    log('Force deployment requested');
    const queue = loadDeployQueue();
    const localInfo = getLocalGitInfo();
    
    if (queue.length === 0 && localInfo) {
        queue.push({
            commit_hash: localInfo.hash,
            commit_message: localInfo.message,
            agent_type: 'Manual-Deploy',
            queued_at: new Date().toISOString()
        });
        saveDeployQueue(queue);
    }
    
    checkAndDeploy().then(() => process.exit(0));
}

if (command === 'check') {
    checkAndDeploy().then(() => process.exit(0));
}

if (!command) {
    // Run continuous loop
    continuousDeployLoop().catch(e => {
        log('Fatal error:', e.message);
        process.exit(1);
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    log('Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('Shutting down gracefully...');
    process.exit(0);
});

export { checkAndDeploy, performDeployment };