// ============================================================
// API Debugger Worker
// Runs live tests, crawls docs, neural reviews, persists results
// ============================================================

import { runAllApiLiveTests } from '../lib/api-debugger/api-live-tester.js';
import { reviewApiResultsWithNeuralAgent } from '../lib/api-debugger/api-neural-reviewer.js';
import { crawlApiDocs } from '../lib/api-debugger/api-docs-crawler.js';
import {
  createApiDebuggerRun,
  updateApiDebuggerRun,
  insertApiDebugResults,
  listDocsCache,
  submitApiIssueToBugs
} from '../lib/api-debugger/api-debugger-store.js';

export async function runApiDebuggerCycle() {
  let run;
  try {
    run = await createApiDebuggerRun({
      triggered_by: 'worker',
      ts: new Date().toISOString()
    });
  } catch (err) {
    console.error('[api-debugger-worker] Failed to create run:', err.message);
    run = { id: null };
  }

  const start = Date.now();
  let results = [];
  let docs = [];
  let reviewed = { findings: [], summary: '' };

  try {
    // Step 1: Live tests (parallel with doc crawl)
    const [testResults, docResults] = await Promise.allSettled([
      runAllApiLiveTests(),
      crawlApiDocs()
    ]);

    if (testResults.status === 'fulfilled') {
      results = testResults.value;
    } else {
      console.error('[api-debugger-worker] Live tests failed:', testResults.reason?.message);
      results = [];
    }

    if (docResults.status === 'fulfilled') {
      console.log('[api-debugger-worker] Docs crawled:', docResults.value.length);
    } else {
      console.warn('[api-debugger-worker] Doc crawl failed:', docResults.reason?.message);
    }

    // Step 2: Fetch cached docs for neural review context
    try {
      docs = await listDocsCache(20);
    } catch (err) {
      console.warn('[api-debugger-worker] Could not load docs cache:', err.message);
      docs = [];
    }

    // Step 3: Neural review
    try {
      reviewed = await reviewApiResultsWithNeuralAgent(results, docs);
    } catch (err) {
      console.warn('[api-debugger-worker] Neural review failed:', err.message);
      reviewed = { findings: [], summary: 'Neural review failed' };
    }

    // Step 4: Persist results
    const rows = results.map(r => ({
      provider: r.provider,
      endpoint: r.endpoint,
      method: r.method || 'POST',
      status: r.status,
      http_code: r.http_code || 0,
      response_time_ms: r.response_time_ms || 0,
      error_category: r.error_category,
      error_message: r.error_message,
      request_safe: r.request_safe || null,
      response_safe: r.response_safe || null,
      severity: r.severity || 'medium'
    }));

    try {
      const persisted = await insertApiDebugResults(rows);
      console.log(`[api-debugger-worker] Persisted ${persisted.length} results`);

      // Step 5: Cross-submit critical/high issues to bugs table
      for (const r of results.filter(x => x.severity === 'critical' || x.severity === 'high')) {
        try {
          await submitApiIssueToBugs(r);
        } catch {
          // best-effort
        }
      }
    } catch (err) {
      console.error('[api-debugger-worker] Failed to persist results:', err.message);
    }

    // Step 6: Update run record
    if (run.id) {
      await updateApiDebuggerRun(run.id, {
        status: 'completed',
        finished_at: new Date().toISOString(),
        results_count: rows.length,
        metadata: {
          duration_ms: Date.now() - start,
          neural_findings: reviewed.findings.length,
          neural_summary: reviewed.summary,
          docs_crawled: docs.length
        }
      });
    }

    return {
      runId: run.id,
      resultsCount: rows.length,
      neuralFindings: reviewed.findings.length,
      summary: reviewed.summary
    };
  } catch (err) {
    console.error('[api-debugger-worker] Cycle error:', err.message);
    if (run.id) {
      await updateApiDebuggerRun(run.id, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        metadata: { error: err.message, stack: err.stack }
      });
    }
    return { runId: run.id, error: err.message };
  }
}

async function main() {
  console.log('[api-debugger-worker] Starting API debugger cycle...');
  const result = await runApiDebuggerCycle();
  console.log('[api-debugger-worker] Cycle complete:', JSON.stringify({
    runId: result.runId,
    resultsCount: result.resultsCount,
    neuralFindings: result.neuralFindings,
    summary: result.summary?.slice(0, 200)
  }));
  process.exit(0);
}

if (process.argv.includes('--once')) {
  main();
} else {
  // Continuous mode: run every 10 minutes
  const INTERVAL_MS = Number(process.env.API_DEBUGGER_INTERVAL_MS) || 600000;
  console.log(`[api-debugger-worker] Continuous mode. Interval: ${INTERVAL_MS}ms`);

  async function loop() {
    await runApiDebuggerCycle();
    setTimeout(loop, INTERVAL_MS);
  }
  loop();
}
