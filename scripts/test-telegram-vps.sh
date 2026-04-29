#!/bin/bash
set -e
cd /opt/trading-bot
export $(grep -v '^#' .env | xargs)
echo "TOKEN=${TELEGRAM_BOT_TOKEN:0:8}... GROUP=${TELEGRAM_GROUP_CHAT_ID}"
MSG="🤖+Bot+test+$(date -u +%H:%M)+UTC+-+webhook+env+fixed!+Reply+with+/status+to+test+interactive+mode."
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_GROUP_CHAT_ID}&text=${MSG}&parse_mode=Markdown"
echo ""
