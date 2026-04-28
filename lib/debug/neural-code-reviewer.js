// ============================================================
// Neural Code Reviewer — Deep Learning Bug Detection
// Uses LLM providers (Kimi, Claude, OpenAI) for intelligent
// code review, architecture analysis, and bug prediction.
// Falls back to heuristic rules when no API key is available.
// ============================================================

import { config } from '../config.js';

const REVIEW_SYSTEM = `You are a senior code reviewer for a crypto trading signal bot running on VPS.
Find real bugs, security risks, data freshness problems, deployment risks, and architecture weaknesses.
Do not invent files that are not shown.
Return strict JSON only.`;

function safeJson(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM did not return JSON');
  return JSON.parse(match[0]);
}

function compactFile(file) {
  return `FILE: ${file.path}
---
${file.content.slice(0, 6000)}
---`;
}

/**
 * Heuristic review — deterministic checks when no LLM is available.
 */
function heuristicReview(files, repoSummary) {
  const findings = [];

  const hasApi = files.some(f => f.path.startsWith('api/'));
  const hasWorkers = files.some(f => f.path.startsWith('workers/'));
  const hasDashboard = files.some(f => f.path.startsWith('public/') || /dashboard/i.test(f.path));
  const hasSupabase = files.some(f => f.path.startsWith('supabase/'));

  if (hasApi && !files.some(f => /CRON_SECRET|isAuthorized|authorization/i.test(f.content))) {
    findings.push({
      title: 'No CRON_SECRET protection detected in scanned files',
      description: 'The scan did not detect CRON_SECRET usage. Admin and worker-trigger endpoints may be exposed.',
      severity: 'critical',
      file_path: 'api',
      affected_area: 'security',
      recommendation: 'Add CRON_SECRET validation to every cron/admin/write endpoint.'
    });
  }

  if (hasWorkers && !files.some(f => /pm2|ecosystem/.test(f.path.toLowerCase() + f.content.toLowerCase()))) {
    findings.push({
      title: 'Worker processes may not be managed by PM2',
      description: 'Workers exist but no PM2 ecosystem configuration was detected in scanned files.',
      severity: 'medium',
      file_path: 'workers',
      affected_area: 'deployment',
      recommendation: 'Add PM2 ecosystem config and save process list on VPS.'
    });
  }

  if (!hasDashboard) {
    findings.push({
      title: 'Dashboard files not detected',
      description: 'No dashboard/public files were detected in the scan.',
      severity: 'low',
      file_path: 'public',
      affected_area: 'dashboard',
      recommendation: 'Confirm dashboard path or add dashboard tabs for health, bugs, and social intelligence.'
    });
  }

  if (hasSupabase && !files.some(f => f.path === 'supabase/schema.sql')) {
    findings.push({
      title: 'No schema.sql found in supabase folder',
      description: 'Supabase migrations exist but no schema.sql was detected.',
      severity: 'low',
      file_path: 'supabase',
      affected_area: 'database',
      recommendation: 'Maintain a schema.sql file for onboarding and documentation.'
    });
  }

  // Check for repeated code patterns
  const apiFiles = files.filter(f => f.path.startsWith('api/'));
  const authPatterns = apiFiles.filter(f => /isAuthorized|CRON_SECRET/.test(f.content));
  if (authPatterns.length < apiFiles.length * 0.5) {
    findings.push({
      title: 'Many API routes may lack authorization',
      description: `Only ${authPatterns.length}/${apiFiles.length} API files show authorization patterns.`,
      severity: 'high',
      file_path: 'api',
      affected_area: 'security',
      recommendation: 'Centralize auth middleware and apply to all admin/mutation endpoints.'
    });
  }

  return {
    summary: `Heuristic review completed. Files scanned: ${repoSummary.files_scanned}.`,
    findings
  };
}

/**
 * Call Kimi (Moonshot AI) for neural code review.
 */
async function callKimiReviewer({ files, repoSummary }) {
  const apiKey = config.KIMI_API_KEY;
  const baseUrl = config.KIMI_BASE_URL || 'https://api.moonshot.cn/v1';
  const model = config.KIMI_MODEL || 'kimi-k2-6';

  if (!apiKey) throw new Error('KIMI_API_KEY not configured');

  const prompt = `${REVIEW_SYSTEM}

Repo summary:
${JSON.stringify(repoSummary, null, 2)}

Review these files:
${files.slice(0, 25).map(compactFile).join('\n\n')}

Return strict JSON:
{
  "summary": "short summary",
  "findings": [
    {
      "title": "bug title",
      "description": "what is wrong",
      "severity": "low|medium|high|critical",
      "file_path": "path",
      "affected_area": "security|deployment|database|api|worker|dashboard|tests|architecture|market_data|configuration",
      "recommendation": "specific fix"
    }
  ]
}`;

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: REVIEW_SYSTEM },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) throw new Error(`Kimi reviewer HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return safeJson(data.choices?.[0]?.message?.content || '{}');
}

/**
 * Call Anthropic Claude for neural code review.
 */
async function callClaudeReviewer({ files, repoSummary }) {
  const apiKey = config.ANTHROPIC_API_KEY;
  const model = config.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const prompt = `${REVIEW_SYSTEM}

Repo summary:
${JSON.stringify(repoSummary, null, 2)}

Review these files:
${files.slice(0, 25).map(compactFile).join('\n\n')}

Return strict JSON with summary and findings array.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`Claude reviewer HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const text = data.content?.map(c => c.text || '').join('\n') || '';
  return safeJson(text);
}

/**
 * Run neural code review with automatic provider selection.
 * Priority: configured DEBUG_REVIEW_PROVIDER → AI_PROVIDER → heuristic
 */
export async function runNeuralCodeReview(files, repoSummary) {
  const provider = (process.env.DEBUG_REVIEW_PROVIDER || config.AI_PROVIDER || 'heuristic').toLowerCase();

  try {
    if (provider === 'kimi' || provider === 'moonshot') {
      return await callKimiReviewer({ files, repoSummary });
    }

    if (provider === 'anthropic' || provider === 'claude') {
      return await callClaudeReviewer({ files, repoSummary });
    }

    if (provider === 'openai') {
      // OpenAI-compatible fallback
      return await callKimiReviewer({ files, repoSummary });
    }
  } catch (error) {
    console.warn('[neural-code-reviewer] LLM failed; using heuristic reviewer:', error.message);
  }

  return heuristicReview(files, repoSummary);
}
