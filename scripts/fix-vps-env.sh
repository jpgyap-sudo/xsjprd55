#!/bin/bash
# ============================================================
# Fix VPS .env and restart PM2 with updated environment
# Run this ON YOUR VPS (via SSH)
# ============================================================

cd ~/xsjprd55 || exit 1

# Restart PM2 with --update-env so it reads the new .env
pm2 restart xsjprd55 --update-env

# Show status
pm2 status xsjprd55

# Check latest logs for Supabase errors
echo "--- Last 30 log lines ---"
pm2 logs xsjprd55 --lines 30 --nostream

# Verify public/index.html contains Strategy Labs
echo "--- Checking if index.html has Strategy Labs panel ---"
grep -n "Strategy Labs" public/index.html || echo "WARNING: Strategy Labs not found in index.html"
