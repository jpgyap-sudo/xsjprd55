#!/bin/bash
# ============================================================
# Deploy Everything Script
# One-command deployment that ensures all changes are tracked,
# committed, and deployed to VPS
# ============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="/var/log/deploy-everything.log"
VPS_IP="${VPS_IP:-165.22.110.111}"
VPS_USER="${VPS_USER:-root}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE" 2>/dev/null || true
}

success() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS: $1" >> "$LOG_FILE" 2>/dev/null || true
}

warning() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $1" >> "$LOG_FILE" 2>/dev/null || true
}

error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ✗${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >> "$LOG_FILE" 2>/dev/null || true
}

cd "$PROJECT_DIR" || exit 1

echo "============================================"
echo "🚀 DEPLOY EVERYTHING"
echo "Time: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "============================================"
echo ""

# Step 1: Check for uncommitted changes
log "Step 1: Checking for uncommitted changes..."

if [ -n "$(git status --porcelain)" ]; then
    warning "Uncommitted changes detected!"
    git status --short
    echo ""
    
    # Detect agent type from changes
    CHANGED_FILES=$(git diff --name-only HEAD)
    AGENT_TYPE="Senior Builder"
    
    if echo "$CHANGED_FILES" | grep -qE "(signal|trading|backtest)"; then
        AGENT_TYPE="Signal Analyst"
    elif echo "$CHANGED_FILES" | grep -qE "(security|auth|env|secret)"; then
        AGENT_TYPE="Risk & Security Reviewer"
    elif echo "$CHANGED_FILES" | grep -qE "(deploy|docker|nginx|pm2|vps)"; then
        AGENT_TYPE="DevOps & Infrastructure"
    elif echo "$CHANGED_FILES" | grep -qE "(bug|fix|debug)"; then
        AGENT_TYPE="Bug Hunter"
    fi
    
    log "Detected agent type: $AGENT_TYPE"
    
    # Stage all changes
    log "Staging all changes..."
    git add .
    
    # Commit with agent tracking
    COMMIT_MSG="${AGENT_TYPE}: $(date '+%Y-%m-%d %H:%M') update"
    log "Creating commit: $COMMIT_MSG"
    git commit -m "$COMMIT_MSG"
    
    success "Changes committed"
else
    success "No uncommitted changes"
fi

# Step 2: Check if we need to pull first
log "Step 2: Checking remote status..."

git fetch origin main 2>/dev/null || {
    warning "Could not fetch from origin"
}

LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "")
BASE=$(git merge-base @ @{u} 2>/dev/null || echo "")

if [ "$LOCAL" != "$REMOTE" ] && [ -n "$REMOTE" ]; then
    if [ "$LOCAL" = "$BASE" ]; then
        warning "Local is behind remote, pulling first..."
        git pull origin main
        success "Pulled latest changes"
    elif [ "$REMOTE" = "$BASE" ]; then
        log "Local is ahead of remote, ready to push"
    else
        warning "Local and remote have diverged!"
        read -p "Continue with push? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
fi

# Step 3: Push to GitHub
log "Step 3: Pushing to GitHub..."
git push origin main
success "Pushed to GitHub"

# Step 4: Add to deployment queue
log "Step 4: Adding to deployment queue..."
CURRENT_COMMIT=$(git rev-parse HEAD)
SHORT_COMMIT=$(git rev-parse --short HEAD)

# Create or update deploy queue
QUEUE_FILE=".deploy-queue.json"
if [ -f "$QUEUE_FILE" ]; then
    # Check if already in queue
    if grep -q "$CURRENT_COMMIT" "$QUEUE_FILE" 2>/dev/null; then
        log "Commit already in queue"
    else
        # Add to queue using node
        node -e "
        const fs = require('fs');
        const queue = JSON.parse(fs.readFileSync('$QUEUE_FILE', 'utf8'));
        queue.push({
            commit_hash: '$CURRENT_COMMIT',
            agent_type: '$AGENT_TYPE',
            priority: 1,
            queued_at: new Date().toISOString()
        });
        fs.writeFileSync('$QUEUE_FILE', JSON.stringify(queue, null, 2));
        " 2>/dev/null || true
        success "Added to deployment queue"
    fi
else
    # Create new queue
    echo "[{\"commit_hash\":\"$CURRENT_COMMIT\",\"agent_type\":\"$AGENT_TYPE\",\"priority\":1,\"queued_at\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"}]" > "$QUEUE_FILE"
    success "Created deployment queue"
fi

# Step 5: Deploy to VPS
log "Step 5: Deploying to VPS ($VPS_IP)..."
echo ""

# Check SSH connectivity
if ! ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_IP}" "echo 'SSH OK'" > /dev/null 2>&1; then
    error "Cannot connect to VPS via SSH"
    echo ""
    echo "To deploy manually, run on VPS:"
    echo "  cd /root/xsjprd55 && git pull && pm2 reload all"
    exit 1
fi

success "SSH connection OK"

# Run deployment on VPS
log "Running deployment commands on VPS..."

ssh "${VPS_USER}@${VPS_IP}" << EOF
cd /root/xsjprd55 || exit 1

echo "📥 Pulling latest code..."
git pull origin main

echo "📦 Installing dependencies..."
npm install

echo "🔄 Reloading PM2..."
pm2 reload all
pm2 save

echo "⏳ Waiting for services..."
sleep 5

echo "🏥 Health check..."
if curl -sf --max-time 5 http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "✅ Health check PASSED"
else
    echo "❌ Health check FAILED"
    exit 1
fi

echo "✅ Deployment complete"
EOF

if [ $? -eq 0 ]; then
    success "VPS deployment successful!"
    
    # Update deploy state
    node -e "
    const fs = require('fs');
    const stateFile = '.deploy-state.json';
    let state = {};
    if (fs.existsSync(stateFile)) {
        state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
    state.lastDeployCommit = '$CURRENT_COMMIT';
    state.lastDeployTime = new Date().toISOString();
    state.lastDeployStatus = 'success';
    state.consecutiveFailures = 0;
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    " 2>/dev/null || true
    
    # Remove from queue
    if [ -f "$QUEUE_FILE" ]; then
        node -e "
        const fs = require('fs');
        try {
            const queue = JSON.parse(fs.readFileSync('$QUEUE_FILE', 'utf8'));
            const filtered = queue.filter(q => q.commit_hash !== '$CURRENT_COMMIT');
            fs.writeFileSync('$QUEUE_FILE', JSON.stringify(filtered, null, 2));
        } catch(e) {}
        " 2>/dev/null || true
    fi
    
else
    error "VPS deployment failed!"
    exit 1
fi

echo ""
echo "============================================"
success "DEPLOYMENT COMPLETE!"
echo "============================================"
echo ""
echo "Summary:"
echo "  Commit: $SHORT_COMMIT"
echo "  Agent:  $AGENT_TYPE"
echo "  VPS:    $VPS_IP"
echo "  Time:   $(date -u +"%H:%M:%S UTC")"
echo ""
echo "View status:"
echo "  Dashboard: http://localhost:3000/api/deployment-dashboard"
echo "  PM2:       ssh $VPS_USER@$VPS_IP 'pm2 status'"
echo ""