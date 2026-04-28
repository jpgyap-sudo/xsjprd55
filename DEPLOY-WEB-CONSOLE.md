# Deploy Using DigitalOcean Web Console (EASIEST)

Your VPS IP: **165.22.110.111**

## Step 1: Open Web Console
1. Click the **"Web Console"** button in your DigitalOcean dashboard
2. A black terminal opens in your browser
3. Log in with: `root` + your root password

---

## Step 2: Copy-Paste These Commands (One at a Time)

**Wait for each command to finish before pasting the next one.**

### 1. Update the server
```bash
apt-get update && apt-get upgrade -y
```
Wait for it to finish (1-2 minutes).

### 2. Install Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

Verify:
```bash
node -v
```
Should print: `v20.x.x`

### 3. Clone your bot
```bash
git clone https://github.com/jpgyap-sudo/xsjprd55.git /opt/trading-bot
```

### 4. Enter the folder
```bash
cd /opt/trading-bot
```

### 5. Install dependencies (takes 2-3 min)
```bash
npm install
```

### 6. Install Playwright browsers (takes 3-5 min)
```bash
npx playwright install chromium
```

### 7. Create your .env file
```bash
nano .env
```

**Paste your REAL credentials** (replace all `your-...` values):

```
# Supabase
SUPABASE_URL=https://your-real-project.supabase.co
SUPABASE_ANON_KEY=your-real-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-real-service-role-key

# Telegram Bot
TELEGRAM_BOT_TOKEN=your-real-bot-token
TELEGRAM_WEBHOOK_SECRET=256a6166f3f332cfc3f668af97686a119938fec9e73d567232ccae1bc022c47c
TELEGRAM_ADMIN_USER_ID=your-real-telegram-user-id
TELEGRAM_GROUP_CHAT_ID=your-real-group-chat-id

# Trading Config
TRADING_MODE=paper
DEFAULT_EXCHANGE=binance
DEFAULT_SYMBOL=BTCUSDT
DEFAULT_TIMEFRAME=15m
MAX_POSITION_SIZE_USD=100
DAILY_LOSS_LIMIT_USD=50
SIGNAL_COOLDOWN_MINUTES=30

# Signal Engine
SIGNAL_CONFIDENCE_THRESHOLD=0.70
EMA_SHORT_PERIOD=9
EMA_LONG_PERIOD=21
RSI_PERIOD=14
RSI_OVERBOUGHT=70
RSI_OVERSOLD=30

# Cron & Monitoring
MARKET_SCAN_INTERVAL_MINUTES=5
HEALTH_CHECK_INTERVAL_MINUTES=30
CRON_SECRET=your-cron-secret-here

# Self-Improvement
LEARNING_LOOP_ENABLED=true
SUGGESTION_AI_ENABLED=true
SUGGESTION_MIN_PATTERNS=20

# AI / Claude
ANTHROPIC_API_KEY=your-anthropic-api-key

# Feature Flags
ENABLE_CONTINUOUS_BACKTESTER=true
ENABLE_MOCK_TRADING=true
ENABLE_LEARNING_LOOP=true
ENABLE_NOTIFICATIONS=true
ENABLE_ADVISOR=true
ENABLE_WALLET_TRACKER=true
WALLET_TRACKER_INTERVAL_MS=300000
ENABLE_DIAGNOSTIC_WORKER=true
ENABLE_SOCIAL_CRAWLER_WORKER=true
```

**Save and exit:**
- Press `Ctrl+X`
- Press `Y`
- Press `Enter`

### 8. Run the health check
```bash
node scripts/pre-deploy-check.js
```

**If this passes ✅, continue. If it fails ❌, fix the issue first.**

### 9. Start the bot
```bash
bash scripts/deploy-vps.sh
```

### 10. Check if it's running
```bash
pm2 status
```

Should show `trading-signal-bot` as **online**.

### 11. View logs
```bash
pm2 logs
```

Press `Ctrl+C` to exit.

---

## Step 3: Set Telegram Webhook

**Replace `YOUR_BOT_TOKEN` with your real token**, then run:

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://165.22.110.111:3000/api/telegram",
    "secret_token": "256a6166f3f332cfc3f668af97686a119938fec9e73d567232ccae1bc022c47c",
    "allowed_updates": ["message", "callback_query"]
  }'
```

Verify:
```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

---

## Step 4: Open Firewall
```bash
ufw allow 3000/tcp
ufw allow ssh
ufw enable
```

Now visit:
- `http://165.22.110.111:3000/api/debug`
- `http://165.22.110.111:3000/api/system-health`

---

## Done! Your bot runs 24/7.

### Useful Commands
```bash
pm2 status          # Check if running
pm2 logs            # View logs
pm2 restart trading-signal-bot   # Restart
pm2 stop trading-signal-bot      # Stop
```

### Update after code changes
```bash
cd /opt/trading-bot && git pull && npm install && pm2 restart trading-signal-bot
```
