// ============================================================
// Diagnostic & Self-Healing Worker
// Autonomous test, debug, and repair loop for the trading bot.
// Monitors logs, detects errors, attempts fixes, and reports.
// Runs every 10 minutes on VPS.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { dedupSendIdea } from '../lib/agent-improvement-bus.js';
import { isMainModule } from '../lib/entrypoint.js';

const INTERVAL_MS = 10 * 60 * 1000;

// Recent error patterns to detect
const ERROR_PATTERNS = [
  { pattern: /supabase\.from.*select is not a function/i, severity: 'critical', fixHint: 'Check supabase.js client initialization' },
  { pattern: /HTTP 401|Unauthorized/i, severity: 'high', fixHint: 'Verify API key credentials in .env' },
  { pattern: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i, severity: 'high', fixHint: 'Network or DNS issue — check internet connectivity' },
  { pattern: /fapiPublicGetForceOrders is not a function/i, severity: 'medium', fixHint: 'CCXT implicit method deprecated — use direct fetch' },
  { pattern: /Cannot read properties of null/i, severity: 'medium', fixHint: 'Add null checks before accessing nested properties' },
  { pattern: /Playwright browser not installed/i, severity: 'medium', fixHint: 'Run: npx playwright install chromium' },
  { pattern: /worker.*failed to start/i, severity: 'high', fixHint: 'Check worker imports and dependencies' },
];

async function scanRecentLogs() {
  try {
    // Read last 100 log lines from file if available
    const fs = await import('fs');
    const path = await import('path');
    const logDir = config.LOG_DIR || './logs';
    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `app-${today}.log`);

    if (!fs.existsSync(logFile)) return [];

    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').slice(-200);
    return lines;
  } catch (e) {
    return [];
  }
}

function analyzeErrors(lines) {
  const findings = [];
  for (const line of lines) {
    for (const ep of ERROR_PATTERNS) {
      if (ep.pattern.test(line)) {
        findings.push({
          message: line.slice(0, 500),
          severity: ep.severity,
          fixHint: ep.fixHint,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
  return findings;
}

async function checkWorkerHealth() {
  const issues = [];

  // Check if any workers have been consistently erroring
  try {
    const { data: health } = await supabase
      .from('data_source_health')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    const failing = (health || []).filter(h => h.api_status !== 'online');
    if (failing.length >= 3) {
      issues.push({
        severity: 'high',
        message: `${failing.length} data sources failing consecutively`,
        fixHint: 'Verify API keys and network. Enable crawler fallback if needed.',
      });
    }
  } catch (e) {
    // ignore
  }

  return issues;
}

async function attemptSelfHeal(findings) {
  const actions = [];

  for (const f of findings) {
    if (f.message.includes('Playwright browser not installed')) {
      actions.push({ action: 'notify', message: 'Playwright browsers missing — run: npx playwright install chromium' });
    }
    if (f.message.includes('HTTP 401') && f.message.includes('binance')) {
      actions.push({ action: 'idea', sourceBot: 'Coding Bot', ideaType: 'Bug Fix', featureAffected: 'Binance API', observation: f.message, recommendation: f.fixHint, priority: 'High' });
    }
    if (f.severity === 'critical') {
      actions.push({ action: 'alert', message: `CRITICAL: ${f.message}` });
    }
  }

  return actions;
}

export async function runDiagnosticWorker() {
  logger.info('[DIAG-WORKER] Running diagnostic scan...');

  const lines = await scanRecentLogs();
  const findings = analyzeErrors(lines);
  const healthIssues = await checkWorkerHealth();
  const allIssues = [...findings, ...healthIssues];

  if (allIssues.length === 0) {
    logger.info('[DIAG-WORKER] No issues detected');
    return;
  }

  logger.warn(`[DIAG-WORKER] ${allIssues.length} issue(s) detected`);

  const actions = await attemptSelfHeal(allIssues);

  for (const action of actions) {
    if (action.action === 'idea') {
      await dedupSendIdea({
        sourceBot: action.sourceBot,
        ideaType: action.ideaType,
        featureAffected: action.featureAffected,
        observation: action.observation,
        recommendation: action.recommendation,
        priority: action.priority,
        confidence: 'High',
        status: 'New',
      });
    } else if (action.action === 'alert') {
      logger.error(`[DIAG-WORKER] ALERT: ${action.message}`);
    } else if (action.action === 'notify') {
      logger.info(`[DIAG-WORKER] NOTICE: ${action.message}`);
    }
  }

  // Always send a catch-all diagnostic idea if issues persist
  const criticalCount = allIssues.filter(i => i.severity === 'critical' || i.severity === 'high').length;
  if (criticalCount >= 2) {
    await dedupSendIdea({
      sourceBot: 'Coding Bot',
      ideaType: 'Bug Fix',
      featureAffected: 'System Health',
      observation: `Diagnostic worker detected ${criticalCount} critical/high severity issues in the last scan cycle.`,
      recommendation: 'Review recent logs, verify all API credentials, and check worker startup sequence for dependency errors.',
      expectedBenefit: 'Prevent cascading failures and maintain signal pipeline uptime.',
      priority: 'Critical',
      confidence: 'High',
      status: 'New',
    });
  }
}

if (isMainModule(import.meta.url)) {
  logger.info('[DIAG-WORKER] Starting loop...');
  await runDiagnosticWorker();
  setInterval(runDiagnosticWorker, INTERVAL_MS);
}
