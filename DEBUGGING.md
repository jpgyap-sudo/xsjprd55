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

### Signal sent without stop-loss
Cause: Risk filter bypassed or validation missing.
Fix: Enforce stop-loss field in signal schema validation before broadcast.
Prevention: Add schema validation gate in signal pipeline.

### Paper/live mode confusion
Cause: `mode` field not checked before executing action.
Fix: Always default to `paper`; require explicit user config for `live`.
Prevention: Add mode gate at every action point; log mode on every signal.
