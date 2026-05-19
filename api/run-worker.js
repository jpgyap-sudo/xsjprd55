// ============================================================
// Run Worker — /api/run-worker
// On-demand API endpoint for triggering individual orchestrator
// tasks and viewing orchestrator status.
//
// This replaces 30 separate always-running PM2 workers with a
// single orchestrator process + API-triggered execution.
//
// Endpoints:
//   GET  /api/run-worker          — orchestrator status
//   GET  /api/run-worker/status   — orchestrator status (alias)
//   POST /api/run-worker/:task    — trigger a specific task
//   POST /api/run-worker          — trigger task from body
// ============================================================

import { logger } from '../lib/logger.js';

// ── Dynamic import of orchestrator ──────────────────────────
// The orchestrator is a long-running process. If it's not the
// current process (e.g. this API is loaded in the main server),
// we import it to access its exported functions.
let orchestrator = null;

async function getOrchestrator() {
  if (!orchestrator) {
    try {
      orchestrator = await import('../workers/orchestrator-worker.js');
    } catch (e) {
      logger.error('[run-worker] Failed to load orchestrator:', e.message);
      return null;
    }
  }
  return orchestrator;
}

// ── Handler ─────────────────────────────────────────────────
export default async function handler(req, res) {
  const { method, url } = req;
  const pathParts = url.split('?')[0].replace(/^\/api\/run-worker\/?/, '').split('/').filter(Boolean);
  const action = pathParts[0] || null;

  // ── GET: Status ───────────────────────────────────────────
  if (method === 'GET') {
    const orch = await getOrchestrator();
    if (!orch || !orch.getOrchestratorStatus) {
      return res.json({
        ok: true,
        orchestrator_loaded: false,
        message: 'Orchestrator not loaded in this process. Run workers/orchestrator-worker.js as a separate PM2 process.',
        hint: 'The orchestrator runs as its own PM2 process. This API endpoint works when called from the orchestrator process, or you can check /api/worker-health for PM2 status.'
      });
    }

    const status = orch.getOrchestratorStatus();
    return res.json({
      ok: true,
      orchestrator_loaded: true,
      ...status,
    });
  }

  // ── POST: Trigger a task ──────────────────────────────────
  if (method === 'POST') {
    const orch = await getOrchestrator();
    if (!orch || !orch.runTaskByName) {
      return res.status(503).json({
        ok: false,
        error: 'Orchestrator not available',
        message: 'The orchestrator process is not running. Start it with: pm2 start workers/orchestrator-worker.js --name orchestrator',
      });
    }

    // Determine task name from URL path or request body
    let taskName = action || (req.body && req.body.task) || null;

    if (!taskName) {
      return res.status(400).json({
        ok: false,
        error: 'Missing task name',
        available_tasks: [
          // Cyclical tasks (scheduled in orchestrator)
          'mock-trading', 'aggressive-mock', 'perpetual-trader', 'strategy-monitor',
          'news-ingest', 'liquidation-intel', 'liquidation-heatmap', 'open-interest',
          'social-crawler', 'wallet-tracker', 'social-news',
          'learning-loop', 'tll', 'brain-learning', 'simulation-learning',
          'backtest-sync', 'continuous-backtester',
          'data-health', 'notification', 'research-agent', 'diagnostic',
          // Special tasks
          'brain', 'signal-generator',
          // On-demand only (debug/dev — not scheduled in orchestrator)
          'execution', 'bug-hunter', 'debug-crawler', 'api-debugger',
          'bug-fix-pipeline', 'capability-consolidator', 'app-improvement',
          'coder-changelog', 'agent-change-tracker', 'openclaw-analysis',
          'news-signal', 'continuous-test-monitor',
        ],
        hint: 'POST /api/run-worker/mock-trading  or  POST /api/run-worker with body {"task": "brain"}',
      });
    }

    // ── On-demand only tasks (not scheduled in orchestrator) ──
    const onDemandTasks = {
      'execution': () => import('../workers/execution-worker.js').then(m => m.main ? m.main() : m.pollAndExecute()),
      'bug-hunter': () => import('../workers/bug-hunter-worker.js').then(m => m.runBugHunter ? m.runBugHunter() : m.main()),
      'debug-crawler': () => import('../workers/debug-crawler-worker.js').then(m => m.runDebugCrawler ? m.runDebugCrawler() : m.main()),
      'api-debugger': () => import('../workers/api-debugger-worker.js').then(m => m.runApiDebugger ? m.runApiDebugger() : m.main()),
      'bug-fix-pipeline': () => import('../workers/bug-fix-pipeline-worker.js').then(m => m.runBugFixPipeline ? m.runBugFixPipeline() : m.main()),
      'capability-consolidator': () => import('../workers/capability-consolidator-worker.js').then(m => m.runCapabilityConsolidator ? m.runCapabilityConsolidator() : m.main()),
      'app-improvement': () => import('../workers/app-improvement-worker.js').then(m => m.runAppImprovement ? m.runAppImprovement() : m.main()),
      'coder-changelog': () => import('../workers/coder-changelog-worker.js').then(m => m.runCoderChangelog ? m.runCoderChangelog() : m.main()),
      'agent-change-tracker': () => import('../workers/agent-change-tracker.js').then(m => m.runAgentChangeTracker ? m.runAgentChangeTracker() : m.main()),
      'openclaw-analysis': () => import('../workers/openclaw-worker.js').then(m => m.runOpenclawAnalysis ? m.runOpenclawAnalysis() : m.main()),
      'news-signal': () => import('../workers/news-signal-worker.js').then(m => m.runNewsSignal ? m.runNewsSignal() : m.main()),
      'continuous-test-monitor': () => import('../workers/continuous-test-monitor.cjs').then(m => m.runTestMonitor ? m.runTestMonitor() : m.main()),
    };

    if (onDemandTasks[taskName]) {
      try {
        logger.info(`[run-worker] Triggering on-demand task: ${taskName}`);
        const result = await onDemandTasks[taskName]();
        return res.json({ ok: true, task: taskName, result: result || 'completed' });
      } catch (e) {
        logger.error(`[run-worker] On-demand task ${taskName} failed:`, e.message);
        return res.status(500).json({ ok: false, task: taskName, error: e.message });
      }
    }

    // ── Orchestrator-managed tasks ──────────────────────────
    try {
      logger.info(`[run-worker] Triggering orchestrator task: ${taskName}`);
      const result = await orch.runTaskByName(taskName);
      return res.json({ ok: true, task: taskName, ...result });
    } catch (e) {
      return res.status(400).json({ ok: false, task: taskName, error: e.message });
    }
  }

  // ── Unsupported method ────────────────────────────────────
  return res.status(405).json({ ok: false, error: `Method ${method} not supported` });
}
