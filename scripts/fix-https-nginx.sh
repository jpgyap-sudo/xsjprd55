#!/bin/bash
# ============================================================
# Fix HTTPS on VPS when nginx (not Caddy) is serving HTTP
# Run this via DigitalOcean Web Console
# ============================================================
set -e

echo "========================================"
echo "  Fix HTTPS — Nginx to Caddy Migration"
echo "========================================"

# ── Find project ──────────────────────────────────────────
PROJECT_DIR="/opt/trading-bot"
cd "$PROJECT_DIR" 2>/dev/null || cd ~/xsjprd55 2>/dev/null || {
  echo "ERROR: Project not found at /opt/trading-bot or ~/xsjprd55"
  exit 1
}

echo "Working dir: $(pwd)"

# ── Stop nginx (it's holding port 80) ─────────────────────
echo "[1/5] Stopping nginx (it holds port 80)..."
systemctl stop nginx 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true

# ── Ensure Docker is running ──────────────────────────────
echo "[2/5] Checking Docker..."
if ! systemctl is-active --quiet docker 2>/dev/null; then
  systemctl start docker
fi

# ── Start Docker Compose stack ────────────────────────────
echo "[3/5] Starting Docker Compose stack..."
docker compose down 2>/dev/null || true
docker compose up -d --build

echo "  Waiting 15s for services..."
sleep 15

# ── Verify ────────────────────────────────────────────────
echo "[4/5] Verifying..."
echo ""
echo "--- Containers ---"
docker compose ps

echo ""
echo "--- Ports ---"
ss -tlnp | grep -E ':(80|443|3000|8010)' || true

echo ""
echo "--- HTTP check ---"
curl -s -o /dev/null -w "  Status: %{http_code}\n" http://localhost/

echo ""
echo "--- App health ---"
curl -s http://localhost:3000/api/health | head -c 200 || true
echo ""

# ── Test HTTPS (may take 60s for cert) ────────────────────
echo ""
echo "[5/5] Checking HTTPS..."
sleep 5
curl -s -o /dev/null -w "  HTTPS Status: %{http_code}\n" https://localhost/ -k 2>/dev/null || echo "  HTTPS: Not ready yet (Caddy may still be fetching cert)"

echo ""
echo "========================================"
echo "  Done!"
echo "========================================"
echo ""
echo "Caddy needs ~30-60s to get the first SSL certificate."
echo "Monitor with: docker compose logs -f caddy"
echo ""
echo "If HTTPS still fails after 2 minutes, check:"
echo "  1. DNS A-record points to this server IP"
echo "  2. Port 443 is open in firewall (ufw allow 443/tcp)"
echo ""
