#!/bin/bash
# One-command VPS setup for Trading Signal Bot
# Run this on your VPS as root

set -e

echo "[SETUP] Starting VPS setup..."

# 1. Clone repo
echo "[SETUP] Cloning repository..."
cd ~
if [ ! -d "xsjprd55" ]; then
  git clone https://github.com/jpgyap-sudo/xsjprd55.git
fi
cd xsjprd55

# 2. Start Docker (if not running)
echo "[SETUP] Starting Docker..."
service docker start 2>/dev/null || true

# 3. Create .env if it doesn't exist
if [ ! -f ".env" ]; then
  echo "[SETUP] Creating .env from .env.example..."
  cp .env.example .env
  echo ""
  echo "[WARNING] .env file created with placeholder values."
  echo "[WARNING] You MUST edit .env and fill in your real secrets:"
  echo "  - SUPABASE_URL"
  echo "  - SUPABASE_SERVICE_KEY"
  echo "  - TELEGRAM_BOT_TOKEN"
  echo "  - TELEGRAM_GROUP_CHAT_ID"
  echo "  - BINANCE_API_KEY"
  echo "  - BINANCE_API_SECRET"
  echo ""
  echo "Edit with: nano .env"
fi

# 4. Build and start containers
echo "[SETUP] Building and starting Docker containers..."
docker compose up -d --build

echo ""
echo "[SETUP] Done! Check status with: docker compose logs -f"
echo "[SETUP] View app at: http://$(curl -s ifconfig.me):3000"
