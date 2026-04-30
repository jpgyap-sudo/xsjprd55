#!/bin/bash
# ============================================================
# Check Deployment Status Script
# Quick status check for all deployment components
# ============================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VPS_IP="${VPS_IP:-165.22.110.111}"
VPS_USER="${VPS_USER:-root}"

cd "$PROJECT_DIR" || exit 1

echo "============================================"
echo "🔍 DEPLOYMENT STATUS CHECK"
echo "Time: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "============================================"
echo ""

# Local Git Status
echo "📁 LOCAL GIT STATUS"
echo "--------------------------------------------"
echo "Branch: $(git branch --show-current 2>/dev/null || echo 'N/A')"
echo "Commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'N/A')"
echo "Message: $(git log -1 --pretty=%s 2>/dev/null || echo 'N/A')"
echo ""

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  UNCOMMITTED CHANGES:"
    git status --short
else
    echo "✅ No uncommitted changes"
fi
echo ""

# Remote sync status
echo "🌐 REMOTE SYNC STATUS"
echo "--------------------------------------------"
LOCAL=$(git rev-parse @ 2>/dev/null || echo "")
REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "")

if [ -n "$REMOTE" ]; then
    if [ "$LOCAL" = "$REMOTE" ]; then
        echo "✅ In sync with origin"
    else
        BEHIND=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo "0")
        AHEAD=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo "0")
        
        if [ "$BEHIND" -gt 0 ]; then
            echo "⚠️  Behind origin by $BEHIND commit(s)"
            echo "   Run: git pull origin main"
        fi
        
        if [ "$AHEAD" -gt 0 ]; then
            echo "⚠️  Ahead of origin by $AHEAD commit(s)"
            echo "   Run: git push origin main"
        fi
    fi
else
    echo "⚠️  No upstream branch set"
fi
echo ""

# Deployment Queue
echo "📋 DEPLOYMENT QUEUE"
echo "--------------------------------------------"
if [ -f ".deploy-queue.json" ]; then
    QUEUE_COUNT=$(node -e "try { const q = require('./.deploy-queue.json'); console.log(q.length); } catch(e) { console.log(0); }")
    echo "Queue size: $QUEUE_COUNT"
    
    if [ "$QUEUE_COUNT" -gt 0 ]; then
        echo ""
        echo "Pending deployments:"
        node -e "
        const q = require('./.deploy-queue.json');
        q.slice(0, 5).forEach((item, i) => {
            console.log(\`  \${i+1}. \${item.commit_hash?.slice(0,8) || 'N/A'} - \${item.agent_type || 'Unknown'}\`);
        });
        " 2>/dev/null || echo "  (Could not parse queue)"
    fi
else
    echo "No queue file found"
fi
echo ""

# Agent Changes Tracker
echo "🤖 AGENT CHANGES"
echo "--------------------------------------------"
if [ -f ".agent-changes.json" ]; then
    node -e "
    try {
        const data = require('./.agent-changes.json');
        console.log(\`Agent: \${data.agent_type || 'Unknown'}\`);
        console.log(\`Status: \${data.deployment_status || 'Unknown'}\`);
        console.log(\`Files: \${data.files?.total || 0} total\`);
        console.log(\`Detected: \${data.detected_at ? new Date(data.detected_at).toLocaleString() : 'Unknown'}\`);
    } catch(e) {
        console.log('Could not parse agent changes');
    }
    " 2>/dev/null || echo "Could not read tracker"
else
    echo "No agent changes tracked"
fi
echo ""

# VPS Status
echo "🖥️  VPS STATUS ($VPS_IP)"
echo "--------------------------------------------"

# Test SSH
if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_IP}" "echo 'OK'" > /dev/null 2>&1; then
    echo "✅ SSH Connection: OK"
    
    # Get VPS git commit
    VPS_COMMIT=$(ssh "${VPS_USER}@${VPS_IP}" "cd /root/xsjprd55 && git rev-parse --short HEAD 2>/dev/null" 2>/dev/null || echo "N/A")
    echo "VPS Commit: $VPS_COMMIT"
    
    # Compare
    LOCAL_SHORT=$(git rev-parse --short HEAD 2>/dev/null || echo "")
    if [ "$VPS_COMMIT" = "$LOCAL_SHORT" ]; then
        echo "✅ VPS is up to date"
    else
        echo "⚠️  VPS is behind local"
    fi
    
    # Health check
    echo ""
    echo "Health Check:"
    HEALTH=$(ssh "${VPS_USER}@${VPS_IP}" "curl -sf --max-time 5 http://localhost:3000/api/health 2>/dev/null && echo 'OK' || echo 'FAIL'" 2>/dev/null)
    if [ "$HEALTH" = "OK" ]; then
        echo "  ✅ API Health: OK"
    else
        echo "  ❌ API Health: FAIL"
    fi
    
    # PM2 status
    echo ""
    echo "PM2 Processes:"
    ssh "${VPS_USER}@${VPS_IP}" "pm2 status 2>/dev/null | tail -n +4 | head -20" 2>/dev/null || echo "  (Could not get PM2 status)"
    
else
    echo "❌ SSH Connection: FAILED"
    echo "   Cannot reach VPS at $VPS_IP"
fi

echo ""
echo "============================================"
echo "✅ Status check complete"
echo "============================================"