---
name: coding-lessons-from-trading-bot
description: 🧠 Coding Lessons extracted from the xsjprd55 Trading Signal Telegram Bot — reusable architecture patterns for SuperRoo
---

# Coding Lessons: Trading Signal Bot Architecture Patterns

> Extracted from [`xsjprd55`](/) — a production trading signal Telegram bot with 40+ PM2 workers, brain pipeline, learning layer, and VPS deployment.
> These patterns are **portable coding lessons** for SuperRoo to reuse across projects.

---

## Lesson 1: Centralized Brain Pipeline Pattern

**Source:** [`lib/brain/brain-router.js`](lib/brain/brain-router.js)

A multi-stage decision pipeline where each stage is a pure function that transforms context:

```
Input → buildSignalContext() → scoreStrategy() → runRiskGate() → explainDecision() → saveSignalMemory()
```

**When to use:** Any system that needs to process data through sequential, gated stages (signal generation, content moderation, data pipelines).

**Key implementation rules:**
- Each stage is a **separate module** with a single exported async function
- Stages receive a **context object** and return enriched context
- The orchestrator (`brain-router.js`) owns the flow — stages don't call each other
- Telemetry is logged **after** the pipeline completes, not inside stages
- Risk gates can **block** the pipeline without breaking it — the decision is still returned with `risk_verdict: 'BLOCKED'`

**Validation:** Every pipeline run produces a complete decision object regardless of pass/fail.

---

## Lesson 2: Gated Safety Architecture

**Source:** [`lib/brain/risk-gate.js`](lib/brain/risk-gate.js)

A composable gate system where each safety check is an independent gate with `passed: boolean`:

```js
// Pattern: each gate is a push into an array
const gates = [];
gates.push({ gate: 'stale_data', passed: false, reason: '...' });
gates.push({ gate: 'low_confidence', passed: true });
// ...
const allPassed = gates.every(g => g.passed);
return { passed: allPassed, gates, verdict: allPassed ? 'APPROVED' : 'BLOCKED' };
```

**When to use:** Any feature that needs multiple independent safety checks before action (trading, deployment, content publishing, user actions).

**Key implementation rules:**
- Each gate is **self-contained** — no shared state between gates
- Every gate always pushes an entry (no conditional skipping) — the array is the audit trail
- Gates return `{ gate, passed, reason? }` — never throw on failure
- The verdict is computed from `gates.every(g => g.passed)` — simple and auditable
- Live/real modes are gated behind **environment variable authorization** (`process.env.BRAIN_LIVE_MODE !== 'true'`)

**Validation:** Run all gates even if one fails — the full audit trail is more valuable than short-circuiting.

---

## Lesson 3: Weighted Composite Scoring

**Source:** [`lib/brain/strategy-scorer.js`](lib/brain/strategy-scorer.js)

A scoring system that combines multiple signals into a single composite score with explicit weights:

```js
const composite =
  emaScore * 0.30 +
  rsiScore * 0.25 +
  volumeScore * 0.15 +
  liqFactor * 0.15 +
  newsFactor * 0.15;
```

**When to use:** Any decision that depends on multiple weighted factors (recommendation systems, risk scoring, prioritization).

**Key implementation rules:**
- Weights must **sum to 1.0** (or be explicitly normalized)
- Each factor is normalized to a consistent range (e.g., 0-1 or -1 to 1)
- The breakdown is returned alongside the composite for debugging
- Side/decision is derived from the composite with thresholds (e.g., `>= 0.55 → LONG, <= 0.45 → SHORT, else → NEUTRAL`)
- All weights are **configurable via environment variables** with sensible defaults

**Validation:** Always return the breakdown so consumers can see which factors drove the score.

---

## Lesson 4: Signal Schema with TTL and Mode Gating

**Source:** [`lib/signal-engine.js`](lib/signal-engine.js)

Every signal/data entity must have a strict schema with mandatory fields:

```js
{
  id: uuid,
  symbol: string,
  side: 'LONG' | 'SHORT' | 'CLOSE',
  entry_price: number | null,
  stop_loss: number | null,
  take_profit: number[],
  confidence: number (0-1),
  strategy: string,
  timeframe: string,
  generated_at: ISO timestamp,
  valid_until: ISO timestamp (TTL),
  source: string,
  mode: 'paper' | 'live',
  status: 'active',
  metadata: {}
}
```

**When to use:** Any system that produces data entities with a lifecycle (signals, orders, events, notifications).

**Key implementation rules:**
- `generated_at` and `valid_until` (TTL) are **mandatory** — every entity has a lifespan
- `mode` gates real vs. simulated execution — never default to `live`
- `confidence` is always 0-1, never raw scores
- The builder function (`buildSignal()`) provides defaults for every field — callers only override what they need
- `metadata` is an open object for extensibility without schema changes

**Validation:** Validate the schema before broadcasting/persisting. Reject entities with missing required fields.

---

## Lesson 5: Autonomous Learning Layer (TLL) Pattern

**Source:** [`lib/learning-layer/index.js`](lib/learning-layer/index.js)

A self-improving pipeline that learns from outcomes and generates reusable skills:

```
recordOutcome → discoverPatterns → detectRegime → tuneWeights → generateSkills → healStrategies
```

**When to use:** Any system that should improve over time by analyzing its own results (trading, recommendations, automation, testing).

**Key implementation rules:**
- The entire pipeline is **gated by an env var** (`TLL_ENABLED !== 'false'`) — can be disabled without code changes
- Each stage is **wrapped in try/catch** — one stage failure doesn't block the rest
- Results are accumulated in a `results` object with `errors[]` array
- Pattern discovery requires **minimum sample sizes** (e.g., 5 samples per bucket) to avoid noise
- Skill generation requires **minimum confidence** (e.g., 0.6) — low-confidence patterns are logged but not promoted
- Strategy healing only acts on strategies with sufficient data (e.g., 10+ resolved signals)
- Quarantine (weight = 0) only triggers at extreme thresholds (e.g., win rate < 25%)

**Validation:** The pipeline always returns a results object with `{ outcomesRecorded, patternsDiscovered, regime, weightsTuned, skillsGenerated, strategiesHealed, errors, durationMs }`.

---

## Lesson 6: Multi-Worker PM2 Architecture

**Source:** [`ecosystem.config.cjs`](ecosystem.config.cjs)

A standardized worker pattern for long-running background processes:

```js
{
  name: 'worker-name',
  script: './workers/worker-name.js',
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_memory_restart: '256M',
  kill_timeout: 5000,
  restart_delay: 3000,
  max_restarts: 10,
  min_uptime: '10s',
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
}
```

**When to use:** Any project with multiple background processes that need process management, auto-restart, and logging.

**Key implementation rules:**
- Each worker has **dedicated log files** (`logs/<worker>-combined.log`, `logs/<worker>-out.log`, `logs/<worker>-error.log`)
- Workers use `fork` mode (not `cluster`) — one instance per worker for isolation
- `max_memory_restart` prevents memory leaks from killing the server
- `kill_timeout: 5000` ensures graceful shutdown — workers should listen for `SIGINT`
- All workers share the same `NODE_ENV` and `DEPLOYMENT_TARGET` env vars
- Worker names are **kebab-case** and match the filename

**Validation:** After adding a worker, run `pm2 list` to verify it started, and check logs for errors.

---

## Lesson 7: Mock Trading Bridge Pattern

**Source:** [`lib/learning-layer/mock-trading-bridge.js`](lib/learning-layer/mock-trading-bridge.js)

A bridge layer that connects two subsystems (TLL ↔ Mock Trading) with explicit data flow:

```
Mock Trade Close → recordMockTradeOutcome() → brain_signal_memory → TLL analysis
TLL Regime → getTllRegimeForMockTrading() → Mock Trading worker blocks high_volatility
TLL Skills → checkSignalAgainstTllSkills() → confidence boost/penalty
TLL Weights → getTllStrategyWeights() → skip quarantined strategies
```

**When to use:** Any system where two subsystems need to exchange data without direct coupling.

**Key implementation rules:**
- The bridge is a **separate module** — neither subsystem imports the other directly
- Each bridge function has a **single responsibility** (get regime, check skills, get weights)
- Bridge functions **never throw** — they return safe defaults on error
- Data flows are **cached once per tick** — not fetched per-signal
- The bridge exposes a **unified snapshot** (`getTllMockTradingSnapshot()`) for dashboards

**Validation:** Bridge functions should be unit-testable with mock data — test both success and error paths.

---

## Lesson 8: Coder Signature & Changelog Tracking

**Source:** [`workers/coder-changelog-worker.js`](workers/coder-changelog-worker.js), [`.coder-signature.json`](.coder-signature.json)

A commit attribution system that tracks who (which agent/coder) made each change:

```json
{
  "coders": [
    { "id": "sb", "name": "Senior Builder", "signature": "[SB]", "role": "Lead Developer" },
    { "id": "sa", "name": "Signal Analyst", "signature": "[SA]", "role": "Signal Logic" },
    { "id": "rs", "name": "Risk & Security", "signature": "[RS]", "role": "Security Reviewer" },
    { "id": "vd", "name": "VPS Deployer", "signature": "[VD]", "role": "DevOps" },
    { "id": "doc", "name": "Documentation", "signature": "[DOC]", "role": "Docs Maintainer" }
  ],
  "commit_template": {
    "format": "[<SIGNATURE>] <type>(<scope>): <description>"
  }
}
```

**When to use:** Any project with multiple AI agents or human contributors where you need to track who did what.

**Key implementation rules:**
- Commit messages start with a **signature prefix** like `[SB]`
- The changelog worker automatically parses signatures from `git log`
- Each commit entry includes: date, coder, commit hash, files changed, and deployment status
- The changelog is a **living document** — updated automatically on each commit

**Validation:** After each commit, run the changelog worker to verify the entry was created correctly.

---

## Lesson 9: Deployment Verification Pattern

**Source:** [`workers/deploy-checker.js`](workers/deploy-checker.js), [`CODER-CHANGELOG.md`](CODER-CHANGELOG.md)

Every deployment must be verified with a multi-step checklist:

```
1. Commit and push to GitHub
2. Deploy to VPS (git pull + npm install + pm2 reload)
3. Verify health endpoint returns 200
4. Check all workers are running in PM2
5. Wait 30s for workers to stabilize
6. Update deploy_history table
7. Send Telegram notification
```

**When to use:** Any production deployment where reliability matters.

**Key implementation rules:**
- Track deployed commit hash vs. latest GitHub commit — detect undeployed changes
- Auto-deploy only during **maintenance windows** (configurable)
- Never auto-deploy if health checks are currently failing
- Keep last 5 deployments for quick rollback
- Pause auto-deploy if 2 consecutive deployments fail
- Log every deployment to `deploy_history` with commit SHA, status, and health check result

**Validation:** After deployment, verify the health endpoint and PM2 status before marking as complete.

---

## Lesson 10: Environment-Configurable Architecture

**Source:** [`lib/signal-engine.js`](lib/signal-engine.js), [`lib/brain/risk-gate.js`](lib/brain/risk-gate.js), [`lib/learning-layer/index.js`](lib/learning-layer/index.js)

Every tunable parameter is read from environment variables with sensible defaults:

```js
const EMA_SHORT = Number(process.env.EMA_SHORT_PERIOD || 9);
const EMA_LONG  = Number(process.env.EMA_LONG_PERIOD || 21);
const CONFIDENCE_THRESHOLD = Number(process.env.SIGNAL_CONFIDENCE_THRESHOLD || 0.65);
const TLL_ENABLED = process.env.TLL_ENABLED !== 'false';
```

**When to use:** Any project where behavior needs to change between environments (dev/staging/prod) or be tuned without code changes.

**Key implementation rules:**
- Every `process.env` read has a **sensible default** — the code works without any env vars
- Boolean flags use the pattern `process.env.FEATURE_ENABLED !== 'false'` (defaults to enabled)
- Numeric values are explicitly cast with `Number()` — never leave as strings
- All env vars are documented in `.env.example` with descriptions
- Feature flags are checked at module load time or function call time (not both — be consistent)

**Validation:** Test with no env vars set, then with specific overrides. The system should work in both cases.

---

## Skill Evolution

After using these lessons in a new project:
1. Add any new pattern that was discovered during implementation
2. If a pattern caused issues, add a guardrail that would have prevented it
3. If a pattern was adapted for a different domain, document the adaptation
4. Split this skill when it grows beyond 15 lessons

## Mandatory: Sync to superroo-learn

After every coding session or debug session that produces new lessons, patterns, or architecture insights:

1. **Run the sync script:**
   ```bash
   node scripts/sync-coding-lessons-to-tll.js
   ```

2. **If the project doesn't have the sync script yet**, create it following the pattern in [`scripts/sync-coding-lessons-to-tll.js`](/scripts/sync-coding-lessons-to-tll.js):
   - Define each lesson as a `tll_skills` record with `name`, `description`, `pattern_feature`, `pattern_value`, `confidence`, `metadata`
   - Use upsert (insert or update by name) so re-running is safe
   - Log results for audit

3. **What to sync:**
   - New architecture patterns discovered during implementation
   - Debug lessons — root causes, fixes, and guardrails that prevented recurrence
   - Updated descriptions of existing lessons (improved wording, new use cases)
   - New tags or categories that improve discoverability

4. **When to sync:**
   - ✅ At the end of every coding session
   - ✅ After every debug session that identified a root cause
   - ✅ When extracting patterns from a new project
   - ✅ When improving existing lesson descriptions

5. **Verification:**
   - Confirm the script exits with code 0
   - Check the log output shows `Synced N coding lessons to TLL`
   - If Supabase is unreachable, note it and retry next session

## Quality Gates

- Each lesson must reference the **source file** it was extracted from
- Each lesson must include **when to use** and **key implementation rules**
- Each lesson must include a **validation step**
- Lessons should be **portable** — not tied to trading domain terminology
