# Domain Setup Guide — bot.abcx124.xyz

Follow these steps in order. Each must complete before the next.

---

## Step 1: Resize DigitalOcean Droplet to 2GB RAM

1. Go to https://cloud.digitalocean.com/droplets
2. Click your droplet (IP: 165.22.110.111)
3. Click **"Resize"** tab
4. Choose: **Basic Plan** → **$18/month** (2 vCPU / 2GB RAM / 50GB SSD)
5. Click **"Resize"** → Confirm
6. Wait ~1 minute for restart

---

## Step 2: Set DNS A-Record

1. Go to your domain registrar (where you bought abcx124.xyz)
2. Open DNS management
3. Add an **A Record**:
   - Name: `bot`
   - Value: `165.22.110.111`
   - TTL: 300 (or lowest)
4. Save and wait 5-10 minutes for propagation

Verify DNS is live:
```bash
nslookup bot.abcx124.xyz
```
Should return `165.22.110.111`.

---

## Step 3: SSH Into Your VPS

Open PowerShell on your Windows PC and type:
```powershell
ssh root@165.22.110.111
```
Type `yes` if asked about host key, then enter your root password.

---

## Step 4: One-Command Deploy

Once logged in via SSH, paste this ONE command:

```bash
curl -fsSL https://raw.githubusercontent.com/jpgyap-sudo/xsjprd55/main/scripts/deploy-domain.sh -o /tmp/deploy.sh && chmod +x /tmp/deploy.sh && /tmp/deploy.sh
```

This will:
- Install Docker, Docker Compose, Git
- Clone your repo to `/opt/trading-bot`
- Check `.env` file
- Start the app + Caddy (HTTPS)

---

## Step 5: Create .env With Real Values

The deploy script will stop here if `.env` is missing. Create it:

```bash
cd /opt/trading-bot
cp .env.prod .env
nano .env
```

Fill in these REQUIRED values (use arrow keys to navigate, edit, then Ctrl+O → Enter → Ctrl+X):

| Variable | Where to get it |
|----------|----------------|
| `SUPABASE_URL` | Supabase Dashboard → Project Settings → API |
| `SUPABASE_ANON_KEY` | Same page |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page |
| `TELEGRAM_BOT_TOKEN` | @BotFather on Telegram → /mybots → API Token |
| `TELEGRAM_WEBHOOK_SECRET` | Run: `openssl rand -hex 16` |
| `TELEGRAM_ADMIN_USER_ID` | Message @userinfobot on Telegram |
| `BINANCE_API_KEY` | Binance → API Management (read-only!) |
| `BINANCE_API_SECRET` | Same page |

Optional but recommended:
| Variable | Where to get it |
|----------|----------------|
| `BYBIT_API_KEY` | Bybit → API |
| `OKX_API_KEY` | OKX → API |
| `ANTHROPIC_API_KEY` | console.anthropic.com |

---

## Step 6: Re-Run Deploy

After saving `.env`:

```bash
cd /opt/trading-bot
bash /tmp/deploy.sh
```

This time it will complete and start your bot.

---

## Step 7: Verify Everything Works

Check these URLs in your browser:

| URL | Expected Result |
|-----|----------------|
| https://bot.abcx124.xyz | Dashboard loads |
| https://bot.abcx124.xyz/api/debug | JSON with status info |
| https://bot.abcx124.xyz/api/health | `{ "ok": true }` |

Check Telegram bot:
1. Message your bot on Telegram: `/status`
2. It should reply with system status

---

## Step 8: Manage Your Bot (Useful Commands)

```bash
# View live logs
cd /opt/trading-bot && docker compose logs -f app

# Restart bot
cd /opt/trading-bot && docker compose restart app

# Stop everything
cd /opt/trading-bot && docker compose down

# Update to latest code
cd /opt/trading-bot && git pull origin main && docker compose up --build -d

# Check Caddy / HTTPS logs
docker logs bot-caddy

# Free disk space
docker system prune -f
```

---

## Troubleshooting

**"This site can't be reached"**
- DNS hasn't propagated yet → Wait 10 more minutes
- Firewall blocking ports 80/443 → Check DigitalOcean firewall settings

**"Bad Gateway" or 502 error**
- App hasn't started yet → Wait 30 seconds, refresh
- Check logs: `docker compose logs app`

**Telegram bot not responding**
- Check webhook is set: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
- Webhook should show: `https://bot.abcx124.xyz/api/telegram`

**Out of memory errors**
- Your droplet needs 2GB RAM minimum
- Add swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`

---

## Architecture

```
User → https://bot.abcx124.xyz
       ↓
    Caddy (auto HTTPS)
       ↓
    Trading Bot (port 3000)
       ↓
    Supabase + Exchange APIs
```

- **Caddy**: Handles HTTPS automatically (free Let's Encrypt certs)
- **App**: Your Node.js trading bot server
- **Docker Compose**: Runs both containers
- **PM2**: Not needed — Docker handles process management

---

## Files Updated for This Domain

- [`Caddyfile`](../Caddyfile:1) — reverse proxy + HTTPS
- [`docker-compose.yml`](../docker-compose.yml:1) — app + Caddy containers
- [`scripts/deploy-domain.sh`](../scripts/deploy-domain.sh:1) — one-click deploy
- [`.env.prod`](../.env.prod:1) — production env template
