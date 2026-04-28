# Windows SSH Guide — Deploy to VPS

Follow these exact steps to connect to your DigitalOcean VPS from Windows and deploy your trading bot.

---

## Step 1: Open PowerShell

Press `Win + R`, type `powershell`, and press **Enter**.

Or right-click the Start button → **Windows PowerShell**.

---

## Step 2: SSH Into Your VPS

Type this command exactly and press **Enter**:

```powershell
ssh root@165.22.110.111
```

### First time only — you will see:
```
The authenticity of host '165.22.110.111' can't be established.
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

Type `yes` and press **Enter**.

### Enter your password

You will see:
```
root@165.22.110.111's password:
```

Type your DigitalOcean root password. **You won't see any characters as you type** — this is normal. Press **Enter** when done.

If correct, you'll see a Linux prompt like:
```
root@ubuntu:~#
```

---

## Step 3: Run the Deploy Command

Once you're logged in (you see `root@...#`), paste this ONE long command and press **Enter**:

```bash
curl -fsSL https://raw.githubusercontent.com/jpgyap-sudo/xsjprd55/main/scripts/deploy-domain.sh -o /tmp/deploy.sh && chmod +x /tmp/deploy.sh && /tmp/deploy.sh
```

This will:
- Download the deploy script
- Install Docker, Docker Compose, Git
- Clone your repo to `/opt/trading-bot`
- Check if `.env` exists

---

## Step 4: Create the .env File

The script will STOP and say `.env file missing!` or `.env still has placeholder values!`

That's expected. Now run these commands one by one:

```bash
cd /opt/trading-bot
cp .env.prod .env
nano .env
```

`nano` opens a text editor. Use your arrow keys to move around. You must replace these placeholder values with real ones:

| Variable | What to put |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key |
| `TELEGRAM_BOT_TOKEN` | From @BotFather on Telegram |
| `TELEGRAM_WEBHOOK_SECRET` | Any random 32-character string |
| `TELEGRAM_ADMIN_USER_ID` | Your Telegram user ID (from @userinfobot) |
| `BINANCE_API_KEY` | Your Binance API key (read-only!) |
| `BINANCE_API_SECRET` | Your Binance API secret |

### Save and exit nano:
1. Press `Ctrl + O` (then Enter) to save
2. Press `Ctrl + X` to exit

---

## Step 5: Re-Run Deploy

Now run the deploy script again:

```bash
cd /opt/trading-bot
bash /tmp/deploy.sh
```

This time it will complete and start your bot with Docker.

---

## Step 6: Verify It Works

Wait about 30 seconds, then open these URLs in your browser:

- **Dashboard**: https://bot.abcx124.xyz
- **Debug**: https://bot.abcx124.xyz/api/debug
- **Health**: https://bot.abcx124.xyz/api/health

They should all load successfully.

---

## Step 7: Useful VPS Commands

While SSH'd in, you can run:

```bash
# See if bot is running
docker compose ps

# View live logs
docker compose logs -f app

# Restart bot
docker compose restart app

# Stop everything
docker compose down

# Update to latest code
git pull origin main && docker compose up --build -d

# Free disk space
docker system prune -f
```

---

## Troubleshooting

### "Permission denied" when SSHing
- Make sure you're using the correct root password from DigitalOcean
- If you forgot it, reset it in the DigitalOcean dashboard → Droplets → Access → Reset Root Password

### "This site can't be reached" after deploy
- Wait 5-10 minutes for DNS to propagate
- Check: `nslookup bot.abcx124.xyz` should return `165.22.110.111`
- Make sure DigitalOcean firewall allows ports 80 and 443

### "Bad Gateway" or 502 error
- App hasn't finished starting → Wait 30 seconds
- Check logs: `docker compose logs app`

---

## Getting Your Credentials

### Supabase
1. Go to https://supabase.com/dashboard
2. Click your project
3. Go to **Project Settings** → **API**
4. Copy `URL`, `anon public`, and `service_role` keys

### Telegram Bot Token
1. Message @BotFather on Telegram
2. Type `/mybots`
3. Click your bot → **API Token**
4. Copy the token

### Your Telegram User ID
1. Message @userinfobot on Telegram
2. It will reply with your ID number

### Binance API Key
1. Log into Binance
2. Go to **Account** → **API Management**
3. Create a new API key with **read-only** permissions
4. Copy the API Key and Secret Key
