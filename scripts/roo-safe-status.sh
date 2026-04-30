#!/bin/bash
# ============================================================
# Roo Safe Status Script — VPS Health Check
# Non-destructive diagnostic script for autonomous loop
# ============================================================

set -e

cd /root/xsjprd55 || exit 1

echo "============================================"
echo "🤖 ROO AUTONOMOUS STATUS CHECK"
echo "Time: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "============================================"

echo ""
echo "📁 GIT STATUS"
echo "--------------------------------------------"
git log --oneline -3 || echo "Git not available"
git status --short 2>/dev/null || echo "No git changes"

echo ""
echo "🐳 DOCKER STATUS"
echo "--------------------------------------------"
docker compose ps 2>/dev/null || echo "Docker not running or no compose file"

echo ""
echo "⚙️ PM2 STATUS"
echo "--------------------------------------------"
pm2 status 2>/dev/null || echo "PM2 not running"

echo ""
echo "📊 DISK USAGE"
echo "--------------------------------------------"
df -h / | tail -1 || echo "Disk info unavailable"

echo ""
echo "🧠 MEMORY USAGE"
echo "--------------------------------------------"
free -h 2>/dev/null || echo "Memory info unavailable"

echo ""
echo "🔌 HEALTH CHECK"
echo "--------------------------------------------"
curl -sf --max-time 5 http://localhost:3000/api/health 2>/dev/null && echo "✅ API Health: OK" || echo "❌ API Health: FAIL"
curl -sf --max-time 5 http://localhost:3000/health 2>/dev/null && echo "✅ Server Health: OK" || echo "❌ Server Health: FAIL"

echo ""
echo "📝 RECENT PM2 LOGS (Last 20 lines)"
echo "--------------------------------------------"
pm2 logs --lines 20 --nostream 2>/dev/null || echo "No PM2 logs available"

echo ""
echo "============================================"
echo "✅ Status check complete"
echo "============================================"
