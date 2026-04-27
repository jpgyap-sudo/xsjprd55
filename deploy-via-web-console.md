# Deploy Using DigitalOcean Web Console (EASIEST METHOD)

## Step 1: Open Web Console
1. In your DigitalOcean dashboard, click the **"Web Console"** button (the one circled in your screenshot)
2. A black terminal window opens in your browser
3. Log in with: username `root` and your root password

## Step 2: Run These Commands One by One

**Copy each command, paste into the console, press Enter, wait for it to finish before the next one.**

### 1. Update the server
```bash
apt-get update && apt-get upgrade -y
```

### 2. Install Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

Verify it worked:
```bash
node -v
```
Should show `v20.x.x`

### 3. Clone your bot from GitHub
```bash
git clone https://github.com/jpgyap-sudo/xsjprd55.git /opt/trading-bot
```

### 4. Go into the folder
```bash
cd /opt/trading-bot
```

### 5. Install dependencies
```bash
npm install
```
This takes 2-3 minutes. Wait for it to finish.

### 6. Install Playwright browsers
```bash
npx playwright install chromium
```
This takes 3-5 minutes. Wait for it to finish.

### 7. Create the .env file
```bash
nano .env
```

This opens a text editor. **Paste your real credentials here.** Use the template below (replace ALL `your-...` values with real ones):

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

**To save and exit nano:**
- Press `Ctrl+X`
- Press `Y` (to confirm save)
- Press `Enter` (to confirm filename)

### 8. Run the health check
```bash
node scripts/pre-deploy-check.js
```

This will test:
- ✅ Supabase connection
- ✅ Telegram bot token
- ✅ Webhook secret
- ✅ Database tables exist

**If ANY check fails, fix the issue before continuing.**

### 9. Deploy the bot
```bash
bash scripts/deploy-vps.sh
```

This will:
- Start the bot with PM2
- Set it to auto-restart if it crashes
- Set it to start automatically after reboot

### 10. Verify it's running
```bash
pm2 status
```

Should show `trading-signal-bot` as **"online"**.

### 11. Check logs
```bash
pm2 logs
```

Press `Ctrl+C` to exit log view.

### 12. Test the API
```bash
curl http://localhost:3000/api/debug
```

Should show JSON with status info.

---

## Step 3: Set Telegram Webhook

After the bot is running, tell Telegram where to send messages.

**Replace these values first:**
- `YOUR_BOT_TOKEN` = your real Telegram bot token from BotFather
- `YOUR_WEBHOOK_SECRET` = use `256a6166f3f332cfc3f668af97686a119938fec9e73d567232ccae1bc022c47c`

Run this command:
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://165.22.110.111:3000/api/telegram",
    "secret_token": "YOUR_WEBHOOK_SECRET",
    "allowed_updates": ["message", "callback_query"]
  }'
```

Verify:
```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

---

## Step 4: Open Firewall (Optional)

If you want to access the API from the internet:
```bash
ufw allow 3000/tcp
ufw allow ssh
ufw enable
```

Now you can visit:
- `http://165.22.110.111:3000/api/debug`
- `http://165.22.110.111:3000/api/system-health`

---

## Done! Your bot is running 24/7 on your VPS.

### Useful Commands

```bash
# Check if bot is running
pm2 status

# View live logs
pm2 logs

# Restart bot
pm2 restart trading-signal-bot

# Stop bot
pm2 stop trading-signal-bot

# Update after code changes
cd /opt/trading-bot && git pull && npm install && pm2 restart trading-signal-bot
```

### Troubleshooting

| Problem | Solution |
|---|---|
| "npm: command not found" | Run step 2 again (install Node.js) |
| "Permission denied" | You're not logged in as root — check username |
| Pre-deploy check fails | Your `.env` has placeholder values — fill in real ones |
| Bot shows "errored" in pm2 | Check logs with `pm2 logs` |
| Telegram not receiving messages | Check webhook URL, make sure it uses your VPS IP |
