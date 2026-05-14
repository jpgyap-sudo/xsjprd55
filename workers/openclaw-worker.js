// ============================================================
// OpenClaw Analysis Worker — Periodic code analysis agent
// Runs scheduled analysis scans using OpenClaw CLI.
// OpenClaw is READ-ONLY and NEVER writes code.
// ============================================================

import 'dotenv/config';
import { investigateRepo, inspectConfig, discoverRoutes, checkOpenClaw } from '../lib/openclaw.js';
import { logAgentEvent } from '../lib/brain-integration.js';

const SCAN_INTERVAL_MS = parseInt(process.env.OPENCLAW_SCAN_INTERVAL_MS || '3600000', 10); // 1 hour default
const ENABLED = process.env.ENABLE_OPENCLAW_WORKER !== 'false';

/**
 * Run a single analysis scan cycle.
 */
async function runScanCycle() {
  console.log(`[openclaw-worker] Starting analysis cycle at ${new Date().toISOString()}`);

  // Check CLI availability
  const cliStatus = checkOpenClaw();
  if (!cliStatus.available) {
    console.warn('[openclaw-worker] OpenClaw CLI not available:', cliStatus.error);
    await logAgentEvent('openclaw_worker', 'cli_unavailable', {
      error: cliStatus.error,
      path: cliStatus.path
    });
    return;
  }

  console.log(`[openclaw-worker] OpenClaw CLI available: ${cliStatus.version}`);

  // Run config inspection
  console.log('[openclaw-worker] Running config inspection...');
  const configResult = inspectConfig();
  if (configResult.ok) {
    console.log(`[openclaw-worker] Config inspection complete (${configResult.output.length} chars)`);
    await logAgentEvent('openclaw_worker', 'config_inspection', {
      output_length: configResult.output.length,
      timestamp: new Date().toISOString()
    });
  } else {
    console.warn('[openclaw-worker] Config inspection failed:', configResult.error);
  }

  // Run route discovery
  console.log('[openclaw-worker] Running route discovery...');
  const routeResult = discoverRoutes();
  if (routeResult.ok) {
    console.log(`[openclaw-worker] Route discovery complete (${routeResult.output.length} chars)`);
    await logAgentEvent('openclaw_worker', 'route_discovery', {
      output_length: routeResult.output.length,
      timestamp: new Date().toISOString()
    });
  } else {
    console.warn('[openclaw-worker] Route discovery failed:', routeResult.error);
  }

  console.log(`[openclaw-worker] Analysis cycle complete at ${new Date().toISOString()}`);
}

/**
 * Main worker loop.
 */
async function main() {
  if (!ENABLED) {
    console.log('[openclaw-worker] Disabled via ENABLE_OPENCLAW_WORKER=false');
    return;
  }

  console.log(`[openclaw-worker] Starting (interval: ${SCAN_INTERVAL_MS}ms)`);

  // Run initial scan
  await runScanCycle();

  // Schedule periodic scans
  setInterval(runScanCycle, SCAN_INTERVAL_MS);
}

main().catch(err => {
  console.error('[openclaw-worker] Fatal error:', err);
  process.exit(1);
});
