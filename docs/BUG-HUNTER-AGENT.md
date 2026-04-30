# Bug Hunter Agent — Production Guide

## Overview
The Bug Hunter Agent is a 24/7 autonomous bug detection system that:
- Scans repository for code issues
- Crawls live website for runtime errors
- Monitors APIs for failures
- Creates structured bug reports
- Assigns bugs to appropriate agents

## Architecture

```
Bug Hunter Agent
├── Repo Scanner (existing)
├── Live Site Crawler (Playwright/fetch)
├── Severity Classifier
├── Signature Generator (deduplication)
├── Assignment Engine
└── Bug Registry (Supabase)
```

## Bug Report Format

```json
{
  "bug_id": "BUG-20260115-143022-ABC",
  "detected_by": "BugHunterAgent",
  "timestamp": "2026-01-15T14:30:22Z",
  "severity": "critical | high | medium | low",
  "status": "new",
  "route": "/mock-trader",
  "title": "Mock trader inactive",
  "symptoms": ["trader_inactive", "api_failure"],
  "evidence": {
    "http_status": 500,
    "response_ms": 5234,
    "console_errors": [],
    "api_errors": [],
    "logs": [],
    "screenshot_path": null
  },
  "suspected_root_cause": "...",
  "affected_files_guess": ["workers/execution-worker.js"],
  "recommended_owner": "DebuggerAgent | SWE-agent",
  "recommended_next_action": "..."
}
```

## Environment Variables

```env
BUG_HUNTER_ENABLED=true
BUG_HUNTER_BASE_URL=https://bot.abcx124.xyz
BUG_HUNTER_INTERVAL_SECONDS=900
BUG_HUNTER_TIMEOUT_MS=15000
BUG_HUNTER_NOTIFY_TELEGRAM=true
BUG_HUNTER_ASSIGN_CRITICAL=true
```

## Commands

```bash
# Single run
npm run bug-hunter

# Continuous mode
npm run bug-hunter:watch

# PM2
pm2 start ecosystem.config.cjs --only bug-hunter-worker
```

## Routes Monitored

- `/` - Home
- `/dashboard` - Dashboard
- `/signals` - Signals page
- `/mock-trader` - Mock trader
- `/research` - Research
- `/news` - News
- `/api/health` - Health check
- `/api/data-health` - Data health
- `/api/signal` - Signal API
- `/api/mock-trading-dashboard` - Trader API
- `/api/news` - News API
- `/api/telegram` - Telegram API

## Safety Rules

- **READ-ONLY**: Never edits code
- **NO DEPLOYMENT**: Never deploys changes
- **NO SECRETS**: Never logs or accesses secrets
- **NO TRADING**: Never executes trades
- Rate limiting prevents spam

## Agents

| Agent | Handles |
|-------|---------|
| DebuggerAgent | Trading logic, signals, complex bugs |
| SWE-agent | Code fixes, frontend/backend |
| SecurityAgent | Security vulnerabilities |
| DevOpsAgent | Infrastructure, deployment |
| TesterAgent | Test failures, QA |
