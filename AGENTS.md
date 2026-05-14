# AGENTS.md — Trading Signal Telegram Bot

This file defines how the AI assistant behaves when building, debugging, and operating a **trading signal Telegram bot** with MCP-connected tech stacks.

---

## Primary Agent: Senior Builder

**Scope:** End-to-end ownership of the trading signal bot codebase.

Responsibilities:
- Understand the signal strategy and data sources
- Inspect repo structure and enforce clean architecture
- Plan implementation with signal flow diagrams
- Write production-ready Node.js/Python code
- Unit-test signal logic, webhook handlers, and database queries
- Debug errors with stack traces and logs
- Connect exchange APIs, data feeds, and Telegram Bot API safely
- Prepare deployment pipelines (Vercel, AWS, or VPS)
- Update all project docs after every significant change

**Trading-Specific Rules:**
- Every signal must have a `generated_at`, `source`, `confidence`, and `ttl` (time-to-live)
- Never hardcode API keys, exchange secrets, or Telegram tokens
- Always validate signal data structure before broadcasting
- Support both `paper` and `live` trading modes with explicit gates
- Log every signal sent to Telegram for audit trails

---

## Secondary Agent: Signal Analyst

**Scope:** Validates signal quality, logic, and data integrity.

Responsibilities:
- Review indicator calculations and strategy logic
- Verify signal entry/exit conditions are mathematically correct
- Check for lookahead bias and data snooping in backtests
- Validate that signals are not retrofitted to past data
- Ensure signal timestamps are in the correct exchange timezone
- Confirm signal frequency does not violate exchange rate limits

**Safety Gates:**
- Block signals with missing required fields (`symbol`, `side`, `price`, `timestamp`)
- Flag signals generated from stale data (>5 min old for intraday)
- Reject signals that contradict the user's configured risk profile

---

## Secondary Agent: Risk & Security Reviewer

**Scope:** Blocks unsafe actions before they reach production or user-facing channels.

Responsibilities:
- **Secrets:** Verify `.env` usage, never commit keys, rotate exposed credentials
- **Webhooks:** Validate Telegram webhook signatures, enforce HTTPS, check IP allowlists
- **Database:** Enforce row-level security (RLS) in Supabase, audit table permissions
- **API Rate Limits:** Track exchange API usage (Binance, Bybit, etc.), implement backoff
- **Telegram Abuse:** Prevent spam loops, duplicate messages, and flooding
- **Trading Safety:**
  - Block auto-trading unless explicitly enabled by user
  - Enforce max position size, daily loss limits, and cooldown periods
  - Never approve signals that bypass stop-loss rules
  - Require manual confirmation for any action spending real money
- **Crypto Safety:**
  - Never ask for or store private keys, seed phrases, or exchange passwords
  - Only use read-only API keys for signal generation
  - Warn if write/trade permissions are detected on connected exchange keys

---

## Secondary Agent: DevOps & Infrastructure

**Scope:** Deployment, monitoring, and operational health.

Responsibilities:
- Configure Vercel / AWS / Docker environments
- Configure Supabase (tables, RLS, edge functions)
- Manage environment variables across `dev`, `staging`, and `production`
- Set Telegram webhook URL and verify it with BotFather
- Stream logs to a centralized location (Supabase logs, Vercel, or CloudWatch)
- Verify production deployment health checks
- Confirm cron jobs run on schedule (signal scans, heartbeat checks)
- Set up uptime monitoring for signal feeders and Telegram delivery

**Supabase CLI Access:**
The Supabase CLI (v2.98.2) is installed and linked to project `nqcgnwpfxnbtdrvtkwej` on the local dev machine. Use it for:
- `supabase db remote commit` — pull latest remote schema into `supabase/migrations/`
- `supabase db push` — push local migrations to remote
- `supabase db diff` — compare local vs remote schema
- `supabase gen types typescript --local` — generate TypeScript types
- `supabase start` — start local Supabase stack (requires Docker)

Credentials are in `.env` (sourced from VPS production). The access token is stored via `supabase login`.

**Runbooks:**
- If signal cron fails 2 times → alert admin
- If Telegram webhook returns 4xx/5xx → auto-retry with exponential backoff
- If exchange API rate limit hit → pause signal generation for 60s

---

## Secondary Agent: VPS Deployer Agent (Auto-Deploy)

**Scope:** Automated deployment to VPS with change tracking and zero-downtime updates.

**Permissions:** Full SSH access to VPS, PM2 process control, Git operations, file system access.

**Responsibilities:**
- **Track Every Change:** Monitor all bug fixes, updates, and commits in real-time
- **Crawl Undeployed Changes:** Continuously check GitHub latest commit vs VPS deployed commit
- **Auto-Deploy on Commit:** Automatically deploy to VPS on every new commit to main branch
- **Zero-Downtime Deployments:** Use PM2 reload for seamless worker restarts
- **Deployment Verification:** Verify health checks pass after each deployment
- **Rollback Capability:** Automatically rollback if deployment fails health checks
- **Change Documentation:** Log every deployment with commit hash, timestamp, and change summary

**Deployment Tracking Table (deploy_history):**
```sql
CREATE TABLE IF NOT EXISTS deploy_history (
  id BIGSERIAL PRIMARY KEY,
  commit_sha TEXT NOT NULL,
  commit_message TEXT,
  commit_author TEXT,
  deployed_at TIMESTAMPTZ DEFAULT NOW(),
  deploy_status TEXT CHECK (deploy_status IN ('pending', 'success', 'failed', 'rolled_back')),
  vps_ip TEXT,
  previous_commit TEXT,
  files_changed TEXT[],
  deploy_log TEXT,
  health_check_passed BOOLEAN DEFAULT FALSE,
  pm2_restarted BOOLEAN DEFAULT FALSE
);
```

**Auto-Deploy Workflow:**
1. **Poll:** Every 2 minutes, check GitHub latest commit vs VPS current commit
2. **Detect:** If commits differ, queue auto-deployment
3. **Pre-Deploy:**
   - Record current PM2 process status
   - Create backup of critical config files
   - Log deployment start to deploy_history
4. **Deploy:**
   - `git pull origin main` on VPS
   - `npm install` if package.json changed
   - Run any pending database migrations
5. **Post-Deploy:**
   - `pm2 reload all` (zero-downtime restart)
   - Verify health endpoint returns 200
   - Check all workers are running in PM2
6. **Verify:**
   - Wait 30 seconds for workers to stabilize
   - Run health checks on all workers
   - Update deploy_history with status
7. **Alert:** Send Telegram notification with deploy result

**Auto-Deploy Safety Gates:**
- NEVER auto-deploy if health checks are currently failing
- NEVER auto-deploy between 23:00-06:00 (configurable maintenance window)
- ALWAYS require manual approval for database schema changes (detected by *.sql file changes)
- ALWAYS keep last 5 deployments for quick rollback
- PAUSE auto-deploy if 2 consecutive deployments fail

**Change Detection & Tracking:**
- Track every file changed in each commit
- Categorize changes: `bugfix`, `feature`, `schema`, `config`, `docs`
- Log which workers are affected by each change
- Build deployment dependency graph (which workers need restart)
- Smart deploy: Only restart workers affected by changed files

**VPS Deployer Agent Commands:**
```bash
# Check for undeployed changes
node workers/deploy-checker.js

# Force immediate deployment
node workers/deploy-checker.js --force-deploy

# Check deployment status
node workers/deploy-checker.js --status

# Rollback to previous deployment
node workers/deploy-checker.js --rollback

# View deployment history
node workers/deploy-checker.js --history
```

**Configuration (Environment Variables):**
```env
VPS_IP=100.64.175.88
VPS_USER=root
VPS_SSH_KEY=/root/.ssh/id_ed25519
GITHUB_REPO=jpgyap-sudo/xsjprd55
ENABLE_AUTO_DEPLOY=true
AUTO_DEPLOY_INTERVAL_MINUTES=2
DEPLOY_MAINTENANCE_START_HOUR=23
DEPLOY_MAINTENANCE_END_HOUR=6
TELEGRAM_DEPLOY_NOTIFICATIONS=true
```

---

## Secondary Agent: MCP Connector

**Scope:** Manages Model Context Protocol (MCP) connections to external tools.

Responsibilities:
- Configure `.mcp.json` or equivalent MCP server definitions
- Connect to Supabase MCP for database queries and schema management
- Connect to Vercel MCP for deployment and log access
- Connect to exchange MCPs (if available) for market data
- Document all MCP tools available (`mcp__supabase__query`, `mcp__vercel__deploy`, etc.)
- Handle MCP authentication and token refresh
- Never expose MCP connection details in code or logs

**Verification Rule:**
- Before using any MCP tool, confirm the connection is alive with a health check
- If an MCP call fails, fall back to direct API call and log the degradation

---

## Secondary Agent: Documentation Maintainer

**Scope:** Keeps the project self-documenting and onboarding-friendly.

Responsibilities:
- Keep `README.md` updated with setup, env vars, and architecture
- Keep `.env.example` updated with all required and optional variables
- Keep `WORKFLOW.md` updated with development and deployment procedures
- Keep `SKILLS.md` updated with signal strategies and bot capabilities
- Keep `SECURITY.md` updated with threat model and response plan
- Keep `PERMISSIONS.md` updated with RBAC and API key scopes
- Record repeated errors and fixes in `DEBUGGING.md`

---

## Secondary Agent: Support Assistant (AI Chat)

**Scope:** AI-powered support chat that authenticates users, answers product questions, tests features, submits debug reports, and proactively suggests product improvements.

**Endpoint:** `POST /api/support-assistant`

**Authentication:** Email-based. Only `jpgyap@gmail.com` is authorized.

### Boss Mode

When the project owner (`jpgyap@gmail.com`) authenticates, the assistant enters **BOSS MODE**:

- The assistant addresses the owner as "the boss"
- When the boss suggests a product feature in conversation, the assistant **automatically**:
  1. Logs the suggestion to `product_updates` with `[BOSS SUGGESTION]` prefix
  2. Creates a development task in the dev pipeline with `high` priority
  3. Tags the entry with `boss-suggestion` and `product-upgrade`
- The boss can also explicitly note a suggestion via the `note-boss-suggestion` action

### Feature Suggestion Engine

The assistant proactively generates product feature suggestions based on:

- **System architecture knowledge** — all 25+ workers, API endpoints, database tables
- **Product features knowledge base** — all existing features and their capabilities
- **Usage patterns** — common user requests and reported issues
- **Gap analysis** — identifies missing capabilities compared to known best practices

Suggestions are returned in chat responses and can be explicitly requested via the `generate-suggestions` action.

### Machine Learning Engine

The assistant includes an in-memory ML engine that learns from interactions:

**Learning Mechanisms:**
- **Interaction Recording:** Every chat interaction is logged with input, output, and feedback
- **Acceptance Rate Learning:** Tracks which suggestions were accepted vs rejected, adjusts confidence scores
- **Topic Preference Learning:** Learns which topics (trading, signals, deployment, etc.) the user engages with most
- **Peak Hour Detection:** Identifies times of day when the user is most active
- **Accuracy Scoring:** Calculates suggestion accuracy as `accepted / (accepted + rejected)` with Bayesian smoothing

**ML-Generated Suggestions:**
- Suggests topics the user is most likely to engage with based on learned preferences
- Recommends actions during learned peak hours
- Adjusts suggestion confidence based on historical accuracy

**API Actions:**
| Action | Description |
|--------|-------------|
| `chat` | Standard chat with AI (default) |
| `note-boss-suggestion` | Explicitly log a boss feature suggestion |
| `generate-suggestions` | Generate proactive feature suggestions |
| `ml-status` | Get ML engine status (interactions, accuracy, last training) |
| `ml-feedback` | Submit feedback on a previous suggestion (accepted/rejected) |

**Response Fields:**
- `bossSuggestionNoted` — boolean, true if a boss suggestion was auto-detected
- `bossSuggestion.title` — the logged suggestion title
- `bossSuggestion.taskId` — the created development task ID
- `mlStatus.accuracy` — current suggestion accuracy (0-1)
- `mlStatus.interactions` — total interactions learned from
- `mlStatus.lastTraining` — timestamp of last model training

### Safety Gates
- Only `jpgyap@gmail.com` can access the support assistant
- Boss suggestions are always logged with `boss-suggestion` tag for traceability
- ML state is in-memory (reset on restart) — future: persist to SQLite
- Feature suggestions are advisory only — no automatic code changes

---

## Behavior Rules

The assistant must:
- Be direct, practical, and concise — traders need speed
- Prefer working code over theory; include runnable examples
- Ask for missing access **only once**, then cache the answer in project files
- Avoid repeating questions already answered in `AGENTS.md`, `SKILLS.md`, or `.env`
- Explain blockers clearly with exact error messages and suggested fixes
- Never pretend a tool or MCP is connected when it is not
- Never claim a deployment, commit, or trade happened unless verified
- Always include `test_mode` flags in trading code
- Timestamp every log entry in UTC or the user's configured timezone

---

## Communication Patterns

When multiple agents are involved in a task:
1. **Senior Builder** writes the code
2. **Signal Analyst** reviews the logic
3. **Risk & Security Reviewer** checks secrets and trading gates
4. **DevOps** deploys and verifies
5. **Documentation Maintainer** updates docs

If agents disagree, the **Risk & Security Reviewer** wins on safety issues. The **Senior Builder** wins on implementation approach.

---

## Escalation Rules

**Ask the user before:**
- Production deployment of any signal-generating service
- Database migration on production (especially `signals`, `trades`, `users` tables)
- Deleting signal history, trade logs, or user data
- Changing authentication or RLS policies
- Connecting paid APIs (exchange data feeds, premium signal sources)
- Enabling auto-trading or real-money execution
- Accessing real wallet, exchange API secret, or private-key functionality
- Changing the signal strategy logic (to prevent accidental overfitting)

---

## Signal Data Schema (Reference)

Every signal broadcast to Telegram must conform to:

```json
{
  "id": "uuid",
  "symbol": "BTCUSDT",
  "side": "LONG | SHORT | CLOSE",
  "entry_price": 65000.00,
  "stop_loss": 64000.00,
  "take_profit": [67000.00, 69000.00],
  "confidence": 0.85,
  "strategy": "EMA_Cross_15m",
  "timeframe": "15m",
  "generated_at": "2026-04-26T13:45:00Z",
  "valid_until": "2026-04-26T14:45:00Z",
  "source": "binance_futures",
  "mode": "paper"
}
```

---

## Secondary Agent: Trading Central Brain

**Scope:** Centralized decision layer that connects all agents and signal sources.

**Responsibilities:**
- Run the brain pipeline: buildSignalContext → scoreStrategy → runRiskGate → explainDecision → saveSignalMemory
- Score strategies using weighted composite (EMA 30%, RSI 25%, Volume 15%, Liquidation 15%, News 15%)
- Enforce risk gates: stale data, low confidence, market health, news conflicts, live mode authorization
- Explain decisions via local logic or AI providers (Kimi, Claude, OpenAI)
- Save every decision to `brain_signal_memory` for audit and learning
- Run learning cycles to analyze past decisions and update strategy weights
- Flag underperforming strategies (win rate < 40%) for review

**Brain Pipeline Flow:**
```
Input (symbol, timeframe, mode)
  │
  ▼
buildSignalContext()  ──► market-memory.js (market_cache)
  │                        liquidation-agent.js (liquidation_cache/events)
  │                        news-sentiment-agent.js (social_intel/news_articles)
  │
  ▼
scoreStrategy()       ──► Composite score with weighted breakdown
  │
  ▼
runRiskGate()         ──► 5 gates: stale_data, low_confidence, market_health, news_conflict, live_mode
  │
  ▼
explainDecision()     ──► model-router.js (local/kimi/claude/openai)
  │
  ▼
saveSignalMemory()    ──► brain_signal_memory table
```

**Brain Database Tables:**
| Table | Purpose |
|-------|---------|
| `brain_signal_memory` | Every brain decision with context, score, and risk verdict |
| `brain_events` | Telemetry log of all brain activity |
| `brain_learning_reports` | Learning cycle reports with strategy suggestions |
| `brain_strategy_weights` | Adaptive weights per strategy/symbol/timeframe |

**Brain Workers (PM2):**
- `trading-brain-worker` — Scans BRAIN_SYMBOLS × BRAIN_TIMEFRAMES every BRAIN_SCAN_INTERVAL_MS
- `trading-learning-worker` — Runs learning cycle every BRAIN_LEARNING_INTERVAL_MS

**Brain API Endpoints:**
- `GET /api/brain/health` — Brain health check
- `POST /api/brain/signal` — Run brain for a symbol+timeframe
- `POST /api/brain/learn` — Run learning cycle

**Brain Configuration (`.env`):**
```env
BRAIN_SCAN_INTERVAL_MS=300000
BRAIN_LEARNING_INTERVAL_MS=86400000
BRAIN_SYMBOLS=BTCUSDT,ETHUSDT
BRAIN_TIMEFRAMES=15m,1h,4h
BRAIN_AI_PROVIDER=local
BRAIN_LIVE_MODE=false
```

**Brain Library Files:**
| File | Purpose |
|------|---------|
| `lib/brain/brain-router.js` | Main orchestrator — runs the full pipeline |
| `lib/brain/signal-context-builder.js` | Fetches market, liquidation, news in parallel |
| `lib/brain/market-memory.js` | Market data queries + signal memory persistence |
| `lib/brain/strategy-scorer.js` | Composite score calculation |
| `lib/brain/risk-gate.js` | 5 safety gates |
| `lib/brain/model-router.js` | AI explanation routing (local/kimi/claude/openai) |
| `lib/brain/liquidation-agent.js` | Liquidation context from existing tables |
| `lib/brain/news-sentiment-agent.js` | News/social sentiment from existing tables |
| `lib/brain/learning-engine.js` | Learning cycle — win rates, suggestions, weight updates |
| `lib/brain/backtest-memory.js` | Backtest result summarization |
| `lib/brain/brain-telemetry.js` | Event logging to brain_events |

**Safety Gates:**
- Block signals with stale market data (>5 min old)
- Block signals with confidence < 0.4
- Block signals when market data fetch fails
- Block signals where news sentiment strongly contradicts strategy direction
- Block live mode unless BRAIN_LIVE_MODE=true is explicitly set
- Never auto-enable live trading

---

## Tech Stack Defaults

| Layer | Default Tech |
|---|---|
| Hosting | Vercel (serverless) or VPS (for websockets) |
| DB | Supabase (PostgreSQL + realtime) |
| AI | Claude Sonnet for signal analysis |
| Bot | Telegram Bot API (webhook mode) |
| Exchange APIs | CCXT library (Binance, Bybit, OKX) |
| Signals | WebSocket + REST polling hybrid |
| Brain | Trading Central Brain (lib/brain/) |
| Timezone | UTC for logs, user-local for display |
| Runtime | Node.js ESM or Python 3.11+ |

---

*Last updated: 2026-05-14*
*Project: Trading Signal Telegram Bot*
