# Mock Trader Fix — Deploy Steps

## Problem
`mock_trades.signal_id` FK referenced `signal_logs(id)` instead of `signals(id)`.
The execution worker reads from `signals` table, so every insert was rejected silently → zero trades.

## Fix Applied
- `supabase/trading_schema.sql` — corrected FK + added missing columns
- `supabase/fix-mock-trades-fk.sql` — migration for existing tables

## Deploy Steps

### Step 1: Run SQL fix in Supabase (do this FIRST)
1. Open Supabase Dashboard → SQL Editor
2. Run `supabase/fix-mock-trades-fk.sql`
3. Verify output shows `references_table = signals`

### Step 2: Sync VPS code
```bash
ssh root@YOUR_VPS_IP
cd ~/xsjprd55
bash scripts/force-vps-sync.sh
```

### Step 3: Restart workers
```bash
pm2 restart execution-worker
pm2 restart mock-trading-worker
pm2 restart aggressive-mock-worker
pm2 logs execution-worker --lines 50
```

### Step 4: Verify
1. Open https://bot.abcx124.xyz/ → check dashboard for trades
2. Or query Supabase:
```sql
SELECT COUNT(*) FROM mock_trades WHERE status = 'open';
```

### Step 5: If still no trades, check logs
```bash
pm2 logs execution-worker --lines 100
pm2 logs mock-trading-worker --lines 100
```

---
*Fix committed: 5088f90*
