#!/bin/bash
# ============================================================
# VPS Deployment Script for Commit 5fe8f50
# feat: Bug Hunter Agent + Trader Fixes + Research Agent Sync
# Run this on your VPS (ssh root@165.22.110.111)
# ============================================================

set -e  # Exit on error

COMMIT_SHA="5fe8f50"
COMMIT_MSG="feat: Bug Hunter Agent + Trader Fixes + Research Agent Sync"
VPS_PROJECT_PATH="~/xsjprd55"

echo "========================================"
echo "🚀 Deploying Commit ${COMMIT_SHA}"
echo "${COMMIT_MSG}"
echo "========================================"
echo ""

# Step 1: Navigate to project
echo "[1/8] Checking project directory..."
cd ${VPS_PROJECT_PATH} || {
    echo "❌ ERROR: Project not found at ${VPS_PROJECT_PATH}"
    echo "    Please check your VPS project location"
    exit 1
}

# Step 2: Check current commit
echo ""
echo "[2/8] Checking current state..."
CURRENT_COMMIT=$(git rev-parse HEAD | cut -c1-7)
echo "    Current: ${CURRENT_COMMIT}"
echo "    Target:  ${COMMIT_SHA}"

if [ "${CURRENT_COMMIT}" = "${COMMIT_SHA}" ]; then
    echo "    ✅ Already at target commit"
else
    echo "    🔄 Need to update"
fi

# Step 3: Backup .env
echo ""
echo "[3/8] Creating backup..."
cp .env .env.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || echo "    (No .env to backup)"
cp ecosystem.config.cjs ecosystem.config.cjs.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
echo "    ✅ Backup created"

# Step 4: Pull latest code
echo ""
echo "[4/8] Pulling latest code from GitHub..."
git fetch origin main
git reset --hard origin/main
NEW_COMMIT=$(git rev-parse HEAD | cut -c1-7)
echo "    ✅ Updated to: ${NEW_COMMIT}"

# Step 5: Install dependencies
echo ""
echo "[5/8] Installing dependencies..."
npm install
echo "    ✅ Dependencies installed"

# Step 6: Check if Supabase SQL needs to be run
echo ""
echo "[6/8] SQL Migration Notice..."
echo "    ⚠️  IMPORTANT: Run this SQL in Supabase SQL Editor:"
echo "       File: supabase/fix-trader-not-trading.sql"
echo ""
echo "    Or run locally with DB_PASSWORD set:"
echo "       DB_PASSWORD=your-db-pass node scripts/run-sql-supabase.mjs"
echo ""
read -p "    Press Enter to continue after SQL is applied..."

# Step 7: PM2 Reload
echo ""
echo "[7/8] Reloading PM2 processes..."
pm2 reload ecosystem.config.cjs --update-env || pm2 restart all --update-env
echo "    ✅ PM2 processes reloaded"

# Step 8: Start new workers
echo ""
echo "[8/8] Starting new workers..."

# Start Bug Hunter Worker
if pm2 describe bug-hunter-worker > /dev/null 2>&1; then
    echo "    🔄 Restarting bug-hunter-worker..."
    pm2 restart bug-hunter-worker --update-env
else
    echo "    🆕 Starting bug-hunter-worker..."
    pm2 start workers/bug-hunter-worker.js --name bug-hunter-worker --time
fi

# Start Backtest Sync Worker
if pm2 describe backtest-sync-worker > /dev/null 2>&1; then
    echo "    🔄 Restarting backtest-sync-worker..."
    pm2 restart backtest-sync-worker --update-env
else
    echo "    🆕 Starting backtest-sync-worker..."
    pm2 start workers/backtest-sync-worker.js --name backtest-sync-worker --time
fi

# Start VPS Deployer Agent
if pm2 describe vps-deployer-agent > /dev/null 2>&1; then
    echo "    🔄 Restarting vps-deployer-agent..."
    pm2 restart vps-deployer-agent --update-env
else
    echo "    🆕 Starting vps-deployer-agent..."
    pm2 start workers/vps-deployer-agent.js --name vps-deployer-agent --time --cron "*/2 * * * *"
fi

pm2 save
echo "    ✅ New workers started"

# Health Check
echo ""
echo "========================================"
echo "🏥 Running Health Checks..."
echo "========================================"
sleep 5

HEALTH_STATUS=$(curl -sf --max-time 10 http://localhost:3000/api/health && echo "OK" || echo "FAIL")
if [ "$HEALTH_STATUS" = "OK" ]; then
    echo "✅ Health check: PASSED"
else
    echo "⚠️  Health check: FAILED"
    echo "   Check: curl http://localhost:3000/api/health"
fi

echo ""
pm2 status | grep -E "(App name|bug-hunter|backtest-sync|vps-deployer)"

echo ""
echo "========================================"
echo "✅ DEPLOYMENT COMPLETE"
echo "========================================"
echo ""
echo "Summary:"
echo "  • Commit: ${COMMIT_SHA}"
echo "  • New Workers: bug-hunter-worker, backtest-sync-worker, vps-deployer-agent"
echo "  • Fixes Applied: Trader execution, Research Agent backtest sync"
echo ""
echo "Next Steps:"
echo "  1. Verify health: curl http://localhost:3000/api/health"
echo "  2. Check logs: pm2 logs"
echo "  3. Monitor Telegram for trading signals"
echo ""
echo "Rollback if needed:"
echo "  git reset --hard ${CURRENT_COMMIT}"
echo "  pm2 restart all"
echo ""
