#!/bin/bash
# ONE-CLICK DEPLOY for DigitalOcean VPS
# Run this on your VPS Web Console after resizing to 2GB RAM

set -e

PROJECT_DIR="/opt/trading-bot"
REPO="https://github.com/jpgyap-sudo/xsjprd55.git"

echo "========================================"
echo "  Trading Bot v2.1.0 - VPS Deploy"
echo "========================================"

# 1. Check RAM
echo "[1/7] Checking system resources..."
RAM=$(free -m | awk '/Mem:/ {print $2}')
echo "  RAM: ${RAM}MB"
if [ "$RAM" -lt 1800 ]; then
  echo "  WARNING: RAM is less than 2GB. Please resize your droplet first."
  echo "  DigitalOcean → Droplets → Resize → Basic: 2GB RAM"
  exit 1
fi

# 2. Install dependencies
echo "[2/7] Installing dependencies..."
apt-get update -qq
apt-get install -y -qq git curl build-essential python3 python3-pip nginx 2>/dev/null || true

# 3. Install Node.js 20
echo "[3/7] Installing Node.js 20..."
if ! node --version 2>/dev/null | grep -q "v20"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo "  Node: $(node --version)"

# 4. Clone or update repo
echo "[4/7] Getting code from GitHub..."
if [ -d "$PROJECT_DIR/.git" ]; then
  cd "$PROJECT_DIR"
  git pull origin main
else
  git clone "$REPO" "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

# 5. Install npm packages
echo "[5/7] Installing npm packages..."
npm install --omit=dev
npx playwright install chromium

# 6. Check .env
echo "[6/7] Checking environment file..."
if [ ! -f ".env" ]; then
  echo "  .env not found! Creating from .env.example..."
  cp .env.example .env
  echo "  IMPORTANT: You MUST edit .env with real credentials:"
  echo "    nano /opt/trading-bot/.env"
  echo "  Then run this script again."
  exit 1
fi

if grep -q "your-supabase-url" .env 2>/dev/null || grep -q "your-telegram-bot-token" .env 2>/dev/null; then
  echo "  WARNING: .env still contains placeholder values!"
  echo "  Please edit: nano /opt/trading-bot/.env"
  echo "  Replace all 'your-...' placeholders with real values."
  exit 1
fi

echo "  .env looks configured."

# 7. Start with PM2
echo "[7/7] Starting server with PM2..."
npm install -g pm2 2>/dev/null || true

pm2 delete trading-bot 2>/dev/null || true
pm2 start server.js --name trading-bot --max-memory-restart 1500M
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo "========================================"
echo "  DEPLOYMENT COMPLETE!"
echo "========================================"
echo ""
echo "Server running at: http://165.22.110.111:3000"
echo ""
echo "Check status:    pm2 status"
echo "View logs:       pm2 logs trading-bot"
echo "Stop server:     pm2 stop trading-bot"
echo "Restart server:  pm2 restart trading-bot"
echo ""
echo "NEXT STEPS:"
echo "1. Open firewall: ufw allow 3000/tcp && ufw enable"
echo "2. Set Telegram webhook (see WEBHOOK-SETUP.txt)"
echo ""
