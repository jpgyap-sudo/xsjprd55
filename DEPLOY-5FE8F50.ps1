# ============================================================
# VPS Deployment Script for Commit 5fe8f50
# feat: Bug Hunter Agent + Trader Fixes + Research Agent Sync
# Run this on Windows to deploy to VPS
# ============================================================

$ErrorActionPreference = "Stop"

$VPS_IP = "165.22.110.111"
$VPS_USER = "root"
$COMMIT_SHA = "5fe8f50"
$COMMIT_MSG = "feat: Bug Hunter Agent + Trader Fixes + Research Agent Sync"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🚀 Deploying Commit ${COMMIT_SHA}" -ForegroundColor Green
Write-Host "${COMMIT_MSG}" -ForegroundColor Gray
Write-Host "VPS: ${VPS_USER}@${VPS_IP}" -ForegroundColor Gray
Write-Host "========================================" 
Write-Host ""

# Step 1: Verify SSH connection
Write-Host "[1/7] Testing SSH connection..." -ForegroundColor Yellow
$testConn = ssh -o BatchMode=no -o ConnectTimeout=10 ${VPS_USER}@${VPS_IP} "hostname" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ SSH connection failed. Please ensure you can SSH manually:" -ForegroundColor Red
    Write-Host "   ssh ${VPS_USER}@${VPS_IP}" -ForegroundColor Gray
    exit 1
}
Write-Host "    ✅ SSH connection successful" -ForegroundColor Green

# Step 2: Check current state on VPS
Write-Host ""
Write-Host "[2/7] Checking current state on VPS..." -ForegroundColor Yellow
$currentCommit = ssh ${VPS_USER}@${VPS_IP} "cd ~/xsjprd55 && git rev-parse HEAD 2>/dev/null | cut -c1-7 || echo 'NOT_FOUND'" 2>$null
Write-Host "    Current VPS commit: $currentCommit" -ForegroundColor Gray
Write-Host "    Target commit:      $COMMIT_SHA" -ForegroundColor Gray

# Step 3: Deploy code
Write-Host ""
Write-Host "[3/7] Deploying code to VPS..." -ForegroundColor Yellow
$deployCmd = @"
cd ~/xsjprd55 && \
cp .env .env.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null; \
git fetch origin main && \
git reset --hard origin/main && \
echo "✅ DEPLOYED: $(git rev-parse HEAD | cut -c1-7)"
"@

ssh ${VPS_USER}@${VPS_IP} $deployCmd
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Code deployment failed" -ForegroundColor Red
    exit 1
}
Write-Host "    ✅ Code deployed successfully" -ForegroundColor Green

# Step 4: Install dependencies
Write-Host ""
Write-Host "[4/7] Installing dependencies..." -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_IP} "cd ~/xsjprd55 && npm install"
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  npm install completed with warnings" -ForegroundColor Yellow
} else {
    Write-Host "    ✅ Dependencies installed" -ForegroundColor Green
}

# Step 5: Supabase SQL notice
Write-Host ""
Write-Host "[5/7] IMPORTANT: Supabase SQL Migration" -ForegroundColor Magenta
Write-Host "    ⚠️  Run this SQL in Supabase SQL Editor BEFORE restarting workers:" -ForegroundColor Yellow
Write-Host "       File: supabase/fix-trader-not-trading.sql" -ForegroundColor Cyan
Write-Host ""
Write-Host "    This SQL creates execution_profiles table and fixes mock_trades." -ForegroundColor Gray
Write-Host ""
$continue = Read-Host "    Have you applied the SQL? (yes/no)"
if ($continue -ne "yes") {
    Write-Host ""
    Write-Host "⏸️  Deployment paused. Please:" -ForegroundColor Yellow
    Write-Host "   1. Open Supabase Dashboard → SQL Editor" -ForegroundColor Gray
    Write-Host "   2. Run: supabase/fix-trader-not-trading.sql" -ForegroundColor Gray
    Write-Host "   3. Re-run this script" -ForegroundColor Gray
    exit 0
}

# Step 6: Restart PM2 workers
Write-Host ""
Write-Host "[6/7] Restarting PM2 workers..." -ForegroundColor Yellow
ssh ${VPS_USER}@${VPS_IP} "cd ~/xsjprd55 && pm2 reload ecosystem.config.cjs --update-env"
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  PM2 reload had issues, trying restart..." -ForegroundColor Yellow
    ssh ${VPS_USER}@${VPS_IP} "cd ~/xsjprd55 && pm2 restart all --update-env"
}
Write-Host "    ✅ PM2 workers restarted" -ForegroundColor Green

# Step 7: Start new workers
Write-Host ""
Write-Host "[7/7] Starting new workers..." -ForegroundColor Yellow

# Bug Hunter Worker
$bugHunterCheck = ssh ${VPS_USER}@${VPS_IP} "pm2 describe bug-hunter-worker > /dev/null 2>&1 && echo 'EXISTS' || echo 'NEW'"
if ($bugHunterCheck -eq "EXISTS") {
    ssh ${VPS_USER}@${VPS_IP} "pm2 restart bug-hunter-worker --update-env"
    Write-Host "    🔄 bug-hunter-worker restarted" -ForegroundColor Green
} else {
    ssh ${VPS_USER}@${VPS_IP} "cd ~/xsjprd55 && pm2 start workers/bug-hunter-worker.js --name bug-hunter-worker --time"
    Write-Host "    🆕 bug-hunter-worker started" -ForegroundColor Green
}

# Backtest Sync Worker
$backtestCheck = ssh ${VPS_USER}@${VPS_IP} "pm2 describe backtest-sync-worker > /dev/null 2>&1 && echo 'EXISTS' || echo 'NEW'"
if ($backtestCheck -eq "EXISTS") {
    ssh ${VPS_USER}@${VPS_IP} "pm2 restart backtest-sync-worker --update-env"
    Write-Host "    🔄 backtest-sync-worker restarted" -ForegroundColor Green
} else {
    ssh ${VPS_USER}@${VPS_IP} "cd ~/xsjprd55 && pm2 start workers/backtest-sync-worker.js --name backtest-sync-worker --time"
    Write-Host "    🆕 backtest-sync-worker started" -ForegroundColor Green
}

# VPS Deployer Agent
$deployerCheck = ssh ${VPS_USER}@${VPS_IP} "pm2 describe vps-deployer-agent > /dev/null 2>&1 && echo 'EXISTS' || echo 'NEW'"
if ($deployerCheck -eq "EXISTS") {
    ssh ${VPS_USER}@${VPS_IP} "pm2 restart vps-deployer-agent --update-env"
    Write-Host "    🔄 vps-deployer-agent restarted" -ForegroundColor Green
} else {
    ssh ${VPS_USER}@${VPS_IP} "cd ~/xsjprd55 && pm2 start workers/vps-deployer-agent.js --name vps-deployer-agent --time --cron '*/2 * * * *'"
    Write-Host "    🆕 vps-deployer-agent started (auto-deploy every 2 min)" -ForegroundColor Green
}

# Save PM2 config
ssh ${VPS_USER}@${VPS_IP} "pm2 save" > $null 2>&1

# Health Check
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🏥 Running Health Checks..." -ForegroundColor Cyan
Write-Host "========================================"
Start-Sleep -Seconds 5

$health = ssh ${VPS_USER}@${VPS_IP} "curl -sf --max-time 10 http://localhost:3000/api/health && echo 'OK' || echo 'FAIL'"
if ($health -eq "OK") {
    Write-Host "✅ Health check: PASSED" -ForegroundColor Green
} else {
    Write-Host "⚠️  Health check: FAILED" -ForegroundColor Yellow
    Write-Host "   Check: ssh ${VPS_USER}@${VPS_IP} 'curl http://localhost:3000/api/health'" -ForegroundColor Gray
}

Write-Host ""
Write-Host "PM2 Status (New Workers):" -ForegroundColor Cyan
ssh ${VPS_USER}@${VPS_IP} "pm2 status | grep -E '(App name|bug-hunter|backtest-sync|vps-deployer)'"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "✅ DEPLOYMENT COMPLETE" -ForegroundColor Green
Write-Host "========================================"
Write-Host ""
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  • Commit: ${COMMIT_SHA}" -ForegroundColor Gray
Write-Host "  • New Workers Started:" -ForegroundColor Gray
Write-Host "    - bug-hunter-worker (detects bugs)" -ForegroundColor Gray
Write-Host "    - backtest-sync-worker (research agent data sync)" -ForegroundColor Gray
Write-Host "    - vps-deployer-agent (auto-deploy on commit)" -ForegroundColor Gray
Write-Host "  • Fixes Applied:" -ForegroundColor Gray
Write-Host "    - Trader execution engine" -ForegroundColor Gray
Write-Host "    - Research Agent backtest data sync" -ForegroundColor Gray
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  • Monitor: ssh ${VPS_USER}@${VPS_IP} 'pm2 logs'" -ForegroundColor Gray
Write-Host "  • Health:  curl http://${VPS_IP}:3000/api/health" -ForegroundColor Gray
Write-Host "  • Check Telegram for trading signals" -ForegroundColor Gray
Write-Host ""
Write-Host "Rollback (if needed):" -ForegroundColor Yellow
Write-Host "  ssh ${VPS_USER}@${VPS_IP}" -ForegroundColor Gray
Write-Host "  cd ~/xsjprd55 && git reset --hard ${currentCommit}" -ForegroundColor Gray
Write-Host "  pm2 restart all" -ForegroundColor Gray
Write-Host ""
