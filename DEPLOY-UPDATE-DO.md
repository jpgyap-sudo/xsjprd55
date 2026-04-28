# Digital Ocean VPS — Quick Update Guide

This guide updates your DO VPS with the latest code (ML service + signal fixes + new tabs).

---

## 1. SSH into your VPS

```bash
ssh root@YOUR_DROPLET_IP
```

## 2. Navigate to the project

```bash
cd /opt/trading-bot   # or wherever you cloned it
```

## 3. Pull the latest code

```bash
git pull origin main
```

## 4. Update your `.env` file

Add this line (the Node.js app uses it to talk to the Python ML container):

```bash
echo "ML_SERVICE_URL=http://ml-service:8010" >> .env
```

If you prefer to edit manually:

```bash
nano .env
```

Add:
```
ML_SERVICE_URL=http://ml-service:8010
```

Then save (`Ctrl+O`, `Enter`, `Ctrl+X`).

## 5. Rebuild & restart everything with Docker Compose

This builds the new `ml-service` image and restarts the app:

```bash
docker compose down
docker compose build --no-cache ml-service
docker compose up -d
```

## 6. Verify all containers are running

```bash
docker compose ps
```

You should see 3 containers running:
- `trading-signal-bot` (port 3000)
- `bot-caddy` (ports 80, 443)
- `xsjprd55-ml-service` (port 8010)

## 7. Check logs for any errors

```bash
# Node.js app logs
docker compose logs -f app --tail 50

# ML service logs (in another terminal)
docker compose logs -f ml-service --tail 50
```

## 8. Test the health endpoints

```bash
# Main app
curl https://bot.abcx124.xyz/api/health

# ML service (internal)
curl http://localhost:8010/health

# New Research Agent endpoint
curl https://bot.abcx124.xyz/api/research-agent-dashboard

# New Mock Trading endpoint
curl https://bot.abcx124.xyz/api/mock-trading-dashboard
```

## 9. Done

Open your dashboard:
```
https://bot.abcx124.xyz
```

You should now see:
- **🔬 Research Agent** tab (strategy proposals, backtests, ML model status)
- **💰 Mock Trading** tab (balance, win rate, open positions, RL agent suggestion)
- **📰 News** items showing date/time
- **🚨 Signals** loading correctly

---

## Troubleshooting

### If `docker compose` is not found
```bash
# Install Docker Compose plugin
apt-get update && apt-get install -y docker-compose-plugin
# Or use the old binary:
docker-compose down && docker-compose up -d
```

### If the ML service fails to build
```bash
# Check Python build logs
docker compose build ml-service --progress=plain 2>&1 | tail -50
```

### If the app can't reach the ML service
Make sure `.env` contains:
```
ML_SERVICE_URL=http://ml-service:8010
```

Inside Docker Compose, `ml-service` resolves to the container's IP automatically via the `botnet` network.

### If you get "out of memory" during build
The ML service needs ~1GB RAM to build scikit-learn + xgboost. If your droplet is 1GB, add swap:
```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
```
