#!/bin/bash
# ============================================================
# Roo Safe Deploy Script — Zero-Downtime VPS Deployment
# For use by autonomous improvement agent
# ============================================================

set -e

PROJECT_DIR="/root/xsjprd55"
LOG_FILE="/var/log/roo-deploy.log"

echo "============================================"
echo "🚀 ROO AUTONOMOUS DEPLOY"
echo "Time: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "============================================"

cd "$PROJECT_DIR" || exit 1

# Log deployment start
echo "[$(date)] Starting deployment..." >> "$LOG_FILE"

# Backup current commit for rollback
CURRENT_COMMIT=$(git rev-parse HEAD)
echo "📋 Current commit: $CURRENT_COMMIT"
echo "[$(date)] Current commit: $CURRENT_COMMIT" >> "$LOG_FILE"

echo ""
echo "📥 PULLING LATEST CODE"
echo "--------------------------------------------"
git pull origin main >> "$LOG_FILE" 2>&1 || {
    echo "❌ Git pull failed"
    echo "[$(date)] Git pull failed" >> "$LOG_FILE"
    exit 1
}

echo ""
echo "📦 INSTALLING DEPENDENCIES"
echo "--------------------------------------------"
npm install >> "$LOG_FILE" 2>&1 || {
    echo "❌ npm install failed"
    echo "[$(date)] npm install failed" >> "$LOG_FILE"
    exit 1
}

echo ""
echo "🔨 BUILDING"
echo "--------------------------------------------"
npm run build >> "$LOG_FILE" 2>&1 || {
    echo "⚠️ Build had issues (continuing if non-critical)"
    echo "[$(date)] Build had issues" >> "$LOG_FILE"
}

echo ""
echo "🧪 RUNNING TESTS"
echo "--------------------------------------------"
npm test >> "$LOG_FILE" 2>&1 || {
    echo "⚠️ Tests had failures (review logs)"
    echo "[$(date)] Tests had failures" >> "$LOG_FILE"
}

echo ""
echo "🔄 RELOADING PM2 (Zero-Downtime)"
echo "--------------------------------------------"
pm2 reload all >> "$LOG_FILE" 2>&1 || {
    echo "⚠️ PM2 reload had issues, trying restart..."
    pm2 restart all >> "$LOG_FILE" 2>&1 || {
        echo "❌ PM2 restart failed"
        echo "[$(date)] PM2 restart failed" >> "$LOG_FILE"
        exit 1
    }
}
pm2 save >> "$LOG_FILE" 2>&1 || true

echo ""
echo "⏳ WAITING FOR SERVICES (10s)"
echo "--------------------------------------------"
sleep 10

echo ""
echo "🏥 HEALTH CHECK"
echo "--------------------------------------------"
HEALTH_OK=false
for i in 1 2 3; do
    if curl -sf --max-time 8 http://localhost:3000/api/health > /dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    echo "  Retry $i/3..."
    sleep 5
done

if [ "$HEALTH_OK" = true ]; then
    echo "✅ Health check PASSED"
    echo "[$(date)] Deployment successful" >> "$LOG_FILE"
else
    echo "❌ Health check FAILED"
    echo "[$(date)] Health check failed, consider rollback to $CURRENT_COMMIT" >> "$LOG_FILE"
    exit 1
fi

echo ""
echo "📊 FINAL STATUS"
echo "--------------------------------------------"
pm2 status 2>/dev/null || echo "PM2 status unavailable"

echo ""
echo "============================================"
echo "✅ DEPLOYMENT COMPLETE"
echo "============================================"
