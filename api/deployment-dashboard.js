// ============================================================
// Deployment Dashboard API
// Provides endpoints for tracking deployments, agent changes,
// and deployment status visualization
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = process.cwd();

// Supabase client (will be initialized per-request if env vars available)
function getSupabase() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!url || !key) {
        return null;
    }
    
    return createClient(url, key);
}

// Helper: Get local deployment state
function getLocalDeployState() {
    try {
        const stateFile = path.join(REPO_ROOT, '.deploy-state.json');
        if (fs.existsSync(stateFile)) {
            return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        }
    } catch (e) {}
    
    return {
        lastDeployCommit: null,
        lastDeployTime: null,
        lastDeployStatus: null,
        isDeploying: false
    };
}

// Helper: Get deployment queue
function getDeployQueue() {
    try {
        const queueFile = path.join(REPO_ROOT, '.deploy-queue.json');
        if (fs.existsSync(queueFile)) {
            return JSON.parse(fs.readFileSync(queueFile, 'utf8'));
        }
    } catch (e) {}
    return [];
}

// Helper: Get agent changes
function getAgentChanges() {
    try {
        const trackerFile = path.join(REPO_ROOT, '.agent-changes.json');
        if (fs.existsSync(trackerFile)) {
            return JSON.parse(fs.readFileSync(trackerFile, 'utf8'));
        }
    } catch (e) {}
    return null;
}

// Helper: Get git status
function getGitStatus() {
    try {
        const status = execSync('git status --porcelain', { 
            cwd: REPO_ROOT,
            encoding: 'utf8',
            timeout: 5000
        });
        
        const lines = status.split('\n').filter(Boolean);
        return {
            hasChanges: lines.length > 0,
            staged: lines.filter(l => l[0] !== ' ' && l[0] !== '?').length,
            unstaged: lines.filter(l => l[1] !== ' ' && l[0] === ' ').length,
            untracked: lines.filter(l => l.startsWith('??')).length,
            total: lines.length
        };
    } catch (e) {
        return { hasChanges: false, error: e.message };
    }
}

// Helper: Get commit history
function getCommitHistory(limit = 10) {
    try {
        const output = execSync(
            `git log --oneline --format="%h|%s|%ci|%an" -${limit}`,
            { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }
        );
        
        return output.split('\n').filter(Boolean).map(line => {
            const [hash, subject, date, author] = line.split('|');
            return { hash, subject, date, author };
        });
    } catch (e) {
        return [];
    }
}

// Helper: Get branch comparison
function getBranchComparison() {
    try {
        const localCommit = execSync('git rev-parse HEAD', { 
            cwd: REPO_ROOT, encoding: 'utf8' 
        }).trim();
        
        const branch = execSync('git branch --show-current', { 
            cwd: REPO_ROOT, encoding: 'utf8' 
        }).trim();
        
        // Try to get remote commit
        let remoteCommit = null;
        let behindBy = 0;
        let aheadBy = 0;
        
        try {
            remoteCommit = execSync(`git rev-parse origin/${branch}`, { 
                cwd: REPO_ROOT, encoding: 'utf8' 
            }).trim();
            
            behindBy = parseInt(execSync(
                `git rev-list --count HEAD..origin/${branch}`,
                { cwd: REPO_ROOT, encoding: 'utf8' }
            ).trim() || '0');
            
            aheadBy = parseInt(execSync(
                `git rev-list --count origin/${branch}..HEAD`,
                { cwd: REPO_ROOT, encoding: 'utf8' }
            ).trim() || '0');
        } catch (e) {
            // Remote might not exist
        }
        
        return {
            branch,
            localCommit: localCommit.slice(0, 8),
            remoteCommit: remoteCommit ? remoteCommit.slice(0, 8) : null,
            synced: localCommit === remoteCommit,
            behindBy,
            aheadBy
        };
    } catch (e) {
        return { error: e.message };
    }
}

// Main handler
export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    const supabase = getSupabase();
    const path = req.url?.replace(/^\/api\/deployment-dashboard/, '') || '/';
    
    try {
        // GET /api/deployment-dashboard - Overview
        if (path === '/' || path === '') {
            const deployState = getLocalDeployState();
            const queue = getDeployQueue();
            const gitStatus = getGitStatus();
            const branchInfo = getBranchComparison();
            const agentChanges = getAgentChanges();
            
            // Get Supabase data if available
            let dbStats = null;
            if (supabase) {
                const { data: pending, error: pendingError } = await supabase
                    .from('agent_changes')
                    .select('id')
                    .in('deployment_status', ['pending', 'committed', 'queued']);
                
                const { data: recent, error: recentError } = await supabase
                    .from('deployment_history')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(5);
                
                if (!pendingError && !recentError) {
                    dbStats = {
                        pendingCount: pending?.length || 0,
                        recentDeployments: recent || []
                    };
                }
            }
            
            return res.status(200).json({
                ok: true,
                timestamp: new Date().toISOString(),
                overview: {
                    deploymentStatus: deployState.lastDeployStatus || 'unknown',
                    lastDeployTime: deployState.lastDeployTime,
                    isDeploying: deployState.isDeploying,
                    pendingInQueue: queue.length,
                    uncommittedChanges: gitStatus.hasChanges ? gitStatus.total : 0,
                    branchSynced: branchInfo.synced,
                    commitsBehind: branchInfo.behindBy || 0,
                    commitsAhead: branchInfo.aheadBy || 0
                },
                git: {
                    status: gitStatus,
                    branch: branchInfo,
                    hasUncommittedWork: gitStatus.hasChanges || queue.length > 0
                },
                agentChanges: agentChanges ? {
                    agentType: agentChanges.agent_type,
                    detectedAt: agentChanges.detected_at,
                    files: agentChanges.files,
                    status: agentChanges.deployment_status
                } : null,
                database: dbStats,
                queue: queue.slice(0, 5).map(q => ({
                    commit: q.commit_hash?.slice(0, 8),
                    agent: q.agent_type,
                    queuedAt: q.queued_at
                }))
            });
        }
        
        // GET /api/deployment-dashboard/queue
        if (path === '/queue') {
            const queue = getDeployQueue();
            return res.status(200).json({
                ok: true,
                queue: queue,
                count: queue.length
            });
        }
        
        // GET /api/deployment-dashboard/history
        if (path === '/history') {
            const limit = parseInt(req.query?.limit) || 20;
            
            if (supabase) {
                const { data, error } = await supabase
                    .from('deployment_history')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(limit);
                
                if (error) throw error;
                
                return res.status(200).json({
                    ok: true,
                    history: data
                });
            }
            
            // Fallback to local log
            try {
                const logFile = path.join(REPO_ROOT, '.deployment-activity.log');
                let logs = [];
                if (fs.existsSync(logFile)) {
                    const content = fs.readFileSync(logFile, 'utf8');
                    logs = content.split('\n').filter(Boolean).slice(-limit);
                }
                
                return res.status(200).json({
                    ok: true,
                    source: 'local',
                    history: logs
                });
            } catch (e) {
                return res.status(200).json({ ok: true, history: [] });
            }
        }
        
        // GET /api/deployment-dashboard/agents
        if (path === '/agents') {
            if (!supabase) {
                return res.status(503).json({
                    ok: false,
                    error: 'Supabase not configured'
                });
            }
            
            const { data, error } = await supabase
                .from('agent_changes')
                .select('*')
                .order('detected_at', { ascending: false })
                .limit(50);
            
            if (error) throw error;
            
            // Calculate stats
            const stats = {};
            data.forEach(change => {
                const agent = change.agent_type;
                if (!stats[agent]) {
                    stats[agent] = {
                        total: 0,
                        deployed: 0,
                        failed: 0,
                        pending: 0
                    };
                }
                stats[agent].total++;
                stats[agent][change.deployment_status]++;
            });
            
            return res.status(200).json({
                ok: true,
                agents: data,
                stats: stats
            });
        }
        
        // GET /api/deployment-dashboard/status
        if (path === '/status') {
            const deployState = getLocalDeployState();
            const branchInfo = getBranchComparison();
            
            return res.status(200).json({
                ok: true,
                status: {
                    isDeploying: deployState.isDeploying,
                    lastDeploy: deployState.lastDeployTime,
                    lastStatus: deployState.lastDeployStatus,
                    branch: branchInfo.branch,
                    synced: branchInfo.synced,
                    localCommit: branchInfo.localCommit,
                    remoteCommit: branchInfo.remoteCommit
                }
            });
        }
        
        // POST /api/deployment-dashboard/queue
        if (path === '/queue' && req.method === 'POST') {
            const { commit_hash, agent_type, priority = 5 } = req.body || {};
            
            if (!commit_hash) {
                return res.status(400).json({
                    ok: false,
                    error: 'commit_hash is required'
                });
            }
            
            const queue = getDeployQueue();
            
            // Check if already in queue
            if (queue.some(q => q.commit_hash === commit_hash)) {
                return res.status(409).json({
                    ok: false,
                    error: 'Commit already in queue'
                });
            }
            
            queue.push({
                commit_hash,
                agent_type,
                priority,
                queued_at: new Date().toISOString(),
                attempts: 0
            });
            
            // Save queue
            fs.writeFileSync(
                path.join(REPO_ROOT, '.deploy-queue.json'),
                JSON.stringify(queue, null, 2)
            );
            
            return res.status(201).json({
                ok: true,
                message: 'Added to queue',
                queuePosition: queue.length
            });
        }
        
        // POST /api/deployment-dashboard/trigger
        if (path === '/trigger' && req.method === 'POST') {
            const { commit_hash } = req.body || {};
            
            // Add to queue if not exists
            const queue = getDeployQueue();
            const targetCommit = commit_hash || execSync('git rev-parse HEAD', { 
                cwd: REPO_ROOT, encoding: 'utf8' 
            }).trim();
            
            if (!queue.some(q => q.commit_hash === targetCommit)) {
                queue.push({
                    commit_hash: targetCommit,
                    agent_type: 'Manual-Trigger',
                    priority: 1,
                    queued_at: new Date().toISOString()
                });
                fs.writeFileSync(
                    path.join(REPO_ROOT, '.deploy-queue.json'),
                    JSON.stringify(queue, null, 2)
                );
            }
            
            return res.status(200).json({
                ok: true,
                message: 'Deployment triggered',
                commit: targetCommit.slice(0, 8)
            });
        }
        
        // Unknown endpoint
        return res.status(404).json({
            ok: false,
            error: 'Unknown endpoint',
            available: ['/', '/queue', '/history', '/agents', '/status']
        });
        
    } catch (error) {
        console.error('Deployment dashboard error:', error);
        return res.status(500).json({
            ok: false,
            error: error.message
        });
    }
}