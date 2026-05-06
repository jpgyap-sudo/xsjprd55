# Next Steps — 2026-05-05

## Status: 6/7 Issues Fixed, 2 Commits Pending Deploy

---

## ✅ Completed (Last Session)

| # | Issue | Status |
|---|-------|--------|
| 1 | [`api/research-agent.js`](api/research-agent.js:21) — SyntaxError crash (wrong import) | ✅ Fixed & deployed |
| 2 | [`data/ml-loop.sqlite`](data/ml-loop.sqlite) — SQLite corruption | ✅ Fixed via repair script |
| 3 | [`workers/execution-worker.js`](workers/execution-worker.js:24) — Race condition (stale batch dedup) | ✅ Fixed & deployed |
| 4 | [`workers/execution-worker.js`](workers/execution-worker.js:74) — Infinite reprocessing loop | ✅ Fixed & deployed |
| 5 | Stuck workers (aggressive-mock, deploy-checker, news-signal) | ✅ Fixed via PM2 reload |
| 6 | Execution-worker actively opening trades (6 executed in first cycle) | ✅ Verified |

---

## 🚀 Deploy Latest Commits to VPS

Two commits need to be deployed. An SSH deploy command was already sent — check if it succeeded:

```bash
# Check VPS status
ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no -i C:\Users\User\.ssh\id_ed25519 root@165.22.110.111 "cd /root/xsjprd55 && git log --oneline -3 && echo '===PM2===' && pm2 list"
```

**Expected result** — VPS should show these commits:
```
799a20e [SB] feat(scripts): add Supabase migration runner script
94fb583 [SB] fix(db): add SQLite corruption protection
```

If SSH is hanging, wait for existing sessions to time out, or reboot the VPS from DigitalOcean console.

---

## ⏳ Run Supabase Master Migration

**Action Required:** Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/nqcgnwpfxnbtdrvtkwej/sql/new) and paste the entire contents of [`supabase/run-all-migrations.sql`](supabase/run-all-migrations.sql).

This will:
1. **Create 7 missing tables:**
   - `research_sources` — stores research agent source data
   - `strategy_proposals` — stores AI-generated strategy proposals
   - `backtest_results` — stores backtest run results
   - `strategy_lifecycle` — tracks strategy from research → mock → live
   - `mock_strategy_feedback` — stores mock trading performance per strategy
   - `signal_snapshots` — stores signal data for ML training
   - `ml_models` — stores trained ML model data

2. **Fix 2 CHECK constraints:**
   - `signals` table: adds `'skipped'`, `'executed'` to status constraint
   - `api_debugger_results` table: expands provider list to include `'anthropic'`, `'deepseek'`, etc.

3. **Seed data:**
   - `execution_profiles` — default execution profile
   - `mock_accounts` — default mock trading account

---

## 🔍 Verify Workers on VPS

After SSH is working again:

```bash
# Check all workers are online
pm2 list

# Check execution-worker logs
pm2 logs execution-worker --lines 20 --nostream

# Check for any errors
pm2 logs --lines 10 --nostream
```

Expected: 25 workers online, execution-worker showing "Cycle complete — executed=N, skipped=M"

---

## 💰 Investigate Negative Account Balance

The execution account balance is `$0.01` (near zero). The aggressive-mock-worker account may have negative balance. Check:

```bash
# Check mock account balance via API
curl http://165.22.110.111:3000/api/mock-trading-dashboard

# Or check Supabase mock_accounts table
```

If trades are closing at a loss without proper risk management, consider:
- Adding stop-loss enforcement
- Reducing position sizes
- Adding a daily loss limit

---

## 📰 CryptoSlate 403 Error

The CryptoSlate RSS feed returns HTTP 403 (Cloudflare blocking). Options:
- Add a proxy or rotating user-agent
- Switch to CoinDesk / CoinTelegraph RSS feeds
- Use a news API service (NewsAPI, etc.)

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `ssh -i C:\Users\User\.ssh\id_ed25519 root@165.22.110.111 "pm2 list"` | Check VPS workers |
| `ssh -i C:\Users\User\.ssh\id_ed25519 root@165.22.110.111 "cd /root/xsjprd55 && git pull origin main && npm install && pm2 reload all"` | Full deploy |
| `node scripts/run-supabase-migration.mjs` | Run Supabase migration from VPS (needs SUPABASE_SERVICE_ROLE_KEY) |
| `npm test` | Run all tests locally |

---

*Generated 2026-05-05 — Next actions for tomorrow*
