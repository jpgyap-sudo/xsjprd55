// ============================================================
// Static Analyzer — Deterministic bug detection for xsjprd55
// Scans code files for patterns that indicate bugs, risks, or
// anti-patterns. No LLM needed — exact regex + AST-like checks.
// ============================================================

import crypto from 'crypto';

function finding({ title, description, severity = 'medium', file_path, affected_area, recommendation, metadata = {} }) {
  const fingerprint = crypto
    .createHash('sha256')
    .update([title, file_path || '', affected_area || ''].join('|').toLowerCase())
    .digest('hex');

  return {
    source_agent: 'debug_crawler_agent',
    title,
    description,
    severity,
    priority: severity === 'critical' ? 1 : severity === 'high' ? 2 : severity === 'medium' ? 3 : 4,
    file_path,
    affected_area,
    recommendation,
    fingerprint,
    metadata
  };
}

export function runStaticAnalysis(files) {
  const findings = [];

  for (const file of files) {
    const c = file.content || '';
    const lowerPath = file.path.toLowerCase();

    // ── Env var usage without validation ──────────────────────
    if (/process\.env\.[A-Z0-9_]+/.test(c) && !/try|catch|if\s*\(|throw new Error/.test(c.slice(Math.max(0, c.indexOf('process.env') - 300), c.indexOf('process.env') + 800))) {
      findings.push(finding({
        title: 'Environment variable used without validation',
        description: `${file.path} references process.env values without visible validation. Missing env checks cause silent production failures.`,
        severity: 'medium',
        file_path: file.path,
        affected_area: 'configuration',
        recommendation: 'Add startup/env validation for required variables and fail fast with clear error messages. Use lib/config.js or a validation schema.'
      }));
    }

    // ── Unprotected admin API endpoints ───────────────────────
    if (lowerPath.startsWith('api/') && /type\s*===\s*['"`](run|delete|admin|cron|mark-done|bulk-create)/.test(c) && !/CRON_SECRET|isAuthorized|authorization/i.test(c)) {
      findings.push(finding({
        title: 'Potential unprotected admin API endpoint',
        description: `${file.path} exposes admin/cron behavior without obvious CRON_SECRET protection.`,
        severity: 'critical',
        file_path: file.path,
        affected_area: 'security',
        recommendation: 'Require CRON_SECRET or an authenticated admin session before running admin, cron, bulk, delete, or worker actions.'
      }));
    }

    // ── Hardcoded secrets ─────────────────────────────────────
    if (/api[_-]?key|secret|token|password/i.test(c) && /=\s*['"`][A-Za-z0-9_\-]{20,}/.test(c) && !lowerPath.includes('example') && !lowerPath.includes('.env.example')) {
      findings.push(finding({
        title: 'Possible hardcoded secret found',
        description: `${file.path} may contain a hardcoded API key, token, password, or secret.`,
        severity: 'critical',
        file_path: file.path,
        affected_area: 'secrets',
        recommendation: 'Move secrets to environment variables, rotate exposed keys, and remove secrets from git history with BFG or filter-repo.'
      }));
    }

    // ── Fetch without timeout ─────────────────────────────────
    if (/fetch\(/.test(c) && !/AbortController|timeout|signal/.test(c)) {
      findings.push(finding({
        title: 'Network request lacks timeout protection',
        description: `${file.path} has fetch() calls without AbortController or timeout handling. This can hang workers or API routes indefinitely.`,
        severity: 'medium',
        file_path: file.path,
        affected_area: 'reliability',
        recommendation: 'Wrap all fetch calls with AbortController timeout and implement retry with exponential backoff. Use lib/fetch-with-fallback.js pattern.'
      }));
    }

    // ── Console.log near sensitive terms ──────────────────────
    if (/console\.log\(/.test(c) && /token|secret|password|key|private/i.test(c)) {
      findings.push(finding({
        title: 'Logs may expose sensitive values',
        description: `${file.path} logs near sensitive terms — potential secret leakage into VPS/PM2 logs.`,
        severity: 'high',
        file_path: file.path,
        affected_area: 'security',
        recommendation: 'Never log secrets. Redact tokens and keys before logging. Use a structured logger like lib/logger.js with redaction rules.'
      }));
    }

    // ── Missing error handling in async functions ─────────────
    if (/async\s+function|=>\s*\{[\s\S]*?await\s+/.test(c) && !/try\s*\{|catch\s*\(/.test(c)) {
      findings.push(finding({
        title: 'Async function missing error handling',
        description: `${file.path} contains async/await without try/catch. Unhandled rejections crash the Node process.`,
        severity: 'high',
        file_path: file.path,
        affected_area: 'reliability',
        recommendation: 'Wrap async operations in try/catch. For Express routes, add centralized error middleware. For workers, add process-level unhandledRejection handlers.'
      }));
    }

    // ── SQL tables missing timestamps ─────────────────────────
    if (lowerPath.endsWith('.sql') && /create table/i.test(c) && !/created_at|updated_at/i.test(c)) {
      findings.push(finding({
        title: 'Database table missing timestamp columns',
        description: `${file.path} creates a table without created_at/updated_at timestamps.`,
        severity: 'low',
        file_path: file.path,
        affected_area: 'database',
        recommendation: 'Add created_at and updated_at columns for auditability and dashboard tracking. Consider using triggers for auto-update.'
      }));
    }

    // ── eval() or new Function() usage ────────────────────────
    if (/eval\s*\(|new\s+Function\s*\(/.test(c)) {
      findings.push(finding({
        title: 'Dangerous code execution detected',
        description: `${file.path} uses eval() or new Function() which enables arbitrary code execution.`,
        severity: 'critical',
        file_path: file.path,
        affected_area: 'security',
        recommendation: 'Replace eval() with JSON.parse() for data parsing, or use a safe expression parser. Never eval() user input.'
      }));
    }

    // ── SQL injection risk in raw queries ─────────────────────
    if (/query\s*\(|\.query\s*\(`[^`]*\$\{/.test(c) || /query\s*\([\s\S]*?\+/.test(c)) {
      findings.push(finding({
        title: 'Potential SQL injection via string interpolation',
        description: `${file.path} appears to build SQL queries with template literals or concatenation.`,
        severity: 'critical',
        file_path: file.path,
        affected_area: 'security',
        recommendation: 'Use parameterized queries or an ORM. Never interpolate user input into SQL strings.'
      }));
    }

    // ── Worker without heartbeat or crash handling ────────────
    if (lowerPath.startsWith('workers/') && !/process\.on\s*\(\s*['"](unhandledRejection|uncaughtException)/.test(c)) {
      findings.push(finding({
        title: 'Worker missing process-level crash handlers',
        description: `${file.path} is a worker without unhandledRejection or uncaughtException handlers. Crashes will kill the worker silently.`,
        severity: 'high',
        file_path: file.path,
        affected_area: 'reliability',
        recommendation: 'Add process.on("unhandledRejection") and process.on("uncaughtException") handlers. Log crashes and gracefully exit so PM2 can restart.'
      }));
    }

    // ── Missing input validation on API routes ────────────────
    if (lowerPath.startsWith('api/') && /req\.body|req\.query/.test(c) && !/typeof|Array\.isArray|validate|zod|joi/.test(c)) {
      findings.push(finding({
        title: 'API route may lack input validation',
        description: `${file.path} reads request data without visible type checking or validation.`,
        severity: 'medium',
        file_path: file.path,
        affected_area: 'api',
        recommendation: 'Validate all request inputs with a schema validator (Zod, Joi) or manual type checks. Reject malformed data early.'
      }));
    }

    // ── File truncation warning ───────────────────────────────
    if (file.truncated) {
      findings.push(finding({
        title: 'Large file truncated during scan',
        description: `${file.path} exceeded max file size (${file.size_chars} chars). Full content was not reviewed.`,
        severity: 'low',
        file_path: file.path,
        affected_area: 'debug_crawler',
        recommendation: 'Increase DEBUG_CRAWLER_MAX_FILE_CHARS or split large files into smaller modules.',
        metadata: { size_chars: file.size_chars }
      }));
    }
  }

  return dedupeFindings(findings);
}

export function dedupeFindings(findings) {
  const map = new Map();
  for (const f of findings) map.set(f.fingerprint, f);
  return Array.from(map.values());
}
