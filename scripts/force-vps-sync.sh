#!/bin/bash
# ============================================================
# Force-sync VPS with latest GitHub main branch
# Run this ON YOUR VPS (via SSH)
# WARNING: This discards any local changes on the VPS
# ============================================================

cd ~/xsjprd55 || exit 1

echo "=== 1. Checking current git status ==="
git status --short

echo ""
echo "=== 2. Fetching latest from GitHub ==="
git fetch origin main

echo ""
echo "=== 3. Hard reset to origin/main ==="
git reset --hard origin/main

echo ""
echo "=== 4. Verifying key files updated ==="
echo "--- lib/supabase.js first 15 lines ---"
head -15 lib/supabase.js

echo ""
echo "--- public/index.html Strategy Labs check ---"
grep -n "Strategy Labs" public/index.html || echo "WARNING: Strategy Labs NOT found"

echo ""
echo "=== 5. Installing dependencies ==="
npm install

echo ""
echo "=== 6. Restarting PM2 with updated env ==="
pm2 restart xsjprd55 --update-env

echo ""
echo "=== 7. PM2 status ==="
pm2 status xsjprd55

echo ""
echo "=== 8. Recent logs (first 20 lines) ==="
pm2 logs xsjprd55 --lines 20 --nostream
