// ============================================================
// OpenClaw Analysis API — /api/openclaw
// Provides programmatic access to OpenClaw analysis capabilities.
// OpenClaw is READ-ONLY and NEVER writes code.
// ============================================================

import { runOpenClaw, runOpenClawAsync, checkOpenClaw, investigateRepo, traceDependencies, inspectConfig, discoverRoutes, analyzeImpact, assessRisk } from '../lib/openclaw.js';

/**
 * POST /api/openclaw — Run an OpenClaw analysis
 * Body: { prompt: string, type?: string, async?: boolean, timeout?: number }
 *
 * GET /api/openclaw/health — Check if OpenClaw CLI is available
 *
 * GET /api/openclaw — List available analysis types
 */
export default async function handler(req, res) {
  try {
    const { method } = req;
    const pathParts = req.url.split('?')[0].replace(/^\/api\/openclaw/, '').replace(/\/+$/, '').split('/').filter(Boolean);

    // GET /api/openclaw/health — Check CLI availability
    if (method === 'GET' && pathParts[0] === 'health') {
      const status = checkOpenClaw();
      return res.status(200).json({
        ok: true,
        openclaw: status
      });
    }

    // GET /api/openclaw — List available analysis types
    if (method === 'GET' && pathParts.length === 0) {
      return res.status(200).json({
        ok: true,
        description: 'OpenClaw Analysis Agent — READ-ONLY code analysis',
        endpoints: {
          'GET /api/openclaw': 'List available analysis types',
          'GET /api/openclaw/health': 'Check OpenClaw CLI availability',
          'POST /api/openclaw': 'Run an OpenClaw analysis'
        },
        analysis_types: [
          { type: 'repo_investigation', description: 'Full repo structure & tech stack analysis' },
          { type: 'dependency_trace', description: 'Trace imports, requires, references' },
          { type: 'config_inspection', description: 'Check config files for issues' },
          { type: 'code_reading', description: 'Summarize specific files or modules' },
          { type: 'route_discovery', description: 'Map API endpoints and routes' },
          { type: 'schema_analysis', description: 'Analyze database schemas' },
          { type: 'duplicate_detection', description: 'Find repeated code patterns' },
          { type: 'impact_analysis', description: 'Assess change impact' },
          { type: 'risk_assessment', description: 'Evaluate implementation risks' }
        ],
        convenience_methods: [
          { name: 'investigateRepo', description: 'Investigate repository structure and tech stack' },
          { name: 'traceDependencies', description: 'Trace dependencies for a specific file' },
          { name: 'inspectConfig', description: 'Inspect configuration files' },
          { name: 'discoverRoutes', description: 'Discover API routes and endpoints' },
          { name: 'analyzeImpact', description: 'Analyze impact of changes to specific files' },
          { name: 'assessRisk', description: 'Assess risk of a proposed change' }
        ]
      });
    }

    // POST /api/openclaw — Run analysis
    if (method === 'POST') {
      const { prompt, type, async: useAsync, timeout } = req.body || {};

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ ok: false, error: 'Missing required field: prompt (string)' });
      }

      // Check CLI availability first
      const cliStatus = checkOpenClaw();
      if (!cliStatus.available) {
        return res.status(503).json({
          ok: false,
          error: 'OpenClaw CLI is not available',
          details: cliStatus
        });
      }

      const opts = { type, timeout };

      if (useAsync) {
        // Non-blocking async execution
        const result = await runOpenClawAsync(prompt, opts);
        return res.status(result.ok ? 200 : 500).json({
          ok: result.ok,
          type: type || 'custom',
          output: result.output,
          error: result.error || null
        });
      }

      // Synchronous execution (blocking)
      const result = runOpenClaw(prompt, opts);
      return res.status(result.ok ? 200 : 500).json({
        ok: result.ok,
        type: type || 'custom',
        output: result.output,
        error: result.error || null
      });
    }

    // Unsupported method
    return res.status(405).json({ ok: false, error: `Method ${method} not supported` });
  } catch (err) {
    console.error('[openclaw-api] Error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
  }
}
