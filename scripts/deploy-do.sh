#!/usr/bin/env bash
# ============================================================
# DigitalOcean + Docker Deployment Script
# Run this on your Droplet after cloning the repo.
# ============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"

echo "========================================"
echo "Trading Signal Bot — DigitalOcean Deploy"
echo "========================================"

# 1. Check Docker
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER" || true
    echo "✅ Docker installed. You may need to log out and back in."
fi
echo "✅ Docker available: $(docker -v)"

# 2. Check Docker Compose
if ! docker compose version &> /dev/null && ! docker-compose --version &> /dev/null; then
    echo "📦 Installing Docker Compose plugin..."
    sudo apt-get update && sudo apt-get install -y docker-compose-plugin
fi
echo "✅ Docker Compose available"

# 3. Check .env
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ .env file not found at $ENV_FILE"
    echo "   Copy .env.example to .env and fill in your secrets."
    exit 1
fi
echo "✅ .env file found"

# 4. Pull latest code (optional)
# git pull origin main

# 5. Build and start containers
cd "$PROJECT_DIR"
echo "🔨 Building Docker image..."
docker compose build --no-cache

echo "🚀 Starting containers..."
docker compose up -d

# 6. Verify health
sleep 5
HEALTH=$(docker inspect --format='{{.State.Health.Status}}' trading-signal-bot 2>/dev/null || echo "unknown")
echo "🩺 Container health: $HEALTH"

echo ""
echo "========================================"
echo "✅ Deploy complete!"
echo "========================================"
echo "App URL:    http://$(curl -s ifconfig.me):${APP_PORT:-3000}"
echo "Logs:       docker logs -f trading-signal-bot"
echo "Stop:       docker compose down"
echo "Restart:    docker compose restart"
echo ""
echo "Set Telegram webhook:"
echo "  https://api.telegram.org/bot<TOKEN>/setWebhook?url=http://$(curl -s ifconfig.me):${APP_PORT:-3000}/api/telegram"
echo ""
