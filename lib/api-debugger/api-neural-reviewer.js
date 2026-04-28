// ============================================================
// API Neural Reviewer
// Uses existing AI infrastructure (lib/ai.js / config.js)
// to review API test results and suggest fixes
// ============================================================

import { config } from '../config.js';
import { generateAIResponse } from '../ai.js';

function safeJson(text) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : text);
  } catch {
    return null;
  }
}

function heuristicImprove(result) {
  const fixes = [];
  if (result.error_category === 'AUTH_INVALID_KEY') {
    fixes.push('Add or rotate API key in .env / config');
  }
  if (result.error_category === 'RATE_LIMIT') {
    fixes.push('Add exponential backoff (1s, 2s, 4s, 8s)');
    fixes.push('Cache responses to reduce repeated calls');
  }
  if (result.error_category === 'TIMEOUT') {
    fixes.push('Increase fetch timeout to 30-60s');
    fixes.push('Add AbortController for cancellation');
  }
  if (result.error_category === 'CONTEXT_LENGTH') {
    fixes.push('Truncate prompt to fit model context window');
    fixes.push('Use a model with larger context (e.g., kimi-128k)');
  }
  if (result.error_category === 'TLS') {
    fixes.push('Update system CA certificates');
    fixes.push('Verify TLS version compatibility');
  }
  if (result.provider === 'internal' && result.status === 'down') {
    fixes.push('Check if the app server is running');
    fixes.push('Verify CRON_SECRET for protected endpoints');
  }
  if (result.response_time_ms > 10000) {
    fixes.push('Optimize request payload size');
    fixes.push('Consider async queue for heavy requests');
  }
  return fixes;
}

async function callKimiReviewer(results, docs) {
  const baseUrl = config.KIMI_BASE_URL || 'https://api.moonshot.cn/v1';
  const model = config.KIMI_MODEL || 'kimi-latest';
  const apiKey = config.KIMI_API_KEY;

  if (!apiKey) throw new Error('KIMI_API_KEY missing');

  const system = `You are an API debugging expert. Review the failing API test results and suggest concrete fixes. Respond ONLY with JSON in this exact shape:
{\n  "findings": [\n    {\n      "provider": "kimi|claude|internal",\n      "issue": "short issue name",\n      "root_cause": "one sentence",\n      "recommended_fix": "one sentence",\n      "severity": "critical|high|medium|low"\n    }\n  ],\n  "summary": "one sentence overall summary"\n}`;

  const user = `API test results (failures only):\n${JSON.stringify(results.filter(r => r.status !== 'healthy'), null, 2).slice(0, 6000)}\n\nRelevant docs snippets:\n${docs.map(d => `- ${d.title || d.provider}: ${d.summary || ''}`).join('\n').slice(0, 2000)}`;

  const text = await generateAIResponse(system, user, {
    provider: 'kimi',
    maxTokens: 2048,
    temperature: 0.2
  });

  const parsed = safeJson(text);
  if (parsed && parsed.findings) return parsed;

  // Fallback to heuristic
  return {
    findings: results
      .filter(r => r.status !== 'healthy')
      .map(r => ({
        provider: r.provider,
        issue: r.error_category || 'API failure',
        root_cause: r.error_message || 'Unknown',
        recommended_fix: heuristicImprove(r).join('; ') || 'Review logs and retry',
        severity: r.severity || 'medium'
      })),
    summary: 'Heuristic review used due to LLM parsing failure'
  };
}

async function callClaudeReviewer(results, docs) {
  const apiKey = config.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');

  const system = `You are an API debugging expert. Review failing API test results and suggest concrete fixes. Respond ONLY with JSON in this exact shape:
{\n  "findings": [\n    {\n      "provider": "kimi|claude|internal",\n      "issue": "short issue name",\n      "root_cause": "one sentence",\n      "recommended_fix": "one sentence",\n      "severity": "critical|high|medium|low"\n    }\n  ],\n  "summary": "one sentence overall summary"\n}`;

  const user = `API test results (failures only):\n${JSON.stringify(results.filter(r => r.status !== 'healthy'), null, 2).slice(0, 6000)}\n\nRelevant docs snippets:\n${docs.map(d => `- ${d.title || d.provider}: ${d.summary || ''}`).join('\n').slice(0, 2000)}`;

  const text = await generateAIResponse(system, user, {
    provider: 'claude',
    maxTokens: 2048,
    temperature: 0.2
  });

  const parsed = safeJson(text);
  if (parsed && parsed.findings) return parsed;

  return {
    findings: results
      .filter(r => r.status !== 'healthy')
      .map(r => ({
        provider: r.provider,
        issue: r.error_category || 'API failure',
        root_cause: r.error_message || 'Unknown',
        recommended_fix: heuristicImprove(r).join('; ') || 'Review logs and retry',
        severity: r.severity || 'medium'
      })),
    summary: 'Heuristic review used due to LLM parsing failure'
  };
}

export async function reviewApiResultsWithNeuralAgent(results, docs) {
  const failures = results.filter(r => r.status !== 'healthy');
  if (!failures.length) {
    return {
      findings: [],
      summary: 'All APIs healthy — no review needed'
    };
  }

  const hasKimi = !!config.KIMI_API_KEY;
  const hasClaude = !!config.ANTHROPIC_API_KEY;

  if (hasKimi) {
    try {
      return await callKimiReviewer(results, docs);
    } catch (err) {
      console.warn('[api-neural-reviewer] Kimi review failed:', err.message);
      if (hasClaude) return await callClaudeReviewer(results, docs);
    }
  }

  if (hasClaude) {
    try {
      return await callClaudeReviewer(results, docs);
    } catch (err) {
      console.warn('[api-neural-reviewer] Claude review failed:', err.message);
    }
  }

  return {
    findings: failures.map(r => ({
      provider: r.provider,
      issue: r.error_category || 'API failure',
      root_cause: r.error_message || 'Unknown',
      recommended_fix: heuristicImprove(r).join('; ') || 'Review logs and retry',
      severity: r.severity || 'medium'
    })),
    summary: 'Heuristic review — no LLM keys available'
  };
}
