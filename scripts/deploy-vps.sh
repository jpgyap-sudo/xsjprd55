#!/usr/bin/env bash
# ============================================================
# VPS Deployment Script — One-command deploy for VPS hosts
# Run on your VPS after cloning the repo.
# ============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"

echo "========================================"
echo "Trading Signal Bot — VPS Deploy"
echo "========================================"

# 1. Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' || echo "none")
if [ "$NODE_VERSION" = "none" ]; then
    echo "❌ Node.js is not installed. Please install Node.js 20+ first."
    exit 1
fi
REQUIRED=20
MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$MAJOR" -lt "$REQUIRED" ]; then
    echo "❌ Node.js $NODE_VERSION is too old. Please upgrade to Node.js 20+."
    exit 1
fi
echo "✅ Node.js $NODE_VERSION"

# 2. Check .env
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ .env file not found at $ENV_FILE"
    echo "   Copy .env.example to .env and fill in your secrets."
    exit 1
fi
echo "✅ .env file found"

# 3. Install dependencies
echo "📦 Installing dependencies..."
cd "$PROJECT_DIR"
npm install

# 4. Create log directory
mkdir -p "$PROJECT_DIR/logs"

# 5. Install PM2 if not present
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2 globally..."
    npm install -g pm2
fi
echo "✅ PM2 available"

# 6. Start/restart with PM2
echo "🚀 Starting bot with PM2..."
pm2 restart ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs

# 7. Save PM2 process list
pm2 save

# 8. Setup PM2 startup script (if not already done)
pm2 startup systemd &>/dev/null || true

echo ""
echo "========================================"
echo "✅ Deploy complete!"
echo "========================================"
echo "Logs:    pm2 logs trading-signal-bot"
echo "Status:  pm2 status"
echo "Stop:    pm2 stop trading-signal-bot"
echo "Restart: pm2 restart trading-signal-bot"
echo ""
echo "Health check: curl http://localhost:3000/api/debug"
echo ""
