# 🗄️ Execute Trader Fix SQL in Supabase

## Prerequisites

You need the **DB_PASSWORD** from your Supabase dashboard:
1. Go to Supabase Dashboard → Project Settings → Database → Connection String
2. Copy the password (not the full URL, just the password)

## Execution Steps

### Option 1: Using the Node.js Script (Recommended)

```bash
# Set the DB password and run
cd /jpgyap-sudo/xsjprd55
set DB_PASSWORD="your-actual-password-here"
node scripts/execute-trader-fix.mjs
```

### Option 2: Direct SQL Editor (Manual)

1. Go to Supabase Dashboard → SQL Editor
2. Copy the entire contents of `supabase/fix-trader-not-trading.sql`
3. Paste and run

### Option 3: Using psql (if you have it installed)

```bash
psql "postgresql://postgres:YOUR_PASSWORD@db.nqcgnwpfxnbtdrvtkwej.supabase.co:5432/postgres" -f supabase/fix-trader-not-trading.sql
```

## What This SQL Does

1. ✅ Creates `execution_profiles` table (required by execution-engine.js)
2. ✅ Seeds execution profiles for top 10 symbols (BTC, ETH, SOL, etc.)
3. ✅ Seeds 3 mock accounts (Execution Optimizer v3, Aggressive AI Trader, AI Mock Account)
4. ✅ Fixes mock_trades side constraint for case sensitivity
5. ✅ Adds all missing columns (trailing_stop_pct, highest_price, lowest_price, etc.)
6. ✅ Creates closed_at/exit_at sync trigger
7. ✅ Adds performance indexes

## Verification

After execution, you should see:

```
=== TRADER FIX VERIFICATION ===
✓ execution_profiles count: 10
✓ mock_accounts count: 3
✓ mock_accounts seeded: AI Mock Account, Execution Optimizer v3, Aggressive AI Trader
✓ mock_trades open count: (varies)
✓ mock_trades closed count: (varies)
✓ signals active count: (varies)
```

## Critical: Restart Workers After SQL Execution

After the SQL executes successfully, restart the PM2 workers on VPS:

```bash
ssh root@165.22.110.111 "pm2 reload all"
```

Or run the deploy script:
```bash
node scripts/deploy-checker.js --force-deploy
```

## Related

- **SQL File:** `supabase/fix-trader-not-trading.sql`
- **Script:** `scripts/execute-trader-fix.mjs`
- **Commit:** 5fe8f50 - Trader Fix
