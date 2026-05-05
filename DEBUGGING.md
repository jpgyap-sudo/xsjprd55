# DEBUGGING.md — Reusable Fix Log

Update this file when a bug fix is reusable.

## Deployment Notes — VPS Only (as of 2026-05-01)

- **Platform:** DigitalOcean VPS — Express server via `server.js` + PM2 (`ecosystem.config.cjs`)
- **URL:** `https://bot.abcx124.xyz` — set `APP_URL=https://bot.abcx124.xyz` in `.env.prod`
- **Vercel removed:** `vercel.json` deleted. No Vercel deployment. All crons must run as VPS PM2 workers or via cron-job.org.
- **Cron replacement:** The 4 Vercel crons now need VPS equivalents:
  - `*/5 * * * *` → news ingest worker (`workers/news-ingest-worker.js`)
  - `*/15 * * * *` → signal generator worker (`workers/signal-generator-worker.js`)
  - `0 1 * * *` → news signal (cron-job.org → POST `/api/news-signal`)
  - `0 4 * * *` → learning loop worker (`workers/learning-loop-worker.js`)
- **Body parsing:** All API handlers get `req.body` pre-parsed by `express.json()` — never read the raw stream in handlers.
- **Supabase:** Use `SUPABASE_SERVICE_ROLE_KEY` (not anon key) for all server-side writes.

---

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

### Worker CLI hangs on Windows with no output
Cause: Worker scripts compared `import.meta.url` to ``file://${process.argv[1]}``, which fails for Windows paths such as `C:\repo\workers\bug-hunter-worker.js`. The module imported, but `main()` never ran, leaving imported clients alive until the command timed out.
Fix: Use `isMainModule()` from `lib/entrypoint.js`, which normalizes both the module URL and argv path before comparing.
Prevention: Add import/entrypoint tests for worker scripts and avoid hand-built `file://` path checks.

### Bug hunter crashes when Playwright is not installed
Cause: `lib/debug/live-site-crawler.js` imported `playwright` at module load even though the crawler is documented to fall back to `fetch`.
Fix: Load Playwright dynamically only when browser crawling is requested; if unavailable, log a warning and use the fetch crawler.
Prevention: Keep optional tooling behind dynamic imports and add import tests for optional-dependency modules.

### Telegram webhook returns 404
Cause: Webhook URL does not match the Express route path or APP_URL is wrong.
Fix: Confirm `APP_URL=https://bot.abcx124.xyz` in `.env.prod`, then reset webhook via `GET /api/telegram?action=set-webhook&secret=CRON_SECRET`.
Prevention: Set APP_URL in .env.prod; verify webhook URL with Telegram getWebhookInfo.

### Supabase insert fails silently
Cause: RLS policy blocks insert or wrong key is used.
Fix: Review RLS policy and server/client key usage.
Prevention: Add Supabase golden path test.

### VPS deploy fails after adding package
Cause: Missing package in package.json, PM2 not restarted, or port conflict.
Fix: Run `npm install` on VPS, then `pm2 restart all`. Check `pm2 logs` for errors.
Prevention: Always `npm install` before `pm2 restart`; pin Node >=18 in package.json engines.

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

### Perpetual trader active but opens no positions
Cause: `perpetual-trader-worker` marked a signal as processed before `openPerpetualTrade()` actually opened a trade. Temporary failures such as price API timeouts, network errors, missing schema cache, or insert failures caused the running worker to skip that signal forever. Expired active signals could also block new signals because generator duplicate checks ignored `valid_until`.
Fix: Mark signals processed only after an existing trade is found, a trade opens, or a deterministic risk rejection occurs. Retry transient skips. Poll active signals from the last 24h and filter out expired `valid_until` values in memory. Update signal duplicate checks to only block still-valid active signals.
Prevention: Processed/dedup sets should represent completed work, not attempted work; duplicate signal checks must include TTL/expiry.

### Perpetual trader dashboard shows empty data while worker is blocked
Cause: Missing or placeholder Supabase env values put `lib/supabase.js` into no-op mode, and missing perpetual schema tables can make the dashboard look like it simply has no trades.
Fix: `/api/perpetual-trader` now returns explicit diagnostics and 503 responses for no-op Supabase or blocked schema state, the dashboard displays the blocker, and `npm run verify:perpetual` performs a read-only Supabase/schema/signal/trade check.
Prevention: Run `npm run verify:perpetual` after changing Supabase env, applying migrations, or restarting PM2 workers. Keep `supabase/perpetual-trader-schema.sql` applied alongside the core schema.

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

### Signal-generator-worker: CRON_SECRET missing — no signals generated for 24+ hours
**Found:** 2026-05-05 14:00 UTC
**Status:** FIXED
**Problem:** `signal-generator-worker.js` refused to call `/api/signals` because `process.env.CRON_SECRET` was undefined. The worker only imported `node-fetch` and `../lib/logger.js` — neither of which loads `.env`. The `logger.js` module does not import `lib/env.js`, so `CRON_SECRET` was never loaded from the `.env` file. This caused the signal generator to silently skip every scan for over 24 hours, resulting in all signals expiring and the perpetual trader finding zero tradable signals.
**Fix:** Added `import '../lib/env.js';` as the first import in `workers/signal-generator-worker.js`. This loads the `.env` file via dotenv before any code checks `process.env.CRON_SECRET`. The server-side `requireSecret` middleware uses the same `CRON_SECRET` from `.env`, so the auth header matches.
**Verification:** After deploying the fix and restarting the worker via PM2, the first scan succeeded: `Scan complete — 3 signals, 0 errors`. Running `perpetual-trader-worker --once` then successfully opened 3 trades (SHORT XRPUSDT, LONG BNBUSDT, SHORT ETHUSDT).
**Prevention:** All workers that access protected API routes must import `lib/env.js` at the top of their file. Consider adding a startup check that verifies `CRON_SECRET` is set before entering the main loop.

### Perpetual trader PM2 log files are empty (0 bytes)
**Found:** 2026-05-05 14:00 UTC
**Status:** OBSERVED
**Problem:** The perpetual-trader-worker's PM2 log files (`/root/xsjprd55/logs/perp-trader-out-14.log` and `perp-trader-error-14.log`) are 0 bytes even though the worker is running and producing output when run with `--once`. The ecosystem config specifies `out_file: './logs/perp-trader-out.log'` but PM2 appends the instance number (`-14`) to the filename. The worker uses `console.log`/`console.error` via `lib/logger.js`, which PM2 should capture.
**Cause hypotheses:**
1. PM2 log rotation may have cleared the files after a restart
2. The worker's stdout/stderr may be redirected elsewhere
3. The PM2 process may have been restarted and the new log files haven't received output yet
**Fix:** Not yet determined. Check `pm2 logs perpetual-trader-worker` on VPS to see real-time output. Verify PM2 log rotation config. Consider adding explicit `console.log` calls at worker startup to verify log capture.
**Prevention:** Add a startup banner log line in every worker that confirms log capture is working.

### Telegram AI fallback rejects Anthropic request with `Unexpected role "system"`
**Found:** 2026-05-05 15:27 UTC
**Status:** FIX APPLIED, pending deploy
**Problem:** Telegram AI replies could fail after Kimi hit `400 Invalid request: exceeded model token limit: 8192`. The Anthropic fallback then returned `400 invalid_request_error` because a `role: "system"` item reached the `messages` array.
**Cause:** The shared AI provider path trusted incoming chat history roles and only passed the configured system prompt separately. Anthropic Messages API accepts `system` only as a top-level parameter, never as a message role. Kimi was also requesting up to 4096 completion tokens, which could exceed the smaller Kimi model context window when market/news context was included.
**Fix:** Added Anthropic request normalization in `lib/ai.js` to merge any stray system messages into the top-level `system` string and drop unsupported roles. Added chat history role filtering/truncation and clamped Kimi completion requests to 2048 tokens.
**Verification:** Added `test/ai-provider.test.js` to assert Anthropic payloads never include `role: "system"` inside `messages`.
**Prevention:** Keep provider-specific payload builders covered by tests. Do not pass raw browser/API chat history directly into provider SDK calls.
