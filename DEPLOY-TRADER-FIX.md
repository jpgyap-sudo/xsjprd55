# Deploy Trader Fix - Step by Step Guide

## Overview
The trader has been fixed. Now you need to apply the database changes and restart the workers.

---

## Option 1: Supabase SQL Editor (Easiest - Recommended)

### Step 1: Open Supabase Dashboard
1. Go to https://supabase.com/dashboard
2. Select your project: `nqcgnwpfxnbtdrvtkwej`
3. Click **"SQL Editor"** in the left sidebar

### Step 2: Create New Query
1. Click **"New Query"** button
2. Copy ALL the SQL from [`supabase/fix-trader-not-trading.sql`](supabase/fix-trader-not-trading.sql:1)
3. Paste into the SQL Editor

### Step 3: Run the SQL
1. Click **"Run"** button
2. Wait for completion
3. Check the "Results" tab - should show verification counts

### Step 4: Verify
Run this query in SQL Editor:
```sql
SELECT 'execution_profiles' as table_name, COUNT(*) as count FROM execution_profiles
UNION ALL
SELECT 'mock_accounts', COUNT(*) FROM mock_accounts
UNION ALL
SELECT 'active_signals', COUNT(*) FROM signals WHERE status = 'active';
```

Expected output:
- execution_profiles: 10
- mock_accounts: 3
- active_signals: (your current count)

---

## Option 2: Run via Node.js Script (If on VPS)

### Step 1: Get DB Password
1. Supabase Dashboard → Project Settings → Database
2. Copy the password from Connection String

### Step 2: Set Environment Variable
```bash
export DB_PASSWORD="your-db-password-here"
```

### Step 3: Run the Script
```bash
cd /path/to/your/project
node scripts/run-sql-supabase.mjs
```

**Note:** You may need to modify the script to use `fix-trader-not-trading.sql` instead of `create-missing-tables.sql`.

---

## Option 3: Direct Postgres Connection via psql

If you have the DB_PASSWORD, you can use psql:

```bash
# Set password
export PGPASSWORD="your-db-password"

# Connect and run SQL
psql -h db.nqcgnwpfxnbtdrvtkwej.supabase.co -p 5432 -U postgres -d postgres -f supabase/fix-trader-not-trading.sql
```

---

## After SQL is Applied

### Step 1: Seed Test Signals (Optional)
```bash
node scripts/seed-test-signals.mjs
```

### Step 2: Verify System
```bash
node scripts/verify-trading-system.mjs
```

### Step 3: Restart Workers
```bash
# Check current status
pm2 status

# Restart execution worker
pm2 restart execution-worker

# Watch logs
pm2 logs execution-worker --lines 50
```

---

## Expected Worker Log Output

After successful fix, logs should show:
```
[EXEC-WORKER] Account ready — id=uuid, name=Execution Optimizer v3, balance=$1,000,000
[EXEC-WORKER] Starting — poll every 30000ms, trading mode=paper
[EXEC-WORKER] Worker is now RUNNING and actively polling for signals
[EXEC-WORKER] OPENED BTCUSDT LONG lev=5x
[EXEC-WORKER] Cycle complete — executed=1, skipped=0
```

---

## Troubleshooting

### Issue: "execution_profiles table does not exist"
**Fix:** The SQL didn't run successfully. Re-run it and check for errors.

### Issue: "Account is null — cannot start"
**Fix:** The mock_accounts weren't seeded. Run this SQL:
```sql
INSERT INTO mock_accounts (name, starting_balance, current_balance, peak_balance)
VALUES ('Execution Optimizer v3', 1000000, 1000000, 1000000);
```

### Issue: "No active signals found"
**Fix:** Run the test signal seeder:
```bash
node scripts/seed-test-signals.mjs
```

### Issue: Worker keeps crashing
**Fix:** Check logs for specific error:
```bash
pm2 logs execution-worker --err
```

---

## Quick Reference Commands

```bash
# Check everything
node scripts/verify-trading-system.mjs

# View all PM2 processes
pm2 status

# Restart all workers
pm2 restart all

# View execution worker logs
pm2 logs execution-worker

# View aggressive worker logs  
pm2 logs aggressive-mock-worker

# Stop all workers
pm2 stop all

# Start execution worker
pm2 start workers/execution-worker.js --name execution-worker
```

---

## Need Help?

Check the full report: [`AUTONOMOUS-REPORT-2026-04-30-TRADER-FIX.md`](AUTONOMOUS-REPORT-2026-04-30-TRADER-FIX.md:1)
