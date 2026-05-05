# Commit and Deploy Instructions

## Pending Bundle: 2026-05-05 AI + Worker Fixes

The current uncommitted bundle includes:

- `lib/ai.js` + `test/ai-provider.test.js`: clamps Kimi output tokens and normalizes Anthropic messages so `role: "system"` never reaches Anthropic `messages`.
- `api/support-assistant.js` + `public/index.html` + `AGENTS.md`: support assistant boss-mode/feature-suggestion updates, with fixes for table initialization, malformed tags, failed write responses, and bug-report precedence.
- `workers/signal-generator-worker.js`: loads `.env` before checking `CRON_SECRET`.
- `workers/perpetual-trader-worker.js`: startup log banner and no cross-worker starvation from `signals.metadata.processed`.
- `api/perpetual-trader/trade-detail.js` + `api/perpetual-trader/trade-history.js` + `lib/perpetual-trader/engine.js` + `lib/perpetual-trader/trade-history.js` + `supabase/perpetual-trader-history-schema.sql`: perpetual trader history logging/API/data schema for dashboard and research analysis.
- `public/perpetual-trader-history.html`: currently present as an empty placeholder file; confirm whether to keep or fill before commit.
- `scripts/check-signals.mjs`: standalone Supabase signal inspection script with `.env` loading and required env validation.
- `DEBUGGING.md`, `AUTONOMOUS-REPORT-2026-05-05.md`, `CODER-CHANGELOG.md`: investigation and handoff documentation.

Suggested commit message:

```bash
git add -A
git commit -m "fix: stabilize AI fallback and trading worker handoff"
```

After deploy, verify:

```bash
node --check lib/ai.js
node --check api/support-assistant.js
node --check api/perpetual-trader/trade-detail.js
node --check api/perpetual-trader/trade-history.js
node --check workers/signal-generator-worker.js
node --check workers/perpetual-trader-worker.js
node --check scripts/check-signals.mjs
node test/ai-provider.test.js
pm2 reload all
curl -sf http://localhost:3000/api/health
```

Important: `npm test` may fail in the local Codex sandbox with `spawn EPERM`; use the direct test command above locally, and run the full suite on the VPS/CI where Node can spawn test workers.

Schema note: `supabase/perpetual-trader-history-schema.sql` is part of the current working tree. The VPS deployer agent is designed to pause on `*.sql` changes, so run/review this SQL manually in Supabase before marking the deployment complete.

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
