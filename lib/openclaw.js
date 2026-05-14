// ============================================================
// lib/openclaw.js — OpenClaw CLI Wrapper
// Analysis-only agent for repo investigation, dependency tracing,
// config inspection, code reading, route discovery, schema analysis,
// impact analysis, and risk assessment.
// OpenClaw is READ-ONLY and NEVER writes code.
// ============================================================

import { execSync } from 'child_process';
import { config } from './config.js';

/**
 * Resolve the OpenClaw CLI binary path.
 * Priority: env OPENCLAW_CLI_PATH > config > default "openclaw"
 */
function getCliPath() {
  return process.env.OPENCLAW_CLI_PATH || config.OPENCLAW_CLI_PATH || 'openclaw';
}

/**
 * Run an OpenClaw analysis and return the result.
 * @param {string} prompt - The analysis prompt/question
 * @param {object} [opts] - Options
 * @param {string} [opts.type] - Analysis type (repo_investigation, dependency_trace, etc.)
 * @param {number} [opts.timeout] - Timeout in ms (default: 120000)
 * @returns {{ ok: boolean, output: string, error?: string }}
 */
export function runOpenClaw(prompt, opts = {}) {
  const cliPath = getCliPath();
  const timeout = opts.timeout || 120000;

  try {
    const output = execSync(
      `"${cliPath}" run --plan-only "${sanitizePrompt(prompt)}"`,
      {
        timeout,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024 // 10MB
      }
    );
    return { ok: true, output: output.trim() };
  } catch (err) {
    const errorMsg = err.stderr?.trim() || err.message || 'OpenClaw execution failed';
    console.error('[openclaw] Error:', errorMsg);
    return { ok: false, error: errorMsg, output: err.stdout?.trim() || '' };
  }
}

/**
 * Run an OpenClaw analysis asynchronously (non-blocking).
 * @param {string} prompt - The analysis prompt/question
 * @param {object} [opts] - Options
 * @returns {Promise<{ ok: boolean, output: string, error?: string }>}
 */
export async function runOpenClawAsync(prompt, opts = {}) {
  const cliPath = getCliPath();
  const timeout = opts.timeout || 120000;

  try {
    const { execa } = await import('execa');
    const result = await execa(cliPath, ['run', '--plan-only', sanitizePrompt(prompt)], {
      timeout,
      maxBuffer: 10 * 1024 * 1024
    });
    return { ok: true, output: result.stdout.trim() };
  } catch (err) {
    const errorMsg = err.stderr?.trim() || err.message || 'OpenClaw execution failed';
    console.error('[openclaw] Async error:', errorMsg);
    return { ok: false, error: errorMsg, output: err.stdout?.trim() || '' };
  }
}

/**
 * Check if OpenClaw CLI is available.
 * @returns {{ available: boolean, version?: string, path?: string, error?: string }}
 */
export function checkOpenClaw() {
  const cliPath = getCliPath();
  try {
    const output = execSync(`"${cliPath}" --version`, {
      timeout: 10000,
      encoding: 'utf-8'
    });
    return {
      available: true,
      version: output.trim(),
      path: cliPath
    };
  } catch (err) {
    return {
      available: false,
      error: err.message || 'OpenClaw not found',
      path: cliPath
    };
  }
}

/**
 * Sanitize a prompt for shell safety.
 * Escapes double quotes and removes control characters.
 */
function sanitizePrompt(prompt) {
  if (typeof prompt !== 'string') return '';
  return prompt
    .replace(/"/g, '\\"')
    .replace(/[\x00-\x1f]/g, ' ')
    .trim();
}

/**
 * Convenience: Run a repo investigation analysis.
 */
export function investigateRepo(question = 'Investigate this repository structure and tech stack') {
  return runOpenClaw(question, { type: 'repo_investigation' });
}

/**
 * Convenience: Trace dependencies for a specific file or module.
 */
export function traceDependencies(target) {
  return runOpenClaw(`Trace all imports and dependencies for ${target}. Identify broken imports, circular dependencies, and unused dependencies.`, { type: 'dependency_trace' });
}

/**
 * Convenience: Inspect configuration files.
 */
export function inspectConfig() {
  return runOpenClaw('Inspect all configuration files (package.json, .env.example, Dockerfile, ecosystem.config.cjs) and report any misconfigurations or issues.', { type: 'config_inspection' });
}

/**
 * Convenience: Discover API routes and endpoints.
 */
export function discoverRoutes() {
  return runOpenClaw('Map all API endpoints and routes in this project. List every route with its HTTP method, handler file, and purpose.', { type: 'route_discovery' });
}

/**
 * Convenience: Analyze impact of changes to specific files.
 */
export function analyzeImpact(files) {
  const fileList = Array.isArray(files) ? files.join(', ') : files;
  return runOpenClaw(`Analyze the impact of changes to: ${fileList}. Which files would be affected? What are the risks?`, { type: 'impact_analysis' });
}

/**
 * Convenience: Assess risk of a proposed change.
 */
export function assessRisk(changeDescription) {
  return runOpenClaw(`Evaluate the implementation risks of: ${changeDescription}. Assess regression, security, and deployment risks.`, { type: 'risk_assessment' });
}
