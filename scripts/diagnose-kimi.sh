#!/bin/bash
# Kimi API Diagnostic Script for VPS
# Run: bash scripts/diagnose-kimi.sh

cd "$(dirname "$0")/.."

echo "========================================"
echo "Kimi API Diagnostic"
echo "========================================"
echo ""

echo "--- 1. Codebase URL check (.cn vs .ai) ---"
if grep -r "moonshot\.cn" lib/ api/ workers/ --include="*.js" 2>/dev/null | grep -v node_modules; then
  echo "WARNING: Found .cn references above!"
else
  echo "OK: No .cn references found in code"
fi
echo ""

echo "--- 2. .env file KIMI values ---"
if [ -f .env ]; then
  grep "^KIMI" .env | sed 's/\(KIMI_API_KEY=.\{20\}\).*/\1.../' || echo "No KIMI_ vars in .env"
else
  echo "ERROR: .env file not found"
fi
echo ""

echo "--- 3. Direct API test ---"
KIMI_KEY=$(grep '^KIMI_API_KEY=' .env 2>/dev/null | cut -d'=' -f2- | tr -d '\r')
KIMI_URL=$(grep '^KIMI_BASE_URL=' .env 2>/dev/null | cut -d'=' -f2- | tr -d '\r')

if [ -z "$KIMI_KEY" ]; then
  echo "ERROR: KIMI_API_KEY not found in .env"
  exit 1
fi

if [ -z "$KIMI_URL" ]; then
  echo "NOTE: KIMI_BASE_URL not in .env, code will use fallback"
  KIMI_URL="https://api.moonshot.ai/v1"
fi

echo "Testing URL: $KIMI_URL"
echo "Key prefix: ${KIMI_KEY:0:20}..."
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" \
  "$KIMI_URL/chat/completions" \
  -H "Authorization: Bearer $KIMI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"kimi-latest","messages":[{"role":"user","content":"Hi"}],"max_tokens":1}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo "Response: $(echo "$BODY" | head -c 300)"
echo ""

echo "--- 4. PM2 environment check ---"
PM2_WEB=$(pm2 env xsjprd55-web 2>/dev/null | grep KIMI_BASE_URL || echo "NOT FOUND")
PM2_API=$(pm2 env xsjprd55-api 2>/dev/null | grep KIMI_BASE_URL || echo "NOT FOUND")
echo "xsjprd55-web KIMI_BASE_URL: $PM2_WEB"
echo "xsjprd55-api KIMI_BASE_URL: $PM2_API"
echo ""

echo "--- 5. Interpretation ---"
case "$HTTP_CODE" in
  200)
    echo "RESULT: Kimi API is WORKING. If dashboard still shows Offline, restart PM2 with:"
    echo "  pm2 delete all && pm2 start ecosystem.config.cjs"
    ;;
  401)
    echo "RESULT: API Key is INVALID or REVOKED. Get a new key from https://platform.moonshot.ai"
    ;;
  404)
    echo "RESULT: URL or model not found. Check KIMI_BASE_URL and ensure code uses 'kimi-latest'"
    ;;
  429)
    echo "RESULT: Rate limited. Wait a minute and try again."
    ;;
  000)
    echo "RESULT: Connection failed (DNS/Network). Check URL and internet connectivity."
    ;;
  *)
    echo "RESULT: Unexpected status $HTTP_CODE. Check response body above."
    ;;
esac
