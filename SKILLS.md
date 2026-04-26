# SKILLS.md — Trading Signal Bot Skills

## 1. Repo Understanding Skill
Inspect:
- Folder structure
- `package.json`
- API routes
- Bot handlers
- Supabase schema
- Environment variable requirements
- Deployment config
- Existing tests and scripts

Output:
- Tech stack summary
- Missing files
- Main risks
- Recommended next task

## 2. Telegram Bot Development Skill
Build Telegram bot features:
- `/start`
- Button menus
- Inline keyboard actions
- Group chat commands
- Admin-only commands
- Signal alerts
- User preferences
- Webhook endpoint
- Error handling
- Rate limiting

Rules:
- Verify Telegram bot token is never committed
- Webhook endpoint must validate secret when possible
- Bot should handle duplicate updates safely
- Bot should not spam users
- Signal messages must include disclaimer

## 3. Trading Signal Engine Skill
Build analytics and signal features:
- Market data ingestion via CCXT or exchange APIs
- Funding rate monitoring
- Price alerts
- Volume alerts
- Liquidation data integration if API access exists
- Watchlists
- Risk warnings
- Backtesting framework
- Paper-trading simulation
- Telegram alert summaries

Rules:
- Every signal must have `generated_at`, `source`, `confidence`, `ttl`
- Signals must include risk language
- No guaranteed profit claims
- No real trade execution by default
- Keep exchange keys read-only unless explicitly approved
- Never request private keys or seed phrases
- Validate signal schema before broadcasting
- Support both `paper` and `live` modes with explicit gates

## 4. Supabase Skill
Help with:
- Table schema design (`signals`, `trades`, `users`, `alerts`)
- Row Level Security policies
- SQL migrations
- Edge functions
- Storage buckets
- API client setup
- Service-role key safety

Rules:
- Never expose service-role key to browser/client code
- Prefer migrations over manual dashboard changes
- Test RLS assumptions
- Do not run destructive SQL without explicit permission

## 5. Vercel Deployment Skill
Help with:
- Project setup
- Environment variables
- Build errors
- Preview deployments
- Production deployments
- Cron jobs (signal scans, health checks)
- Logs inspection

Rules:
- Deploy preview first when possible
- Production deploy requires explicit permission
- Do not expose secrets in logs or client bundle

## 6. GitHub Skill
Help with:
- Branch creation
- Commits
- Pull requests
- GitHub Actions
- Issue tracking
- README updates

Rules:
- Commit only verified changes
- Do not commit `.env`
- Do not commit API keys, tokens, private keys, seed phrases, or session cookies
- Use clear commit messages

## 7. Debugging Skill
Debug in this order:
1. Reproduce the error
2. Read logs and stack trace
3. Identify smallest likely cause
4. Apply minimal fix
5. Run focused test
6. Run golden path test
7. Record reusable fix in `DEBUGGING.md` if it may happen again

Common checks:
- Missing env vars
- Wrong webhook URL
- Wrong Telegram token
- Supabase RLS blocking writes
- Client/server key confusion
- Vercel build error
- TypeScript error
- API route runtime mismatch
- Cron timezone confusion
- Exchange API rate limit hit
- Signal cron fails silently
- Stale market data (>5 min old for intraday)

## 8. Documentation Auto-Update Skill
Update project docs when learning a reusable workflow.

Update rules:
- Add durable knowledge only
- Do not write secrets
- Do not store temporary error logs unless useful
- Keep docs concise
- Prefer appending to `DEBUGGING.md` for repeated fixes
- Mirror important global learnings back into guide files when allowed

## 9. Safety Review Skill
Before production, check:
- Secrets are not in git
- `.env.example` is complete but safe
- Telegram webhook is protected
- Supabase RLS is enabled where needed
- Logs do not expose sensitive data
- Crypto actions are read-only or require human approval
- Rate limits exist for user-triggered actions
- Error messages do not leak system details
- Signal disclaimers are present
- Max position size and daily loss limits are configured
- Stop-loss rules are enforced
