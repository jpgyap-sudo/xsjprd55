# Deploy via DigitalOcean Web Console (Manual)

> Use this when the local machine cannot reach the VPS via SSH/HTTP.

## 1. Open the Web Console
1. Go to https://cloud.digitalocean.com/droplets
2. Find droplet `165.22.110.111`
3. Click **"Console"** (launches a browser terminal)
4. Log in as `root`

## 2. Pull Latest Code & Reload
Copy-paste these commands **one block at a time** and wait for each to finish.

```bash
cd /root/xsjprd55 || cd /opt/trading-bot || exit 1
git fetch origin main
git reset --hard origin/main
```

```bash
npm install
```

```bash
pm2 reload ecosystem.config.cjs --update-env
pm2 save
```

## 3. Verify Deployment
```bash
git rev-parse --short HEAD
```
Expected output: `3418511` (or whatever the latest commit is).

```bash
curl -sf http://localhost:3000/api/health && echo "✅ HEALTHY" || echo "❌ UNHEALTHY"
```

```bash
pm2 status
```

## 4. Check Recent Logs (if unhealthy)
```bash
pm2 logs trading-signal-bot --lines 50 --nostream
```

## 5. One-Liner Emergency Update
If you just need to update code and restart quickly:
```bash
cd /root/xsjprd55 && git fetch origin main && git reset --hard origin/main && npm install && pm2 reload all && pm2 save
```

---
*Generated 2026-05-02. Commit: `3418511`*
