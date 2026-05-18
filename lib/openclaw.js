// ============================================================
// lib/openclaw.js — OpenClaw CLI Wrapper
// Analysis-only agent for repo investigation, dependency tracing,
// config inspection, code reading, route discovery, schema analysis,
// impact analysis, and risk assessment.
// OpenClaw is READ-ONLY and NEVER writes code.
// v2: Ollama-powered summary of analysis findings
// ============================================================

import { execSync } from 'child_process';
import { config } from './config.js';
import { logger } from './logger.js';

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
 * Summarize OpenClaw analysis output using Ollama.
 * Extracts key findings, risks, and recommendations from verbose output.
 */
export async function summarizeWithOllama(analysisOutput, analysisType = 'analysis') {
  const baseUrl = config.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = config.OLLAMA_MODEL || 'phi3:mini';

  if (!analysisOutput || analysisOutput.length < 50) {
    return { summary: analysisOutput, keyFindings: [], risks: [], recommendations: [] };
  }

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You are an analysis summarizer. Given ${analysisType} output, extract key information. Return ONLY a JSON object:
{
  "summary": "<2-3 sentence executive summary>",
  "keyFindings": ["<finding1>", "<finding2>"],
  "risks": ["<risk1>", "<risk2>"],
  "recommendations": ["<recommendation1>", "<recommendation2>"]
}
Do NOT include any other text.`
          },
          {
            role: 'user',
            content: analysisOutput.slice(0, 3000)
          }
        ],
        options: { temperature: 0.1, max_tokens: 512 }
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = await response.json();
    const content = data.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      summary: parsed.summary || analysisOutput.slice(0, 200),
      keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      source: 'ollama'
    };
  } catch (err) {
    logger.debug(`[openclaw] Ollama summary unavailable: ${err.message}`);
    return {
      summary: analysisOutput.slice(0, 200),
      keyFindings: [],
      risks: [],
      recommendations: [],
      source: 'truncated'
    };
  }
}

/**
 * Convenience: Run a repo investigation analysis with Ollama summary.
 */
export async function investigateRepo(question = 'Investigate this repository structure and tech stack') {
  const result = runOpenClaw(question, { type: 'repo_investigation' });
  if (!result.ok) return result;

  const summary = await summarizeWithOllama(result.output, 'repo investigation');
  return { ...result, summary };
}

/**
 * Convenience: Trace dependencies for a specific file or module.
 */
export async function traceDependencies(target) {
  const result = runOpenClaw(
    `Trace all imports and dependencies for ${target}. Identify broken imports, circular dependencies, and unused dependencies.`,
    { type: 'dependency_trace' }
  );
  if (!result.ok) return result;

  const summary = await summarizeWithOllama(result.output, 'dependency trace');
  return { ...result, summary };
}

/**
 * Convenience: Inspect configuration files.
 */
export async function inspectConfig() {
  const result = runOpenClaw(
    'Inspect all configuration files (package.json, .env.example, Dockerfile, ecosystem.config.cjs) and report any misconfigurations or issues.',
    { type: 'config_inspection' }
  );
  if (!result.ok) return result;

  const summary = await summarizeWithOllama(result.output, 'config inspection');
  return { ...result, summary };
}

/**
 * Convenience: Discover API routes and endpoints.
 */
export async function discoverRoutes() {
  const result = runOpenClaw(
    'Map all API endpoints and routes in this project. List every route with its HTTP method, handler file, and purpose.',
    { type: 'route_discovery' }
  );
  if (!result.ok) return result;

  const summary = await summarizeWithOllama(result.output, 'route discovery');
  return { ...result, summary };
}

/**
 * Convenience: Analyze impact of changes to specific files.
 */
export async function analyzeImpact(files) {
  const fileList = Array.isArray(files) ? files.join(', ') : files;
  const result = runOpenClaw(
    `Analyze the impact of changes to: ${fileList}. Which files would be affected? What are the risks?`,
    { type: 'impact_analysis' }
  );
  if (!result.ok) return result;

  const summary = await summarizeWithOllama(result.output, 'impact analysis');
  return { ...result, summary };
}

/**
 * Convenience: Assess risk of a proposed change.
 */
export async function assessRisk(changeDescription) {
  const result = runOpenClaw(
    `Evaluate the implementation risks of: ${changeDescription}. Assess regression, security, and deployment risks.`,
    { type: 'risk_assessment' }
  );
  if (!result.ok) return result;

  const summary = await summarizeWithOllama(result.output, 'risk assessment');
  return { ...result, summary };
}
