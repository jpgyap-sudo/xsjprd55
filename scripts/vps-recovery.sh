#!/bin/bash
# ============================================================
# VPS Recovery Script — bot.abcx124.xyz
# Run this via DigitalOcean Web Console when HTTPS is down
# ============================================================
set -e

echo "========================================"
echo "  Trading Bot VPS Recovery"
echo "========================================"

PROJECT_DIR="/opt/trading-bot"
cd "$PROJECT_DIR" 2>/dev/null || cd ~/xsjprd55 2>/dev/null || {
  echo "ERROR: Project directory not found."
  echo "Expected /opt/trading-bot or ~/xsjprd55"
  exit 1
}

echo "[1/6] Working directory: $(pwd)"

# ── Check Docker ──────────────────────────────────────────
echo "[2/6] Checking Docker..."
if ! command -v docker &>/dev/null; then
  echo "  ERROR: Docker not installed!"
  exit 1
fi
if ! docker info &>/dev/null; then
  echo "  ERROR: Docker daemon not running!"
  echo "  Try: systemctl start docker"
  exit 1
fi
echo "  Docker OK"

# ── Check running containers ──────────────────────────────
echo "[3/6] Checking containers..."
docker compose ps

echo ""
echo "--- Caddy logs (last 30 lines) ---"
docker compose logs --tail 30 caddy 2>/dev/null || echo "  No caddy logs (container may not exist)"

echo ""
echo "--- App logs (last 20 lines) ---"
docker compose logs --tail 20 app 2>/dev/null || echo "  No app logs"

# ── Diagnose HTTPS issue ──────────────────────────────────
echo ""
echo "[4/6] Diagnosing HTTPS..."

# Check if port 443 is listening
if ss -tlnp | grep -q ':443'; then
  echo "  Port 443: LISTENING"
else
  echo "  Port 443: NOT LISTENING (Caddy is likely down)"
fi

# Check if port 80 is listening
if ss -tlnp | grep -q ':80'; then
  echo "  Port 80: LISTENING"
else
  echo "  Port 80: NOT LISTENING"
fi

# Check Caddy data volume for cert issues
CADDY_DATA="$(docker volume inspect -f '{{ .Mountpoint }}' xsjprd55_caddy_data 2>/dev/null || true)"
if [ -n "$CADDY_DATA" ] && [ -d "$CADDY_DATA" ]; then
  echo "  Caddy data volume: $CADDY_DATA"
  # Count certificates
  CERT_COUNT=$(find "$CADDY_DATA" -name "*.crt" 2>/dev/null | wc -l)
  echo "  Certificates found: $CERT_COUNT"
fi

# ── Attempt recovery ──────────────────────────────────────
echo ""
echo "[5/6] Attempting recovery..."

echo "  Stopping any existing stack..."
docker compose down 2>/dev/null || true

echo "  Rebuilding and starting..."
docker compose up -d --build

echo "  Waiting 10s for services to start..."
sleep 10

echo ""
echo "--- Container status after restart ---"
docker compose ps

# ── Verify ────────────────────────────────────────────────
echo ""
echo "[6/6] Verifying endpoints..."

echo "  Checking HTTP (port 80)..."
curl -s -o /dev/null -w "  HTTP Status: %{http_code}\n" http://localhost/ || true

echo "  Checking app health..."
curl -s http://localhost:3000/api/health | head -c 200 || true
echo ""

echo "  Checking HTTPS (port 443)..."
curl -s -o /dev/null -w "  HTTPS Status: %{http_code}\n" https://localhost/ -k 2>/dev/null || echo "  HTTPS: Not responding (cert may still be provisioning)"

echo ""
echo "========================================"
echo "  Recovery complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Wait 30-60s for Caddy to get SSL cert (first time can take a minute)"
echo "2. Test: curl https://bot.abcx124.xyz/api/health"
echo "3. If HTTPS still fails after 2 min, check Caddy logs:"
echo "   docker compose logs -f caddy"
echo ""
