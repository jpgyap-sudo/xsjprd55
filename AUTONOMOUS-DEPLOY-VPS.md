# Deploy Autonomous Update to VPS

## Step 1: SSH into your VPS
```bash
ssh root@YOUR_VPS_IP
```

## Step 2: Run the force-sync script
```bash
cd ~/xsjprd55
bash scripts/force-vps-sync.sh
```

This will:
1. Fetch latest `main` from GitHub
2. Hard-reset to origin/main (discards local VPS changes)
3. Install dependencies
4. Restart PM2 with updated env

## Step 3: Verify the autonomous report script is available
```bash
ls -la scripts/autonomous-report.js
node scripts/autonomous-report.js
```

## Step 4: Check PM2 status
```bash
pm2 status
```

## Step 5: Quick health check
```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/system-health
```

---
*Generated: 2026-04-29*
