// ============================================================
// Agent Change Tracker Worker
// Tracks all coding agent changes, detects uncommitted work,
// and ensures nothing gets lost before deployment
// ============================================================

import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TRACKER_FILE = path.join(REPO_ROOT, '.agent-changes.json');
const ACTIVITY_LOG = path.join(REPO_ROOT, '.agent-activity.log');
const DEPLOY_QUEUE = path.join(REPO_ROOT, '.deploy-queue.json');

// Configuration
const CONFIG = {
    checkIntervalMs: 60000, // Check every minute
    maxUncommittedAgeMinutes: 30, // Alert if uncommitted for 30 min
    autoCommitEnabled: process.env.AUTO_COMMIT_ENABLED === 'true',
    autoDeployEnabled: process.env.AUTO_DEPLOY_ENABLED === 'true',
    slackWebhook: process.env.SLACK_DEPLOY_WEBHOOK,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID
};

// Agent type detection patterns
const AGENT_PATTERNS = {
    'Signal Analyst': /(signal|trading|backtest|strategy|indicator)/i,
    'Risk & Security Reviewer': /(security|auth|env|secret|permission|rls)/i,
    'DevOps & Infrastructure': /(deploy|docker|nginx|pm2|vps|infra|config)/i,
    'Bug Hunter': /(bug|fix|debug|error|crash|issue|repair)/i,
    'ML Service Agent': /(ml|predict|model|ai|feature|training)/i,
    'Documentation Maintainer': /(doc|readme|md|comment|guide)/i,
    'VPS Deployer Agent': /(deploy|release|publish|push|vps)/i
};

function log(...args) {
    const timestamp = new Date().toISOString();
    const message = `[agent-tracker] ${timestamp} ${args.join(' ')}`;
    console.log(message);
    
    // Also log to file
    try {
        fs.appendFileSync(ACTIVITY_LOG, message + '\n');
    } catch (e) {
        // Silent fail
    }
}

function detectAgentType(files, commitMessage = '') {
    const text = files.join(' ') + ' ' + commitMessage;
    
    for (const [agent, pattern] of Object.entries(AGENT_PATTERNS)) {
        if (pattern.test(text)) {
            return agent;
        }
    }
    
    // Default based on file paths
    if (files.some(f => f.includes('/api/'))) return 'Senior Builder';
    if (files.some(f => f.includes('/workers/'))) return 'Senior Builder';
    if (files.some(f => f.includes('/lib/'))) return 'Senior Builder';
    
    return 'Senior Builder';
}

function classifyChange(files, commitMessage = '') {
    const text = files.join(' ') + ' ' + commitMessage;
    
    if (/fix|bug|repair|crash|error/i.test(text)) return 'bugfix';
    if (/feature|add|new|implement/i.test(text)) return 'feature';
    if (/hotfix|urgent|critical|security/i.test(text)) return 'hotfix';
    if (/refactor|cleanup|optimize|improve/i.test(text)) return 'refactor';
    if (/config|setting|env/i.test(text)) return 'config';
    if (/test|spec/i.test(text)) return 'test';
    if (/schema|migration|sql|table/i.test(text)) return 'schema';
    if (/doc|readme|md|comment/i.test(text)) return 'docs';
    if (/security|auth|permission|rls/i.test(text)) return 'security';
    
    return 'feature';
}

function getGitStatus() {
    try {
        const status = execSync('git status --porcelain', { 
            cwd: REPO_ROOT,
            encoding: 'utf8'
        });
        
        const staged = [];
        const unstaged = [];
        const untracked = [];
        
        status.split('\n').forEach(line => {
            if (!line.trim()) return;
            
            const statusCode = line.substring(0, 2);
            const file = line.substring(3).trim();
            
            if (statusCode[0] !== ' ' && statusCode[0] !== '?') {
                staged.push(file);
            } else if (statusCode[1] !== ' ') {
                unstaged.push(file);
            } else if (statusCode === '??') {
                untracked.push(file);
            }
        });
        
        return { staged, unstaged, untracked };
    } catch (e) {
        log('Error getting git status:', e.message);
        return { staged: [], unstaged: [], untracked: [] };
    }
}

function getLastCommitInfo() {
    try {
        const hash = execSync('git rev-parse --short HEAD', { 
            cwd: REPO_ROOT, 
            encoding: 'utf8' 
        }).trim();
        
        const message = execSync('git log -1 --pretty=%B', { 
            cwd: REPO_ROOT, 
            encoding: 'utf8' 
        }).trim();
        
        const timestamp = execSync('git log -1 --format=%cI', { 
            cwd: REPO_ROOT, 
            encoding: 'utf8' 
        }).trim();
        
        return { hash, message, timestamp };
    } catch (e) {
        return { hash: 'unknown', message: '', timestamp: null };
    }
}

function countFileTypes(files) {
    return {
        total: files.length,
        api: files.filter(f => f.startsWith('api/')).length,
        workers: files.filter(f => f.startsWith('workers/')).length,
        lib: files.filter(f => f.startsWith('lib/')).length,
        scripts: files.filter(f => f.startsWith('scripts/')).length,
        tests: files.filter(f => f.startsWith('test/')).length,
        sql: files.filter(f => f.endsWith('.sql')).length,
        docs: files.filter(f => f.endsWith('.md')).length
    };
}

function loadTracker() {
    try {
        if (fs.existsSync(TRACKER_FILE)) {
            const content = fs.readFileSync(TRACKER_FILE, 'utf8');
            return JSON.parse(content);
        }
    } catch (e) {
        log('Error loading tracker:', e.message);
    }
    return null;
}

function saveTracker(data) {
    try {
        fs.writeFileSync(TRACKER_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        log('Error saving tracker:', e.message);
    }
}

function addToDeployQueue(change) {
    let queue = [];
    try {
        if (fs.existsSync(DEPLOY_QUEUE)) {
            queue = JSON.parse(fs.readFileSync(DEPLOY_QUEUE, 'utf8'));
        }
    } catch (e) {
        // Start fresh
    }
    
    queue.push({
        ...change,
        queued_at: new Date().toISOString()
    });
    
    try {
        fs.writeFileSync(DEPLOY_QUEUE, JSON.stringify(queue, null, 2));
        log('Added to deploy queue:', change.commit_hash);
    } catch (e) {
        log('Error adding to queue:', e.message);
    }
}

async function notifyTelegram(message) {
    if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) return;
    
    try {
        const { default: fetch } = await import('node-fetch');
        await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CONFIG.telegramChatId,
                text: message,
                parse_mode: 'Markdown'
            })
        });
    } catch (e) {
        log('Telegram notify failed:', e.message);
    }
}

async function recordToSupabase(data) {
    try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        const { error } = await supabase
            .from('agent_changes')
            .insert({
                agent_type: data.agent_type,
                commit_hash: data.commit_hash,
                commit_message: data.commit_message,
                branch: data.branch,
                previous_commit: data.previous_commit,
                files_total: data.files.total,
                files_api: data.files.api,
                files_workers: data.files.workers,
                files_lib: data.files.lib,
                files_scripts: data.files.scripts,
                files_tests: data.files.tests,
                files_sql: data.files.sql,
                files_docs: data.files.docs,
                file_list: data.file_list,
                change_category: data.change_category,
                deployment_status: data.deployment_status,
                detected_at: data.detected_at,
                committed_at: data.committed_at,
                metadata: data.metadata
            });
        
        if (error) throw error;
        log('Recorded to Supabase:', data.commit_hash);
    } catch (e) {
        log('Supabase record failed:', e.message);
    }
}

async function checkForChanges() {
    log('Checking for agent changes...');
    
    const status = getGitStatus();
    const allChanges = [...status.staged, ...status.unstaged, ...status.untracked];
    
    if (allChanges.length === 0) {
        log('No changes detected');
        return;
    }
    
    log(`Found ${allChanges.length} changed files`);
    
    const lastCommit = getLastCommitInfo();
    const agentType = detectAgentType(allChanges);
    const changeCategory = classifyChange(allChanges);
    const fileCounts = countFileTypes(allChanges);
    const branch = execSync('git branch --show-current', { 
        cwd: REPO_ROOT, 
        encoding: 'utf8' 
    }).trim();
    
    // Check existing tracker
    const existing = loadTracker();
    
    const changeData = {
        id: existing?.id || crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        agent_type: agentType,
        commit_hash: status.staged.length > 0 ? 'pending_commit' : null,
        commit_message: null,
        branch: branch,
        previous_commit: lastCommit.hash,
        files: fileCounts,
        file_list: allChanges.slice(0, 20),
        change_category: changeCategory,
        deployment_status: status.staged.length > 0 ? 'pending_commit' : 'detected',
        detected_at: existing?.detected_at || new Date().toISOString(),
        committed_at: null,
        verified: false,
        metadata: {
            has_staged: status.staged.length > 0,
            has_unstaged: status.unstaged.length > 0,
            has_untracked: status.untracked.length > 0
        }
    };
    
    saveTracker(changeData);
    
    // Alert if uncommitted for too long
    if (existing) {
        const detectedAt = new Date(existing.detected_at);
        const ageMinutes = (Date.now() - detectedAt.getTime()) / 1000 / 60;
        
        if (ageMinutes > CONFIG.maxUncommittedAgeMinutes && !existing.alerted) {
            const message = `⚠️ *Uncommitted Agent Changes*

Agent: ${agentType}
Files: ${allChanges.length} files
Age: ${Math.round(ageMinutes)} minutes

Run: \`git add . && git commit -m "${changeCategory}: ${agentType} updates"\``;
            
            await notifyTelegram(message);
            existing.alerted = true;
            saveTracker(existing);
        }
    }
    
    // Auto-commit if enabled and files are only staged
    if (CONFIG.autoCommitEnabled && status.staged.length > 0 && status.unstaged.length === 0) {
        log('Auto-committing staged changes...');
        try {
            execSync(`git commit -m "${changeCategory}: ${agentType} automated update"`, {
                cwd: REPO_ROOT,
                encoding: 'utf8'
            });
            
            const newCommit = getLastCommitInfo();
            changeData.commit_hash = newCommit.hash;
            changeData.commit_message = newCommit.message;
            changeData.committed_at = new Date().toISOString();
            changeData.deployment_status = 'committed';
            
            saveTracker(changeData);
            addToDeployQueue(changeData);
            
            log('Auto-committed:', newCommit.hash);
            
            await notifyTelegram(`✅ *Auto-Committed*\n\nAgent: ${agentType}\nCommit: \`${newCommit.hash}\`\nFiles: ${allChanges.length}`);
            
            // Record to Supabase
            await recordToSupabase(changeData);
        } catch (e) {
            log('Auto-commit failed:', e.message);
        }
    }
}

async function syncWithSupabase() {
    try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        // Get pending changes from Supabase
        const { data: pending, error } = await supabase
            .from('agent_changes')
            .select('*')
            .in('deployment_status', ['pending', 'committed', 'queued'])
            .order('detected_at', { ascending: true });
        
        if (error) throw error;
        
        log(`Found ${pending?.length || 0} pending deployments in Supabase`);
        
        // Queue any that aren't in local queue
        for (const change of pending || []) {
            const queuePath = path.join(REPO_ROOT, '.deploy-queue.json');
            let localQueue = [];
            
            if (fs.existsSync(queuePath)) {
                localQueue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
            }
            
            const alreadyQueued = localQueue.some(q => q.commit_hash === change.commit_hash);
            
            if (!alreadyQueued && change.commit_hash) {
                addToDeployQueue({
                    commit_hash: change.commit_hash,
                    agent_type: change.agent_type,
                    change_category: change.change_category,
                    files: {
                        total: change.files_total,
                        api: change.files_api,
                        workers: change.files_workers
                    },
                    from_supabase: true
                });
            }
        }
    } catch (e) {
        log('Supabase sync failed:', e.message);
    }
}

async function main() {
    log('Starting Agent Change Tracker...');
    
    // Initial check
    await checkForChanges();
    await syncWithSupabase();
    
    // Set up interval
    setInterval(async () => {
        await checkForChanges();
    }, CONFIG.checkIntervalMs);
    
    // Also sync with Supabase every 5 minutes
    setInterval(async () => {
        await syncWithSupabase();
    }, 300000);
    
    log('Tracker running. Press Ctrl+C to stop.');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    log('Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('Shutting down gracefully...');
    process.exit(0);
});

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(e => {
        log('Fatal error:', e.message);
        process.exit(1);
    });
}

export { checkForChanges, detectAgentType, classifyChange };