---
name: memory
description: 🧠 GLOBAL SKILL: Cross-Session Memory & Task Continuity
---

# Global Memory Skill

## Purpose
Persist context across sessions so the assistant can answer "what was the last task" and resume work seamlessly, regardless of which project is opened.

## Memory File Location
```
C:/Users/User/.roo/MEMORY.md
```

## On Every Session Start
1. **Read** `C:/Users/User/.roo/MEMORY.md`
2. Extract:
   - Last task description
   - Last project / workspace
   - Files that were open or modified
   - Any blockers or TODOs left behind
3. **Report it** in the opening context summary under a heading: `### Last Task (from MEMORY.md)`

## During The Session
If the user says any of these, read MEMORY.md and resume:
- "what was the last task"
- "go back to last task"
- "continue where we left off"
- "resume"

Then:
1. Report what the last task was
2. Ask: "Continue from there?"
3. If yes, switch to the relevant project/workspace if needed and continue

### Autonomous Report Trigger
If the user triggers autonomous mode (`autonomous`, `/autonomous`, `go autonomous`, `run autonomous report`):
1. Run `node scripts/autonomous-report.js` in the current workspace
2. Read the generated `AUTONOMOUS-REPORT-YYYY-MM-DD-HHMM.md`
3. Summarize findings to the user
4. Append a summary entry to `C:/Users/User/.roo/MEMORY.md` under `## Autonomous Session`

## At Session End (Mandatory)
Before ending any session, update `C:/Users/User/.roo/MEMORY.md` with:

```markdown
# Global Session Memory

## Last Session
- **Date (UTC):** YYYY-MM-DDTHH:mm:ssZ
- **Project:** /path/to/workspace
- **Task:** One-line summary
- **What was done:** Bullet list of actions
- **Files modified:** List of files
- **Blockers / TODOs:** Anything unfinished
- **Next planned:** What should happen next

## How to Resume
<!-- The assistant reads this to continue seamlessly -->
1. Open project: {workspace path}
2. Read files: {list}
3. Continue: {task description}
```

## Rules
- Always overwrite the file — only the most recent session matters.
- Never include secrets, API keys, or tokens.
- Keep it concise but specific enough to resume.
- If the memory file is missing, create it and note: "No previous session recorded."
