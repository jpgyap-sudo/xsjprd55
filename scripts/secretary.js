// ============================================================
// Secretary — Auto-Task Recorder
// Records what the coder has done every 20 minutes so sessions
// can be resumed after disconnects or hardware failures.
// ============================================================

import { execSync } from 'child_process';
import { appendFileSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __file = fileURLToPath(import.meta.url);
const __dir = dirname(__file);
const PROJECT_ROOT = resolve(__dir, '..');
const LOG_PATH = resolve(PROJECT_ROOT, '.roo', 'SECRETARY-LOG.md');
const INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

function now() {
  return new Date().toISOString();
}

function shell(cmd) {
  try {
    return execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 15000 }).trim();
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

function getGitStatus() {
  const branch = shell('git rev-parse --abbrev-ref HEAD');
  const lastCommit = shell('git log -1 --format="%h %s (%cr)"');
  const uncommitted = shell('git status --short');
  const recentFiles = shell('git diff --name-only HEAD~5..HEAD');
  return { branch, lastCommit, uncommitted, recentFiles };
}

function getTodoList() {
  // Try to read the latest todo list from the in-memory state isn't available,
  // so we just note that the user should keep the todo list updated via update_todo_list
  return 'See REMINDERS section in conversation context for current TODO list';
}

function recordEntry() {
  const ts = now();
  const { branch, lastCommit, uncommitted, recentFiles } = getGitStatus();

  const entry = `
## Secretary Snapshot — ${ts}

**Branch:** ${branch}
**Last Commit:** ${lastCommit}
**Uncommitted Changes:**
\`\`\`
${uncommitted || '(none)'}
\`\`\`
**Recently Modified Files (last 5 commits):**
\`\`\`
${recentFiles || '(none)'}
\`\`\`
**TODO Status:** ${getTodoList()}

---
`;

  if (!existsSync(LOG_PATH)) {
    writeFileSync(LOG_PATH, `# Secretary Auto-Log\n\n> Automatically recorded every 20 minutes.\n> Use this to resume after disconnects or crashes.\n\n---\n`, 'utf8');
  }

  appendFileSync(LOG_PATH, entry, 'utf8');
  console.log(`[secretary] Recorded snapshot at ${ts}`);
}

// Run immediately on start, then every 20 minutes
recordEntry();
setInterval(recordEntry, INTERVAL_MS);

console.log(`[secretary] Running. Logging to ${LOG_PATH} every ${INTERVAL_MS / 60000} minutes.`);
