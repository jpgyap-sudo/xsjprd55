---
name: autonomous
description: 🤖 Autonomous Mode — Self-directed scanning, reporting & improvement loop
---

# Autonomous Skill

## Purpose
Enable the assistant to run self-directed scans and generate a comprehensive status report whenever the user triggers `/autonomous` or asks for an "autonomous report".

## Trigger Commands
- `autonomous`
- `/autonomous`
- `go autonomous`
- `run autonomous report`
- `what's the autonomous status`

## What The Report Covers
1. **Project State** — git status, last commit, uncommitted changes
2. **System Health** — key API endpoints, Supabase connection, Telegram webhook
3. **Worker Status** — which workers are defined vs running (if VPS info available)
4. **Recent Signals** — signal generation activity from Supabase (if accessible)
5. **Open Issues** — bugs/errors detected in logs or `agent_ideas` table
6. **Action Items** — prioritized next steps based on findings

## Report Output
- File: `AUTONOMOUS-REPORT-{YYYY-MM-DD-HHMM}.md` in workspace root
- Console: summary printed immediately
- Memory: `C:/Users/User/.roo/MEMORY.md` updated with autonomous session record

## Safety Rules
- Never expose secrets, API keys, or tokens in reports
- If Supabase/VPS is unreachable, note it and continue with local-only data
- Do not auto-fix critical issues without user confirmation
- Always log what was checked and what was skipped
