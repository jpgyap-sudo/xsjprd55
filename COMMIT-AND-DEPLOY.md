# Commit and Deploy Instructions

## Step 1: Commit Changes

Open VS Code terminal (Git Bash or WSL) and run:

```bash
# Add all changes
git add -A

# Commit with descriptive message
git commit -m "fix: resolve critical bugs in trading workers

- Fix execution-worker null account error with null checks and fallback balance
- Fix mock-account-engine to handle missing peak_balance column gracefully  
- Fix aggressive-engine with minimal schema insert fallback
- Fix execution-engine getMaxDrawdownPct to handle null account
- Update .env.example with comprehensive worker configuration
- Add VPS deployment and auto-deploy settings to .env.example"

# Push to main
git push origin main
```

## Step 2: Deploy to VPS

### Option A: Automated Deploy (Recommended)
```bash
ssh -i ~/.ssh/id_ed25519_roo root@165.22.110.111 "bash /root/xsjprd55/scripts/roo-safe-deploy.sh"
```

### Option B: Manual Deploy
```bash
ssh -i ~/.ssh/id_ed25519_roo root@165.22.110.111
cd ~/xsjprd55
git pull origin main
npm install
pm2 reload all
pm2 save
```

## Step 3: Verify Deployment

```bash
# Check health endpoint
curl https://bot.abcx124.xyz/api/health

# Check PM2 status
ssh -i ~/.ssh/id_ed25519_roo root@165.22.110.111 "pm2 status"

# Check logs
ssh -i ~/.ssh/id_ed25519_roo root@165.22.110.111 "pm2 logs --lines 50"
```

## Step 4: Post-Deploy SQL (Critical)

Run this in Supabase SQL Editor to ensure tables are ready:

```sql
-- Ensure mock_accounts has all required columns
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS peak_balance NUMERIC DEFAULT 1000000;
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC DEFAULT 0;

-- Seed default accounts if missing
INSERT INTO mock_accounts (name, starting_balance, current_balance, peak_balance)
VALUES 
  ('AI Mock Account', 1000000, 1000000, 1000000),
  ('Execution Optimizer v3', 1000000, 1000000, 1000000),
  ('Aggressive AI Trader', 1000000, 1000000, 1000000)
ON CONFLICT (name) DO NOTHING;

-- Verify
SELECT name, current_balance, peak_balance FROM mock_accounts;
```

## Rollback (if needed)

```bash
ssh -i ~/.ssh/id_ed25519_roo root@165.22.110.111 "cd ~/xsjprd55 && git reset --hard HEAD~1 && pm2 reload all"
```
