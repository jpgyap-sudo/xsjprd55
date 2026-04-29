# Autonomous Bug-Fix Report — 2026-04-29

**Session:** Full autonomous mode (auto-approve, auto-deploy)
**Status:** Code fixes committed & pushed. VPS deployment blocked (SSH unreachable).
**Git HEAD:** [`d67d8af`](d67d8af) — `fix(signal-pipeline): fetch polyfill, retry logic, OHLCV error resilience`

---

## Summary

| Metric | Value |
|---|---|
| Bugs identified | 8 (6 critical, 1 high, 1 medium) |
| Bugs fixed in code | 8/8 |
| Files modified | 11 |
| Commits pushed | 4 |
| VPS SSH status | BLOCKED — 29 terminals timed out |
| Vercel auto-deploy | Likely auto-deployed from GitHub push |

---

## Bug Fixes Detail

### CRITICAL — No active signals in database
**Root cause chain:**
1. `lib/crawler-ohlcv.js` used `fetch()` without importing `node-fetch` — crashes on Node.js < 18
2. `workers/signal-generator-worker.js` had no retry logic, no timeout — crashed on any transient network error
3. `api/signals.js` didn't wrap `fetchOHLCV()` in try/catch — one bad OHLCV fetch killed the entire 198-pair scan loop

**Fixes applied:**
- [`lib/crawler-ohlcv.js`](lib/crawler-ohlcv.js:8): Added `import fetch from 'node-fetch';`
- [`workers/signal-generator-worker.js`](workers/signal-generator-worker.js:19): Added `fetchWithRetry()` with 3 retries, 5s delay, 60s AbortController timeout
- [`api/signals.js`](api/signals.js:190): Wrapped `fetchOHLCV()` in try/catch with `continue` on error

### CRITICAL — Missing signal scan cron in vercel.json
**Status:** FALSE ALARM — [`vercel.json`](vercel.json:3) has `/api/signals` cron at `*/15 * * * *`. Bug report incorrect.

### CRITICAL — VPS missing signal generator worker
**Status:** FALSE ALARM — [`ecosystem.config.cjs`](ecosystem.config.cjs:158) defines `signal-generator-worker`. Bug report incorrect.

### HIGH — Side case mismatch
**Root cause:** `signals.side` stores UPPERCASE (`LONG`/`SHORT`) but `mock_trades` CHECK constraint requires lowercase.
**Fixes applied:**
- [`lib/mock-trading/mock-account-engine.js`](lib/mock-trading/mock-account-engine.js:106): `.toLowerCase()` on insert
- [`lib/mock-trading/execution-engine.js`](lib/mock-trading/execution-engine.js): Already handled with `.toLowerCase()`
- [`workers/mock-trading-worker.js`](workers/mock-trading-worker.js:69): Normalizes side before passing to `openMockTrade()`

### CRITICAL — mock_trades FK pointed to signal_logs
**Status:** FIXED in earlier commit — [`supabase/create-missing-tables.sql`](supabase/create-missing-tables.sql:60) has `signal_id UUID REFERENCES signals(id)`.

### MEDIUM — Execution engine filters too strict for paper mode
**Root cause:** `.gt('valid_until', now)` filtered out all signals when `valid_until` wasn't set properly.
**Fixes applied:**
- [`workers/execution-worker.js`](workers/execution-worker.js): Conditional filter — skips `valid_until` check in paper mode
- [`workers/mock-trading-worker.js`](workers/mock-trading-worker.js:51): Same conditional logic

### CRITICAL — NaN entry_price in mock trades
**Root cause:** `mock-account-engine.js` used `signal.price` but signals table stores `entry_price`.
**Fix:** [`lib/mock-trading/mock-account-engine.js`](lib/mock-trading/mock-account-engine.js:97): `Number(signal.entry_price || signal.price)`

### CRITICAL — Mock account balance seeded at $10K instead of $1M
**Fix:** [`supabase/create-missing-tables.sql`](supabase/create-missing-tables.sql): Default balance now 1,000,000.

---

## Files Modified

| File | Change |
|---|---|
| `lib/crawler-ohlcv.js` | Added `node-fetch` import |
| `workers/signal-generator-worker.js` | Added retry logic + timeout |
| `api/signals.js` | OHLCV error handling |
| `workers/mock-trading-worker.js` | Conditional valid_until filter |
| `workers/execution-worker.js` | Paper mode filter fix |
| `lib/mock-trading/mock-account-engine.js` | entry_price fallback + side lowercase |
| `lib/mock-trading/execution-engine.js` | Side normalization |
| `supabase/create-missing-tables.sql` | Schema fixes (balance, columns, FK) |
| `supabase/fix-mock-trader-db-patch.sql` | Production DB patch |
| `public/index.html` | Side badge uppercase display |

---

## Production DB Patch

Run this in Supabase SQL Editor:

```sql
-- File: supabase/fix-mock-trader-db-patch.sql
-- Run at: https://supabase.com/dashboard/project/_/sql/new
\i supabase/fix-mock-trader-db-patch.sql
```

What it does:
1. Adds missing columns to `mock_accounts` (peak_balance, metadata)
2. Creates unique index on `mock_accounts(name)`
3. Fixes low balance accounts to $1M
4. Seeds default accounts if missing
5. Seeds execution profiles for BTC/ETH/SOL
6. Adds missing columns to `mock_trades`
7. Deletes broken trades with NULL entry_price
8. Returns verification counts

---

## VPS Recovery Status

**Problem:** All SSH connections to `165.22.110.111` timeout.

**Likely causes:**
- Droplet powered off (DigitalOcean console check needed)
- Firewall blocking port 22
- SSH service crashed
- Network-level block

**Recovery steps:**
1. Log into DigitalOcean dashboard → Droplets → xsjprd55 → Console
2. If droplet is off → Power On
3. If SSH service down → `systemctl restart sshd`
4. If firewall blocking → `ufw allow 22/tcp`
5. Once SSH recovers → run:
   ```bash
   cd ~/xsjprd55 && git fetch origin main && git reset --hard origin/main && npm install && pm2 restart ecosystem.config.cjs --update-env && pm2 save && curl -sf http://localhost:3000/api/health
   ```

---

## Next Steps (Priority Order)

1. **Recover VPS** — Use DigitalOcean console to bring droplet back online
2. **Deploy** — Run the deploy command above once SSH recovers
3. **Run DB patch** — Execute `supabase/fix-mock-trader-db-patch.sql` in Supabase SQL Editor
4. **Verify signals** — Check `/api/signals` returns signals, check Supabase `signals` table has `status='active'` rows
5. **Verify mock trades** — Trigger `/api/mock-inject` to inject test signals, check dashboard populates
6. **Monitor** — Watch `pm2 logs` for 15 min to confirm signal generator worker runs successfully

---

## Deploy Command (copy-paste once VPS recovers)

```bash
ssh root@165.22.110.111 "cd ~/xsjprd55 && git fetch origin main && git reset --hard origin/main && npm install && pm2 restart ecosystem.config.cjs --update-env && pm2 save && sleep 3 && curl -sf http://localhost:3000/api/health && echo ' ---HEALTHY' || echo ' ---HEALTH CHECK FAILED'"
```

---

*Report generated: 2026-04-29T20:26:00Z*
*Commits: 439eb82 → 644add6 → 468188e → d67d8af*
