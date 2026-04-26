# WORKFLOW.md — Trading Signal Telegram Bot Workflow

## Main User Flow
Telegram user message or button press
→ Telegram sends update to webhook
→ Vercel API route receives update
→ Bot validates request
→ AI/router parses intent
→ App reads/writes Supabase
→ App fetches market data if needed
→ Signal/risk engine generates response
→ Telegram sends confirmation or alert
→ Logs are saved for debugging and analytics

## Signal Alert Flow
Scheduled job starts
→ Fetch market data from approved APIs
→ Normalize data
→ Calculate signal conditions
→ Apply risk filters
→ Save snapshot to Supabase
→ If alert threshold is met, send Telegram message
→ Save alert history

## Backtesting Flow
User selects strategy and time range
→ App fetches historical market data
→ Strategy engine simulates entries/exits
→ Risk metrics are calculated
→ Results are saved
→ Telegram or dashboard returns summary

## Permission Flow
Identify required access
→ List exact permissions needed
→ User approves or denies
→ Perform only approved actions
→ Report results and any remaining blockers

## Documentation Learning Flow
New error, fix, or workflow discovered
→ Confirm it is reusable
→ Update `DEBUGGING.md`, `WORKFLOW.md`, or `SKILLS.md`
→ Commit doc update if allowed

## Default Cron Jobs
- Market scan every 5–15 minutes depending on API limits
- Daily summary at 8:00 PM PHT
- Weekly performance review every Sunday 8:00 PM PHT
- Health check every 30–60 minutes

## Production Checklist
Before production release:
- Build passes
- Golden path Telegram test passes
- Supabase write/read test passes
- RLS reviewed
- Webhook validated
- Env vars configured
- No secrets committed
- Rate limits enabled
- Signal disclaimers present
- Max position size and daily loss limits configured
- Stop-loss rules enforced
- Paper mode is default; live mode requires explicit user opt-in
