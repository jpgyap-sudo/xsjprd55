#!/bin/bash
set -e
cd /opt/trading-bot
export TOKEN=$(grep TELEGRAM_BOT_TOKEN .env | cut -d= -f2)
export SECRET=$(grep TELEGRAM_WEBHOOK_SECRET .env | cut -d= -f2)
echo "TOKEN=${TOKEN:0:8}... SECRET=${SECRET:0:4}..."
python3 -c "
import urllib.request, json, os, ssl
ctx = ssl.create_default_context()
url = 'https://api.telegram.org/bot'+os.environ['TOKEN']+'/setWebhook'
data = urllib.parse.urlencode({
  'url': 'https://bot.abcx124.xyz/api/telegram',
  'secret_token': os.environ['SECRET'],
  'max_connections': '40',
  'allowed_updates': json.dumps(['message','callback_query'])
}).encode()
req = urllib.request.Request(url, data=data, method='POST')
try:
  resp = urllib.request.urlopen(req, context=ctx).read().decode()
  print(resp)
except Exception as e:
  print('Error:', e)
"
