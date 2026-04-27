# How to Resize DigitalOcean VPS (1GB → 2GB+ RAM)

## Why You Need to Resize
Your current VPS has **1 vCPU + 1GB RAM**. The trading bot with 11 workers + Playwright browser needs **at least 2GB RAM** or it will crash.

---

## Step-by-Step Resize Instructions

### Step 1: Go to DigitalOcean Dashboard
1. Open https://cloud.digitalocean.com in your browser
2. Log in to your account

### Step 2: Find Your Droplet
1. Click **"Droplets"** in the left sidebar
2. Find your droplet named `ubuntu-s-1vcpu-1gb-sgp1` (or similar)
3. Click on the droplet name to open its page

### Step 3: Power Off the Droplet
**IMPORTANT: You MUST turn off the droplet before resizing.**

1. On the droplet page, click the **"Power"** tab (or click the ON/OFF toggle)
2. Click **"Turn Off"** or **"Power Off"**
3. Wait 30-60 seconds for it to fully shut down

### Step 4: Resize
1. Click the **"Resize"** tab
2. You will see a list of plans:

| Plan | CPU | RAM | Price | Good for Bot? |
|---|---|---|---|---|
| Basic (current) | 1 vCPU | 1GB | $6/mo | ❌ Too small |
| Basic | 1 vCPU | 2GB | $12/mo | ✅ Minimum |
| Basic | 2 vCPU | 2GB | $18/mo | ✅ Recommended |
| Basic | 2 vCPU | 4GB | $24/mo | ✅ Best |

3. Select **"Basic - 1 vCPU / 2GB RAM"** ($12/month) or larger
4. Click **"Resize"** or **"Resize Droplet"**
5. Wait 1-2 minutes for resize to complete

### Step 5: Turn It Back On
1. Click the **"Power"** tab
2. Click **"Power On"** or toggle it back ON
3. Wait 30-60 seconds for it to boot

### Step 6: Verify
1. Open the **Web Console** again
2. Log in as `root`
3. Type this command:
```
free -h
```

You should see something like:
```
              total        used        free
Mem:           1.9G        150M        1.7G
```

If it shows **~2GB total** (or whatever you chose), resize is successful.

---

## Cost
| Size | Monthly Cost | Hourly Cost |
|---|---|---|
| 1 vCPU / 1GB RAM | $6 | $0.009 |
| 1 vCPU / 2GB RAM | $12 | $0.018 |
| 2 vCPU / 2GB RAM | $18 | $0.027 |
| 2 vCPU / 4GB RAM | $24 | $0.036 |

---

## After Resizing

Go back to the deployment steps and continue from where you left off:
1. Open Web Console
2. Log in as root
3. Continue with `apt-get update` and the rest of the deployment

**The resize does NOT delete your data.** Everything you already installed is still there.
