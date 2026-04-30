# DEBUGGING.md — Reusable Fix Log

Update this file when a bug fix is reusable.

## Template

### Problem
Describe the error or symptom.

### Cause
Describe the confirmed cause.

### Fix
Describe the exact fix.

### Prevention
Describe how to avoid it next time.

---

## Common Issues

### Telegram webhook returns 404
Cause: Vercel route path does not match webhook URL.
Fix: Confirm API route path and reset webhook to the deployed URL.
Prevention: Store webhook path in `WORKFLOW.md` and `.env.example`.

### Supabase insert fails silently
Cause: RLS policy blocks insert or wrong key is used.
Fix: Review RLS policy and server/client key usage.
Prevention: Add Supabase golden path test.

### Vercel build fails after adding package
Cause: TypeScript, missing env vars, or runtime mismatch.
Fix: Reproduce locally, check build logs, and patch smallest cause.
Prevention: Run `npm run build` before deploy.

### Signal cron fails silently
Cause: Exchange API rate limit hit or market data fetch timeout.
Fix: Check exchange API status, implement exponential backoff, add health check alerts.
Prevention: Add cron monitoring and fallback data sources.

### Stale market data in signals
Cause: Data fetcher stuck or exchange API lag >5 min.
Fix: Add data freshness check before signal generation; skip signal if stale.
Prevention: Log fetch timestamps and alert when data is stale.

### Duplicate signal broadcast
Cause: Telegram webhook retry or cron overlap.
Fix: Use idempotency key on signal `id`; check Supabase before sending.
Prevention: Add unique constraint on `signals.id` and deduplication logic.

### Exchange API rate limit hit
Cause: Too many requests in signal scan or backtest.
Fix: Pause signal generation for 60s, implement request queue with backoff.
Prevention: Track API usage per exchange and respect rate limits.

### Research Agent shows tested proposals but "No backtests yet"
Cause: The dashboard queried local SQLite `backtest_results` with `strategy_name LIKE 'research_%'`, but extracted research strategies are named `extracted_*` or `composite_*`. The Supabase-to-SQLite sync worker also tried to write Supabase UUID ids into SQLite integer ids, so synced backtest runs and signal snapshots could be rejected before reaching the dashboard.
Fix: Read recent `backtest_results` without the stale `research_%` filter, and let SQLite assign local integer ids while preserving the Supabase backtest id inside `trade_log_json`.
Prevention: Keep strategy-name filters aligned with extractor naming conventions, and never map external UUID primary keys into local integer primary keys.

### Signal sent without stop-loss
Cause: Risk filter bypassed or validation missing.
Fix: Enforce stop-loss field in signal schema validation before broadcast.
Prevention: Add schema validation gate in signal pipeline.

### Paper/live mode confusion
Cause: `mode` field not checked before executing action.
Fix: Always default to `paper`; require explicit user config for `live`.
Prevention: Add mode gate at every action point; log mode on every signal.

---

## Bug Log (with dates)

### Mock trader workers run but open no trades
**Found:** 2026-04-30 10:00 UTC
**Status:** FIX APPLIED, pending real env + DB migration on target
**Problem:** Mock trader processes can start without opening positions even when signals exist.
**Cause:** `server.js` loaded dotenv, but standalone PM2 workers did not. Workers could enter Supabase no-op mode because `SUPABASE_URL` / service key were unavailable. Additional blockers: `aggressive-mock-worker` mutated a `const openCount`, and execution/aggressive close paths write `mock_trades.metadata` even though the migration did not add that column.
**Fix:** Added shared env bootstrap in `lib/env.js`, imported it from `lib/supabase.js` and `lib/config.js`, supported both `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_SERVICE_KEY`, changed `openCount` to `let`, added `mock_trades.metadata` to migrations, and removed a hardcoded Supabase key from `test-mock-pipeline.mjs`.
**Prevention:** Worker startup checks should fail loudly when Supabase is no-op; keep `.env.example` aligned with required worker env vars; run schema additions before restarting PM2 workers.

### Deploy checker hangs or records unknown commit status
**Found:** 2026-04-30 11:20 UTC
**Status:** FIX APPLIED, pending deploy
**Problem:** `workers/deploy-checker.js` can hang while checking GitHub/VPS and `/api/deploy-status` records `status: unknown` with null commits.
**Cause:** SSH did not force batch mode and did not have an exec timeout, so a blocked SSH prompt or unreachable VPS could stall the whole check.
**Fix:** Added dotenv loading, SSH batch mode, documented deploy-key autodetection (`~/.ssh/id_ed25519_roo`), one connection attempt, server-alive limits, exec timeout, curl max-time, and HTTP abort timeouts for GitHub/deploy-status/Telegram calls.
**Prevention:** All external deployment probes must have explicit timeouts and return a degraded status instead of hanging.

### Execution-worker: `Cannot read properties of null (reading 'current_balance')`
**Found:** 2026-04-28 04:15 UTC
**Status:** IN PROGRESS
**Problem:** `getOrCreateExecutionAccount()` returns `null` on VPS, causing worker crash on every tick.
**Cause hypotheses:**
1. Supabase `mock_accounts` table missing `peak_balance` / `metadata` columns → INSERT fails silently.
2. RLS policy blocks INSERT from service role key.
3. `data` array is empty after INSERT (Supabase sometimes returns `[null]` on schema mismatch).
**Fix attempts:**
- Removed unknown columns (`peak_balance`, `metadata`) from SELECT and INSERT.
- Switched to minimal column set: `id, name, starting_balance, current_balance, created_at`.
**Still failing:** Need to run diagnostic Node script on VPS to inspect exact Supabase response.
**Prevention:** Add schema version check at worker startup; validate all columns exist before INSERT.

### Market Snapshot only shows 3-5 pairs (BTC, ETH, SOL)
**Found:** 2026-04-28 20:45 UTC
**Status:** FIX APPLIED, pending deploy
**Problem:** Browser CORS blocks direct `fetch('https://api.binance.com/api/v3/ticker/24hr')`, so frontend falls back to CoinGecko which only returns 3 coins.
**Fix:** Created backend proxy [`api/binance-ticker.js`](api/binance-ticker.js) and updated frontend `loadMarketData()` to call `/api/binance-ticker?limit=70&sort=absChange`.
**Deploy status:** Committed, needs VPS pull + PM2 restart.
**Prevention:** Never fetch third-party APIs directly from browser; always route through backend proxy.

### Proposal detail modal missing in App Dev tab
**Found:** 2026-04-28 19:30 UTC
**Status:** FIXED
**Problem:** Clicking a proposal in Capability Proposals table did nothing — no detail view existed.
**Fix:** Added rich proposal detail modal (~130 lines CSS + HTML + JS) with lifecycle timeline, impact bar, metadata JSON display, and `openAdModal()` / `closeAdModal()` handlers.
**Prevention:** Every table row with data should have an onclick detail handler from day one.

### server.js crash: `apiFiles is not defined`
**Found:** 2026-04-28 16:00 UTC
**Status:** FIXED
**Problem:** After adding nested API route discovery, `apiFiles.map(...)` referenced `apiFiles` which was renamed to `apiRoutes` earlier.
**Fix:** Changed `apiFiles.map((r) => r.route)` to `apiRoutes.map((r) => r.route)`.
**Prevention:** Run `node server.js` locally before committing; add a pre-commit lint step.

### ML model shows "No model · 0 models loaded"
**Found:** 2026-04-28 15:00 UTC
**Status:** FIXED
**Problem:** RandomForest model requires ≥100 labeled samples but `signal_snapshots` table was empty.
**Fix:** Created `lib/ml/auto-train.js` with synthetic data bootstrapper (`generateSyntheticSamples`) that creates 200 heuristic-based labeled rows when <100 exist, then trains the model.
**Prevention:** Always ship a bootstrap path for ML models; never require real labeled data to initialize.

### SSH deploy key mismatch (`id_ed25519` vs `id_ed25519_roo`)
**Found:** 2026-04-28 14:00 UTC
**Status:** FIXED
**Problem:** `ssh -i ~/.ssh/id_ed25519` rejected; `id_ed25519_roo` works.
**Fix:** Updated all deploy scripts to use `id_ed25519_roo`.
**Prevention:** Document the correct key filename in DEPLOY-ARCHITECTURE.txt and pin it in scripts.
