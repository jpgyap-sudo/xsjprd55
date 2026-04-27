# VPS Deployment Guide — Trading Signal Bot v2.1.0

## Overview
- **VPS** = Background workers (OI, liquidation, wallet tracker, social crawler, diagnostics) + API server
- **Vercel** = Dashboard/static frontend only (optional, can skip if using VPS nginx)

---

## Prerequisites

1. VPS with:
   - Ubuntu 22.04+ (or any Linux)
   - 2 vCPU, 2GB RAM minimum
   - Public IP address
   - Domain name (optional but recommended for SSL)

2. Local machine:
   - SSH access to VPS
   - Real credentials filled in `.env`
   - Schema.sql run in Supabase

---

## Step 1: Pre-Deploy Check (on your local machine)

```bash
cd C:\Users\User\xsjprd55
node scripts/pre-deploy-check.js
```

This validates:
- All required env vars are real (not placeholders)
- Supabase connection works
- Telegram bot token is valid
- Webhook secret is set
- schema.sql exists

**Do NOT proceed if this fails.**

---

## Step 2: Upload to VPS

### Option A — Git clone (recommended)
```bash
# On VPS
ssh root@YOUR_VPS_IP
git clone https://github.com/YOUR_USERNAME/xsjprd55.git /opt/trading-bot
cd /opt/trading-bot
```

### Option B — SCP / SFTP
Use FileZilla, WinSCP, or `scp` to copy the entire `xsjprd55` folder to `/opt/trading-bot` on your VPS.

### Option C — rsync
```bash
# From your Windows machine (in WSL or Git Bash)
rsync -avz --exclude=node_modules --exclude=.git /c/Users/User/xsjprd55/ root@YOUR_VPS_IP:/opt/trading-bot/
```

---

## Step 3: Install Dependencies on VPS

```bash
ssh root@YOUR_VPS_IP
cd /opt/trading-bot

# Install Node.js 20 if not present
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Verify
node -v  # should print v20.x.x

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium
```

---

## Step 4: Configure Environment

```bash
cd /opt/trading-bot
nano .env
```

Paste your real credentials (same as your local `.env`).

**Critical:** Set `TELEGRAM_WEBHOOK_SECRET` to a random 32+ char string:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 5: Run Pre-Deploy Check on VPS

```bash
cd /opt/trading-bot
node scripts/pre-deploy-check.js
```

Must pass all checks before continuing.

---

## Step 6: Deploy with PM2

```bash
cd /opt/trading-bot
bash scripts/deploy-vps.sh
```

This will:
1. Check Node.js version
2. Verify `.env` exists
3. Install dependencies
4. Create log directory
5. Install PM2 globally
6. Start the bot with PM2
7. Save PM2 process list
8. Setup PM2 startup script

---

## Step 7: Verify Deployment

```bash
# Check process status
pm2 status
pm2 logs trading-signal-bot

# Health check
curl http://localhost:3000/api/debug

# Check all endpoints
curl http://localhost:3000/api/system-health
curl http://localhost:3000/api/social-sentiment
curl http://localhost:3000/api/wallet-tracker
```

---

## Step 8: Expose to Internet (choose one)

### Option A — Nginx Reverse Proxy (recommended)

```bash
apt-get install -y nginx

# Edit nginx config
nano /etc/nginx/sites-available/trading-bot
```

Paste:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

Enable:
```bash
ln -s /etc/nginx/sites-available/trading-bot /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### Option B — Direct port (not recommended for production)
```bash
ufw allow 3000/tcp
# Access via http://YOUR_VPS_IP:3000
```

### Option C — Docker Compose
```bash
cd /opt/trading-bot
docker-compose up -d
```

---

## Step 9: Set Telegram Webhook

After your bot is publicly accessible:

```bash
# Replace with your actual domain/IP and bot token
WEBHOOK_URL="https://your-domain.com/api/telegram"
BOT_TOKEN="YOUR_BOT_TOKEN"
SECRET="YOUR_WEBHOOK_SECRET"

curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${WEBHOOK_URL}\",
    \"secret_token\": \"${SECRET}\",
    \"allowed_updates\": [\"message\", \"callback_query\"]
  }"
```

Verify:
```bash
curl "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
```

---

## Step 10: SSL with Certbot (recommended)

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

This auto-configures HTTPS. Your webhook URL should now be `https://`.

**Update webhook after SSL:**
```bash
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"https://your-domain.com/api/telegram\",
    \"secret_token\": \"${SECRET}\"
  }"
```

---

## Maintenance Commands

```bash
# View logs
pm2 logs trading-signal-bot
pm2 logs trading-signal-bot --lines 100

# Restart
pm2 restart trading-signal-bot

# Stop
pm2 stop trading-signal-bot

# Update after code changes
git pull
npm install
pm2 restart trading-signal-bot

# Monitor resources
pm2 monit

# Save PM2 config (auto-starts on reboot)
pm2 save
pm2 startup systemd
```

---

## Firewall Setup

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
# Only if not using nginx reverse proxy:
# ufw allow 3000/tcp
ufw enable
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `supabase.from is not a function` | Credentials are still placeholders — check `.env` |
| `Binance: error` | API key missing or invalid — add real keys or rely on crawler fallback |
| `Playwright browser not found` | Run `npx playwright install chromium` |
| Webhook not receiving updates | Check `getWebhookInfo`, verify HTTPS URL, check firewall |
| PM2 process keeps crashing | Check `pm2 logs`, likely missing `.env` values |
| Out of memory | Upgrade VPS to 4GB RAM or reduce worker count in `lib/config.js` |

---

## Vercel Dashboard (Optional)

If you want the dashboard on Vercel while workers run on VPS:

```bash
cd C:\Users\User\xsjprd55
npx vercel --prod
```

Set environment variables in Vercel dashboard to match your `.env`.

**Note:** Vercel deployment does NOT run background workers. Workers only run on VPS.
