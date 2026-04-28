// ============================================================
// Finding Normalizer — Deduplicates, sanitizes, and ranks
// findings from all debug crawler sources.
// ============================================================

import crypto from 'crypto';

export function normalizeFindings(findings = []) {
  const normalized = findings
    .filter(f => f && f.title)
    .map(f => {
      const severity = normalizeSeverity(f.severity);
      const filePath = f.file_path || 'unknown';
      const affected = f.affected_area || 'general';

      const fingerprint = f.fingerprint || crypto
        .createHash('sha256')
        .update([f.title, filePath, affected].join('|').toLowerCase())
        .digest('hex');

      return {
        source_agent: f.source_agent || 'debug_crawler_agent',
        title: String(f.title).slice(0, 180),
        description: String(f.description || '').slice(0, 1200),
        severity,
        priority: f.priority || severityToPriority(severity),
        status: f.status || 'new',
        file_path: filePath,
        affected_area: affected,
        recommendation: String(f.recommendation || '').slice(0, 1200),
        fingerprint,
        metadata: f.metadata || {}
      };
    });

  // Deduplicate by fingerprint
  const map = new Map();
  for (const f of normalized) map.set(f.fingerprint, f);
  return Array.from(map.values());
}

function normalizeSeverity(s) {
  if (['low', 'medium', 'high', 'critical'].includes(s)) return s;
  return 'medium';
}

function severityToPriority(s) {
  if (s === 'critical') return 1;
  if (s === 'high') return 2;
  if (s === 'medium') return 3;
  return 4;
}

export function countBySeverity(findings = []) {
  return {
    critical_count: findings.filter(f => f.severity === 'critical').length,
    high_count: findings.filter(f => f.severity === 'high').length,
    medium_count: findings.filter(f => f.severity === 'medium').length,
    low_count: findings.filter(f => f.severity === 'low').length
  };
}

/**
 * Rank findings by a composite score.
 * Higher score = more urgent.
 */
export function rankFindings(findings = []) {
  return [...findings].sort((a, b) => {
    const scoreA = (a.priority || 3) * 10 + (a.metadata?.neural_confidence || 0.5);
    const scoreB = (b.priority || 3) * 10 + (b.metadata?.neural_confidence || 0.5);
    return scoreA - scoreB;
  });
}
