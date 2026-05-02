// ============================================================
// Debug Crawler Worker — AI-Powered Code Quality Agent
// Scans repo routinely, runs static + neural analysis, submits
// findings to bugs dashboard. Runs as PM2 worker or via cron.
// ============================================================

import { scanRepoFiles, summarizeRepo } from '../lib/debug/repo-scanner.js';
import { runStaticAnalysis } from '../lib/debug/static-analyzer.js';
import { runDependencyCheck } from '../lib/debug/dependency-checker.js';
import { runSecurityCheck } from '../lib/debug/security-checker.js';
import { runProjectTests, runSmokeTests, findingsFromTestResults } from '../lib/debug/test-runner.js';
import { runNeuralCodeReview } from '../lib/debug/neural-code-reviewer.js';
import { normalizeFindings, countBySeverity, rankFindings } from '../lib/debug/finding-normalizer.js';
import { submitFindingsToApi, submitFindingsToLocalDb } from '../lib/debug/bug-submitter.js';
import { createDebugCrawlerRun, updateDebugCrawlerRun } from '../lib/bug-store.js';
import { isMainModule } from '../lib/entrypoint.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function llmFindingsToBugReports(review) {
  return (review.findings || []).map(f => ({
    source_agent: 'neural_code_reviewer',
    title: f.title,
    description: f.description,
    severity: f.severity,
    file_path: f.file_path,
    affected_area: f.affected_area,
    recommendation: f.recommendation,
    metadata: { neural_summary: review.summary || null }
  }));
}

export async function runDebugCrawlerCycle() {
  let run = null;

  try {
    run = await createDebugCrawlerRun({
      metadata: {
        provider: process.env.DEBUG_REVIEW_PROVIDER || process.env.AI_PROVIDER || 'heuristic',
        started_by: 'debug-crawler-worker'
      }
    });
  } catch (error) {
    console.warn('[debug-crawler] could not create db run record:', error.message);
  }

  const started = Date.now();

  try {
    // 1. Scan repository
    const files = await scanRepoFiles();
    const repoSummary = summarizeRepo(files);

    // 2. Run deterministic analyzers
    const staticFindings = runStaticAnalysis(files);
    const dependencyFindings = runDependencyCheck(files);
    const securityFindings = runSecurityCheck(files);

    // 3. Run tests and smoke checks
    const testResults = await runProjectTests();
    const smokeResults = await runSmokeTests();
    const testFindings = findingsFromTestResults(testResults, smokeResults);

    // 4. Run neural/deep learning code review
    const neuralReview = await runNeuralCodeReview(files, repoSummary);
    const neuralFindings = llmFindingsToBugReports(neuralReview);

    // 5. Normalize and dedupe all findings
    const findings = normalizeFindings([
      ...staticFindings,
      ...dependencyFindings,
      ...securityFindings,
      ...testFindings,
      ...neuralFindings
    ]);

    const rankedFindings = rankFindings(findings);

    // 6. Submit to database
    let submitted = null;
    if (findings.length) {
      if (process.env.DEBUG_CRAWLER_SUBMIT_TO_API === 'true') {
        submitted = await submitFindingsToApi(rankedFindings);
      } else {
        submitted = await submitFindingsToLocalDb(rankedFindings);
      }
    }

    const severityCounts = countBySeverity(findings);
    const summary = `Debug crawler scanned ${files.length} files and found ${findings.length} findings.`;

    if (run?.id) {
      await updateDebugCrawlerRun(run.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        files_scanned: files.length,
        findings_count: findings.length,
        ...severityCounts,
        summary,
        metadata: {
          repoSummary,
          neural_summary: neuralReview.summary,
          testResults: testResults.map(r => ({ ok: r.ok, command: r.command })),
          smokeResults,
          duration_ms: Date.now() - started
        }
      });
    }

    const result = {
      ok: true,
      summary,
      files_scanned: files.length,
      findings_count: findings.length,
      ...severityCounts,
      findings: rankedFindings,
      submitted_count: Array.isArray(submitted) ? submitted.length : submitted?.count || 0,
      duration_ms: Date.now() - started
    };

    if (process.env.DEBUG_CRAWLER_FAIL_ON_CRITICAL === 'true' && severityCounts.critical_count > 0) {
      result.ok = false;
    }

    return result;
  } catch (error) {
    if (run?.id) {
      try {
        await updateDebugCrawlerRun(run.id, {
          status: 'failed',
          completed_at: new Date().toISOString(),
          error: error.message
        });
      } catch {}
    }

    throw error;
  }
}

async function main() {
  const once = process.argv.includes('--once');
  const intervalSeconds = Number(process.env.DEBUG_CRAWLER_INTERVAL_SECONDS || 21600); // 6 hours default

  console.log('[debug-crawler] starting', { once, intervalSeconds });

  do {
    try {
      const result = await runDebugCrawlerCycle();
      console.log('[debug-crawler] cycle complete:', JSON.stringify({
        ok: result.ok,
        summary: result.summary,
        critical: result.critical_count,
        high: result.high_count,
        medium: result.medium_count,
        low: result.low_count
      }, null, 2));
    } catch (error) {
      console.error('[debug-crawler] cycle failed:', error);
    }

    if (once) break;
    await sleep(intervalSeconds * 1000);
  } while (true);
}

if (isMainModule(import.meta.url)) {
  main();
}
