#!/bin/bash
# Force-fix Kimi PM2 environment reload
# Run on VPS: bash scripts/fix-kimi-pm2.sh

cd "$(dirname "$0")/.."

echo "=== Kimi PM2 Force-Reload ==="

# 1. Ensure KIMI_BASE_URL is explicitly set in .env
if ! grep -q "^KIMI_BASE_URL=" .env 2>/dev/null; then
  echo "Adding KIMI_BASE_URL to .env..."
  echo "" >> .env
  echo "KIMI_BASE_URL=https://api.moonshot.ai/v1" >> .env
  echo "Added KIMI_BASE_URL=https://api.moonshot.ai/v1"
else
  echo "KIMI_BASE_URL already in .env"
  # Also verify it's .ai not .cn
  if grep "^KIMI_BASE_URL=" .env | grep -q "\.cn"; then
    echo "WARNING: KIMI_BASE_URL still points to .cn! Fixing..."
    sed -i 's|https://api.moonshot.cn/v1|https://api.moonshot.ai/v1|g' .env
    echo "Fixed to .ai"
  fi
fi

# 2. Hard restart PM2 to pick up fresh .env
echo ""
echo "Stopping all PM2 processes..."
pm2 delete all

echo ""
echo "Starting fresh with ecosystem.config.cjs..."
pm2 start ecosystem.config.cjs

echo ""
echo "Saving PM2 config..."
pm2 save

echo ""
echo "=== Done ==="
echo "Wait 10 seconds, then check dashboard."
echo "If still offline, run: bash scripts/diagnose-kimi.sh"
