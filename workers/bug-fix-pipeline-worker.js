// ============================================================
// Bug Auto-Fix Pipeline Worker — xsjprd55
// Periodically scans critical/high bugs and queues them as
// dev tasks for the coding agent to fix automatically.
// ============================================================

import { runBugAutoFixCycle, initBugFixPipelineTables } from '../lib/advisor/bug-fix-pipeline.js';
import { config } from '../lib/config.js';
import { isMainModule } from '../lib/entrypoint.js';

const CYCLE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export async function runBugFixPipelineWorker() {
  console.log('[bug-fix-pipeline] Starting worker…');
  initBugFixPipelineTables();

  // Run immediately on start
  await runOneCycle();

  // Then on interval
  setInterval(async () => {
    await runOneCycle();
  }, CYCLE_INTERVAL_MS);
}

async function runOneCycle() {
  const ts = new Date().toISOString();
  console.log(`[bug-fix-pipeline] Cycle started at ${ts}`);
  try {
    const result = await runBugAutoFixCycle();
    console.log(`[bug-fix-pipeline] Cycle complete: scanned=${result.scanned}, queued=${result.queued}, skipped=${result.skipped}`);
    if (result.tasksCreated.length) {
      for (const t of result.tasksCreated) {
        console.log(`[bug-fix-pipeline]  → Task #${t.taskId} created for bug #${t.bugId}: ${t.title}`);
      }
    }
    if (result.errors.length) {
      for (const e of result.errors) {
        console.warn(`[bug-fix-pipeline]  → Error on bug ${e.bugId || 'cycle'}: ${e.error}`);
      }
    }
  } catch (e) {
    console.error('[bug-fix-pipeline] Cycle failed:', e.message);
  }
}

// Standalone entry point
async function main() {
  await runBugFixPipelineWorker();
}

if (isMainModule(import.meta.url)) {
  main().catch(e => {
    console.error('[bug-fix-pipeline] Fatal:', e);
    process.exit(1);
  });
}
