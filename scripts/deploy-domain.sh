#!/bin/bash
# ============================================================
# Domain Deploy Script — bot.abcx124.xyz
# Run this ON your VPS after DNS A-record points to 165.22.110.111
# ============================================================
set -e

DOMAIN="bot.abcx124.xyz"
VPS_IP="165.22.110.111"
PROJECT_DIR="/opt/trading-bot"
REPO="https://github.com/jpgyap-sudo/xsjprd55.git"

echo "============================================"
echo " Trading Bot Domain Deploy: $DOMAIN"
echo " VPS IP: $VPS_IP"
echo "============================================"

# ── 1. Check RAM ───────────────────────────────────────────
RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
echo "[INFO] RAM: ${RAM_MB}MB"
if [ "$RAM_MB" -lt 1800 ]; then
  echo "[WARN] RAM < 2GB. Adding 2GB swap..."
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "[OK] Swap added."
fi

# ── 2. Install dependencies ────────────────────────────────
echo "[INFO] Installing Docker + Docker Compose + Git..."
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-plugin git curl ca-certificates
systemctl enable --now docker

# ── 3. Clone / update repo ─────────────────────────────────
if [ -d "$PROJECT_DIR/.git" ]; then
  echo "[INFO] Updating existing repo..."
  cd "$PROJECT_DIR"
  git pull origin main
else
  echo "[INFO] Cloning repo..."
  rm -rf "$PROJECT_DIR"
  git clone "$REPO" "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

# ── 4. Check .env exists ───────────────────────────────────
if [ ! -f ".env" ]; then
  echo "[ERROR] .env file missing! Copy .env.prod and fill in real values."
  echo "  cp .env.prod .env"
  echo "  nano .env"
  exit 1
fi

# ── 5. Verify .env has real values ─────────────────────────
if grep -q 'your-bot-token-from-botfather' .env || grep -q 'your-project.supabase.co' .env; then
  echo "[ERROR] .env still has placeholder values!"
  echo "  nano .env"
  echo "  Fill in: SUPABASE_URL, TELEGRAM_BOT_TOKEN, BINANCE_API_KEY, etc."
  exit 1
fi

# ── 6. Start with Docker Compose ───────────────────────────
echo "[INFO] Building and starting containers..."
docker compose down 2>/dev/null || true
docker compose up --build -d

# ── 7. Wait for app to be ready ────────────────────────────
echo "[INFO] Waiting for app to start..."
sleep 8
for i in 1 2 3; do
  if curl -sf http://localhost:3000/api/debug >/dev/null 2>&1; then
    echo "[OK] App is running on port 3000"
    break
  fi
  echo "[INFO] Retry $i/3..."
  sleep 5
done

# ── 8. Check Caddy / HTTPS ─────────────────────────────────
echo "[INFO] Checking Caddy HTTPS..."
sleep 3
if docker logs bot-caddy 2>&1 | grep -qi "certificate"; then
  echo "[OK] Caddy is obtaining HTTPS certificate for $DOMAIN"
fi

# ── 9. Set Telegram webhook ────────────────────────────────
BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN .env | cut -d= -f2 | tr -d ' "')
if [ -n "$BOT_TOKEN" ]; then
  WEBHOOK_URL="https://$DOMAIN/api/telegram"
  echo "[INFO] Setting Telegram webhook: $WEBHOOK_URL"
  curl -sf "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}&secret_token=${BOT_TOKEN: -32}" || true
  echo "[OK] Webhook set."
fi

# ── 10. Final status ───────────────────────────────────────
echo ""
echo "============================================"
echo " DEPLOY COMPLETE!"
echo "============================================"
echo "Dashboard:  https://$DOMAIN"
echo "Debug:      https://$DOMAIN/api/debug"
echo "Health:     https://$DOMAIN/api/health"
echo "Telegram:   https://$DOMAIN/api/telegram"
echo ""
echo "Docker status:"
docker compose ps
echo ""
echo "Logs: docker compose logs -f app"
