// ============================================================
// Bug Hunter Agent — Production-grade 24/7 bug detection
// Scans repo + crawls live site + monitors APIs + creates BugReports
// Safety: READ-ONLY — never edits code, never deploys
// ============================================================

import '../lib/env.js';
import { runDebugCrawlerCycle } from './debug-crawler-worker.js';
import { crawlAllRoutes, isPlaywrightAvailable } from '../lib/debug/live-site-crawler.js';
import { generateBugId, generateBugSignature, findDuplicateBug, isRateLimited } from '../lib/debug/bug-signature.js';
import { classifySeverity, getSeverityEmoji } from '../lib/debug/bug-severity.js';
import { assignBug, createFixTask } from '../lib/debug/bug-assignment.js';
import { submitFindingsToLocalDb } from '../lib/debug/bug-submitter.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/entrypoint.js';

// Configuration
const CONFIG = {
  ENABLED: process.env.BUG_HUNTER_ENABLED === 'true',
  BASE_URL: process.env.BUG_HUNTER_BASE_URL || 'https://bot.abcx124.xyz',
  INTERVAL_SECONDS: Number(process.env.BUG_HUNTER_INTERVAL_SECONDS || 900), // 15 min default
  TIMEOUT_MS: Number(process.env.BUG_HUNTER_TIMEOUT_MS || 15000),
  NOTIFY_TELEGRAM: process.env.BUG_HUNTER_NOTIFY_TELEGRAM === 'true',
  ASSIGN_CRITICAL: process.env.BUG_HUNTER_ASSIGN_CRITICAL === 'true',
  RATE_LIMIT_MINUTES: 60,
  MAX_BUGS_PER_CYCLE: 50
};

// State
let consecutiveErrors = 0;
let isRunning = false;
const persistentBugTracker = new Map(); // Track bugs across cycles

function log(...args) {
  console.log(`[BUG-HUNTER] ${new Date().toISOString()}`, ...args);
}

// ============================================================
// Persistent Bug Tracking
// ============================================================

/**
 * Track bug persistence across cycles
 * If a bug keeps occurring and isn't fixed, escalate it
 */
async function trackPersistentBug(bugReport) {
  const key = bugReport.signature;
  const now = Date.now();
  
  if (!persistentBugTracker.has(key)) {
    persistentBugTracker.set(key, {
      firstSeen: now,
      lastSeen: now,
      reportCount: 1,
      bugIds: [bugReport.bug_id],
      escalated: false
    });
    return { isPersistent: false, escalationLevel: 0 };
  }
  
  const tracking = persistentBugTracker.get(key);
  tracking.lastSeen = now;
  tracking.reportCount++;
  tracking.bugIds.push(bugReport.bug_id);
  
  // Calculate persistence metrics
  const ageHours = (now - tracking.firstSeen) / (1000 * 60 * 60);
  const reportsPerHour = tracking.reportCount / Math.max(ageHours, 0.5);
  
  // Determine escalation level
  let escalationLevel = 0;
  let isPersistent = false;
  
  // Level 1: Bug reported 3+ times over 2+ hours
  if (tracking.reportCount >= 3 && ageHours >= 2) {
    escalationLevel = 1;
    isPersistent = true;
  }
  
  // Level 2: Bug reported 5+ times over 6+ hours
  if (tracking.reportCount >= 5 && ageHours >= 6) {
    escalationLevel = 2;
    isPersistent = true;
  }
  
  // Level 3: Bug reported 10+ times over 24+ hours (critical)
  if (tracking.reportCount >= 10 && ageHours >= 24) {
    escalationLevel = 3;
    isPersistent = true;
  }
  
  // Auto-escalate severity if not already done
  if (isPersistent && !tracking.escalated) {
    tracking.escalated = true;
    await escalatePersistentBug(bugReport, tracking, escalationLevel);
  }
  
  return { isPersistent, escalationLevel, tracking };
}

/**
 * Escalate a persistent bug
 */
async function escalatePersistentBug(bugReport, tracking, level) {
  const escalationMessages = [
    `⚠️ PERSISTENT BUG (Level ${level}): This bug has been reported ${tracking.reportCount} times over ${Math.round((Date.now() - tracking.firstSeen) / (1000 * 60 * 60))} hours and has NOT been fixed.`,
    `🔴 CRITICAL PERSISTENT BUG (Level ${level}): This issue is STILL UNRESOLVED after ${tracking.reportCount} reports. Immediate attention required!`,
    `🚨 ESCALATED TO CRITICAL: Bug ${bugReport.bug_id} has persisted for ${Math.round((Date.now() - tracking.firstSeen) / (1000 * 60 * 60))} hours with ${tracking.reportCount} occurrences. Manual intervention required!`
  ];
  
  const message = escalationMessages[Math.min(level - 1, escalationMessages.length - 1)];
  
  log(`ESCALATION: ${message}`);
  
  // Update bug report with escalation info
  bugReport.escalation = {
    level,
    reportCount: tracking.reportCount,
    firstSeen: new Date(tracking.firstSeen).toISOString(),
    hoursOpen: Math.round((Date.now() - tracking.firstSeen) / (1000 * 60 * 60)),
    message
  };
  
  // Increase severity for persistent bugs
  if (level >= 2 && bugReport.severity !== 'critical') {
    const oldSeverity = bugReport.severity;
    bugReport.severity = level === 3 ? 'critical' : 'high';
    bugReport.title = `[ESCALATED] ${bugReport.title}`;
    log(`Severity upgraded: ${oldSeverity} → ${bugReport.severity}`);
  }
  
  // Send urgent notification for high-level escalations
  if (level >= 2) {
    await notifyEscalation(bugReport, tracking, level);
  }
}

/**
 * Send escalation notification
 */
async function notifyEscalation(bugReport, tracking, level) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  
  if (!token || !chatId) return;
  
  const emoji = level === 3 ? '🚨' : level === 2 ? '🔴' : '⚠️';
  const message = `${emoji} *BUG ESCALATION - Level ${level}*

*${bugReport.title}*

This bug has persisted for *${Math.round((Date.now() - tracking.firstSeen) / (1000 * 60 * 60))} hours* with *${tracking.reportCount}* occurrences.

Route: \`${bugReport.route}\`
Severity: ${bugReport.severity.toUpperCase()}
Owner: ${bugReport.recommended_owner}

*Action Required:* This issue is NOT being resolved. ${level >= 3 ? 'Manual intervention strongly recommended!' : 'Please prioritize this bug.'}

Bug IDs: ${tracking.bugIds.slice(-3).join(', ')}`;
  
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });
  } catch (e) {
    logger.warn('[BUG-HUNTER] Escalation notification failed:', e.message);
  }
}

/**
 * Check if existing bugs in database are still present
 * This forms the debugging loop - tracking unresolved bugs
 */
async function checkUnresolvedBugs() {
  try {
    const { data: openBugs, error } = await supabase
      .from('bugs')
      .select('*')
      .in('status', ['new', 'assigned', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (error) throw error;
    if (!openBugs || openBugs.length === 0) return [];
    
    const stillPresent = [];
    
    for (const bug of openBugs) {
      // Skip bugs checked in last 30 minutes
      if (bug.last_checked_at) {
        const lastChecked = new Date(bug.last_checked_at).getTime();
        if (Date.now() - lastChecked < 30 * 60 * 1000) continue;
      }
      
      // Check if the bug is still present
      const isStillPresent = await verifyBugStillExists(bug);
      
      // Update last checked timestamp
      await supabase
        .from('bugs')
        .update({ last_checked_at: new Date().toISOString() })
        .eq('bug_id', bug.bug_id);
      
      if (isStillPresent) {
        stillPresent.push(bug);
        
        // Track as persistent
        const tracking = persistentBugTracker.get(bug.signature) || {
          firstSeen: new Date(bug.created_at).getTime(),
          lastSeen: Date.now(),
          reportCount: 1,
          bugIds: [bug.bug_id],
          escalated: false
        };
        
        tracking.lastSeen = Date.now();
        tracking.reportCount++;
        persistentBugTracker.set(bug.signature, tracking);
        
        // Escalate if needed
        const ageHours = (Date.now() - tracking.firstSeen) / (1000 * 60 * 60);
        if (tracking.reportCount >= 3 && ageHours >= 2 && !tracking.escalated) {
          const level = tracking.reportCount >= 10 ? 3 : tracking.reportCount >= 5 ? 2 : 1;
          await escalatePersistentBug(bug, tracking, level);
        }
      }
    }
    
    return stillPresent;
  } catch (e) {
    logger.error('[BUG-HUNTER] Failed to check unresolved bugs:', e.message);
    return [];
  }
}

/**
 * Verify if a bug still exists by re-checking the route
 */
async function verifyBugStillExists(bug) {
  try {
    // For API routes, do a quick health check
    if (bug.route && bug.route.startsWith('/api/')) {
      const url = `${CONFIG.BASE_URL}${bug.route}`;
      const response = await fetch(url, {
        method: 'HEAD',
        timeout: 5000
      });
      
      // If the original bug was a 500 and it's still 500, bug persists
      if (bug.evidence?.http_status === 500 && response.status === 500) {
        return true;
      }
      
      // If original was error but now OK, bug is resolved
      if (bug.evidence?.http_status >= 500 && response.status < 400) {
        return false;
      }
    }
    
    // For symptoms-based bugs, assume still present if recently reported
    const bugAge = Date.now() - new Date(bug.created_at).getTime();
    if (bugAge < 60 * 60 * 1000) return true; // Assume present if < 1 hour old
    
    return true; // Default to assuming present
  } catch (e) {
    // If we can't reach the endpoint, the bug might be worse
    return true;
  }
}

// Cleanup old entries from tracker every hour
setInterval(() => {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000; // 48 hours
  for (const [key, tracking] of persistentBugTracker.entries()) {
    if (tracking.lastSeen < cutoff) {
      persistentBugTracker.delete(key);
    }
  }
}, 60 * 60 * 1000);

// ============================================================
// Bug Report Creation
// ============================================================

function createBugReport(crawlResult, source = 'live_site') {
  const severity = classifySeverity({
    route: crawlResult.route,
    symptoms: crawlResult.symptoms,
    evidence: crawlResult.evidence,
    httpStatus: crawlResult.http_status
  });
  
  const assignment = assignBug({
    route: crawlResult.route,
    title: generateBugTitle(crawlResult),
    symptoms: crawlResult.symptoms,
    severity
  });
  
  const bugReport = {
    bug_id: generateBugId(),
    detected_by: 'BugHunterAgent',
    timestamp: new Date().toISOString(),
    severity,
    status: 'new',
    route: crawlResult.route,
    title: generateBugTitle(crawlResult),
    description: generateBugDescription(crawlResult),
    symptoms: crawlResult.symptoms,
    evidence: {
      http_status: crawlResult.http_status,
      response_ms: crawlResult.response_ms,
      console_errors: crawlResult.console_errors || [],
      api_errors: crawlResult.api_errors || [],
      logs: [],
      screenshot_path: crawlResult.evidence?.screenshot_path || null,
      ...crawlResult.evidence
    },
    suspected_root_cause: guessRootCause(crawlResult),
    affected_files_guess: assignment.affected_files || [],
    recommended_owner: assignment.recommended_owner,
    recommended_next_action: assignment.recommended_next_action,
    source,
    signature: generateBugSignature({
      route: crawlResult.route,
      title: generateBugTitle(crawlResult),
      errorMessage: crawlResult.evidence?.error_message,
      httpStatus: crawlResult.http_status
    })
  };
  
  return bugReport;
}

function generateBugTitle(crawlResult) {
  const { route, symptoms, http_status, name } = crawlResult;
  
  if (symptoms.includes('500_server_error')) {
    return `500 Error on ${name || route}`;
  }
  if (symptoms.includes('404_not_found')) {
    return `404 Not Found: ${route}`;
  }
  if (symptoms.includes('hydration_error')) {
    return `React Hydration Error on ${name || route}`;
  }
  if (symptoms.includes('ssr_error')) {
    return `SSR Error on ${name || route}`;
  }
  if (symptoms.includes('timeout')) {
    return `Timeout on ${name || route}`;
  }
  if (symptoms.includes('console_errors')) {
    return `Console Errors on ${name || route}`;
  }
  if (symptoms.includes('trader_inactive')) {
    return `Mock Trader Inactive — No Trading Activity`;
  }
  if (symptoms.includes('signal_generation_failed')) {
    return `Signal Generation Failure — No Active Signals`;
  }
  if (symptoms.includes('stale_data')) {
    return `Stale Data on ${name || route}`;
  }
  if (symptoms.includes('api_failure')) {
    return `API Failure on ${name || route}`;
  }
  
  return `Issue detected on ${name || route}`;
}

function generateBugDescription(crawlResult) {
  const parts = [
    `Bug detected on route: ${crawlResult.route}`,
    `Type: ${crawlResult.type}`,
    `URL: ${crawlResult.url}`,
  ];
  
  if (crawlResult.http_status) {
    parts.push(`HTTP Status: ${crawlResult.http_status}`);
  }
  
  if (crawlResult.response_ms) {
    parts.push(`Response Time: ${crawlResult.response_ms}ms`);
  }
  
  if (crawlResult.symptoms?.length > 0) {
    parts.push(`\nSymptoms:`, ...crawlResult.symptoms.map(s => `  - ${s}`));
  }
  
  if (crawlResult.console_errors?.length > 0) {
    parts.push(`\nConsole Errors:`, ...crawlResult.console_errors.slice(0, 5).map(e => `  - ${e.text?.slice(0, 100)}`));
  }
  
  if (crawlResult.api_errors?.length > 0) {
    parts.push(`\nAPI Errors:`, ...crawlResult.api_errors.slice(0, 3));
  }
  
  return parts.join('\n');
}

function guessRootCause(crawlResult) {
  const { symptoms, route } = crawlResult;
  
  if (symptoms.includes('hydration_error')) {
    return 'Mismatch between server-rendered HTML and client-side React. Check for dynamic data differences or window/document usage during SSR.';
  }
  if (symptoms.includes('ssr_error')) {
    return 'Server-side rendering failure. Check API routes for unhandled exceptions or database connection issues.';
  }
  if (symptoms.includes('500_server_error')) {
    return 'Internal server error. Check server logs for stack traces and unhandled exceptions.';
  }
  if (symptoms.includes('trader_inactive')) {
    return 'Execution worker may be stopped, Supabase tables may be missing, or trading config may be disabled.';
  }
  if (symptoms.includes('signal_generation_failed')) {
    return 'Signal generation cron may not be running, or strategy conditions not being met.';
  }
  if (symptoms.includes('timeout')) {
    return 'Request timeout. Check for slow database queries, external API delays, or infinite loops.';
  }
  if (symptoms.includes('stale_data')) {
    return 'Data not being updated. Check worker processes, database connections, or cache invalidation.';
  }
  
  return 'Unknown root cause. Requires investigation of logs and recent changes.';
}

// ============================================================
// Deduplication & Rate Limiting
// ============================================================

async function getRecentBugs(minutes = 60) {
  try {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('bugs')
      .select('bug_id, signature, route, title, created_at, severity')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  } catch (e) {
    logger.warn('[BUG-HUNTER] Failed to fetch recent bugs:', e.message);
    return [];
  }
}

async function isDuplicateOrRateLimited(bugReport) {
  const recentBugs = await getRecentBugs(CONFIG.RATE_LIMIT_MINUTES);
  
  // Check for exact duplicate
  const duplicate = findDuplicateBug(bugReport, recentBugs);
  if (duplicate) {
    return { isDuplicate: true, duplicateOf: duplicate };
  }
  
  // Check rate limiting
  if (isRateLimited(bugReport, recentBugs, CONFIG.RATE_LIMIT_MINUTES)) {
    return { isRateLimited: true };
  }
  
  return { isDuplicate: false, isRateLimited: false };
}

// ============================================================
// Submission & Notifications
// ============================================================

async function submitBugReport(bugReport) {
  try {
    // Submit to Supabase
    const { data, error } = await supabase
      .from('bugs')
      .insert({
        ...bugReport,
        created_at: bugReport.timestamp,
        updated_at: bugReport.timestamp
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // Auto-assign critical/high bugs if enabled
    if (CONFIG.ASSIGN_CRITICAL && (bugReport.severity === 'critical' || bugReport.severity === 'high')) {
      await autoAssignBug(data);
    }
    
    // Send Telegram notification
    if (CONFIG.NOTIFY_TELEGRAM) {
      await notifyTelegram(bugReport);
    }
    
    return { success: true, bugId: data.bug_id };
  } catch (e) {
    logger.error('[BUG-HUNTER] Failed to submit bug:', e.message);
    return { success: false, error: e.message };
  }
}

async function autoAssignBug(bug) {
  try {
    const task = createFixTask(bug);
    
    const { error } = await supabase
      .from('bug_fix_tasks')
      .insert(task);
    
    if (error) throw error;
    
    log(`Auto-assigned bug ${bug.bug_id} to ${task.assigned_to}`);
  } catch (e) {
    logger.error('[BUG-HUNTER] Failed to auto-assign bug:', e.message);
  }
}

async function notifyTelegram(bug) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  
  if (!token || !chatId) return;
  
  const emoji = getSeverityEmoji(bug.severity);
  const message = `${emoji} *Bug Hunter Alert*

*${bug.title}*
Severity: ${bug.severity.toUpperCase()}
Route: \`${bug.route}\`
Owner: ${bug.recommended_owner}

${bug.description.slice(0, 300)}...

ID: \`${bug.bug_id}\``;
  
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });
  } catch (e) {
    logger.warn('[BUG-HUNTER] Telegram notification failed:', e.message);
  }
}

// ============================================================
// Main Bug Hunter Cycle
// ============================================================

async function runBugHunterCycle() {
  if (isRunning) {
    log('Cycle already running, skipping');
    return;
  }
  
  isRunning = true;
  const startTime = Date.now();
  const stats = {
    scanned: 0,
    issuesFound: 0,
    bugsSubmitted: 0,
    duplicatesSkipped: 0,
    rateLimited: 0
  };
  
  log('='.repeat(60));
  log('BUG HUNTER CYCLE STARTED');
  log('='.repeat(60));
  
  try {
    // 1. Run existing debug crawler (repo scan)
    log('\n[1/3] Running repo scan...');
    const repoResult = await runDebugCrawlerCycle();
    stats.scanned += repoResult.files_scanned || 0;
    
    // Convert debug crawler findings to bug reports
    for (const finding of repoResult.findings || []) {
      if (stats.bugsSubmitted >= CONFIG.MAX_BUGS_PER_CYCLE) break;
      
      const bugReport = {
        bug_id: generateBugId(),
        detected_by: 'BugHunterAgent',
        timestamp: new Date().toISOString(),
        severity: finding.severity,
        status: 'new',
        route: finding.file_path || 'repo_scan',
        title: finding.title,
        description: finding.description,
        symptoms: ['static_analysis_finding'],
        evidence: {
          file_path: finding.file_path,
          affected_area: finding.affected_area,
          ...finding.metadata
        },
        suspected_root_cause: finding.affected_area,
        affected_files_guess: [finding.file_path].filter(Boolean),
        recommended_owner: finding.severity === 'critical' || finding.severity === 'high' ? 'SWE-agent' : 'DebuggerAgent',
        recommended_next_action: finding.recommendation,
        source: 'repo_scan',
        signature: finding.fingerprint || generateBugSignature({
          route: finding.file_path,
          title: finding.title
        })
      };
      
      const { isDuplicate, isRateLimited } = await isDuplicateOrRateLimited(bugReport);
      
      if (isDuplicate) {
        stats.duplicatesSkipped++;
        continue;
      }
      if (isRateLimited) {
        stats.rateLimited++;
        continue;
      }
      
      const submitResult = await submitBugReport(bugReport);
      if (submitResult.success) {
        stats.bugsSubmitted++;
      }
    }
    
    // 2. Crawl live site
    log('\n[2/3] Crawling live site...');
    const playwrightAvailable = await isPlaywrightAvailable();
    const crawlResults = await crawlAllRoutes(CONFIG.BASE_URL, {
      usePlaywright: playwrightAvailable,
      timeout: CONFIG.TIMEOUT_MS,
      captureScreenshot: false
    });
    
    // Convert crawl results to bug reports
    for (const result of crawlResults) {
      if (stats.bugsSubmitted >= CONFIG.MAX_BUGS_PER_CYCLE) break;
      
      // Only create bugs for failed crawls or detected symptoms
      if (result.success && result.symptoms.length === 0) continue;
      
      stats.issuesFound++;
      
      const bugReport = createBugReport(result, 'live_site');
      
      const { isDuplicate, isRateLimited } = await isDuplicateOrRateLimited(bugReport);
      
      if (isDuplicate) {
        log(`Skipping duplicate bug: ${bugReport.title}`);
        stats.duplicatesSkipped++;
        continue;
      }
      if (isRateLimited) {
        stats.rateLimited++;
        continue;
      }
      
      const submitResult = await submitBugReport(bugReport);
      if (submitResult.success) {
        log(`Submitted bug: ${bugReport.title} (${bugReport.severity})`);
        stats.bugsSubmitted++;
      }
    }
    
    // 3. Reset error counter on success
    consecutiveErrors = 0;
    
  } catch (error) {
    consecutiveErrors++;
    logger.error('[BUG-HUNTER] Cycle failed:', error.message);
    
    // Alert on consecutive failures
    if (consecutiveErrors >= 3) {
      logger.error('[BUG-HUNTER] Multiple consecutive failures. Check configuration.');
    }
  } finally {
    isRunning = false;
  }
  
  const duration = Date.now() - startTime;
  
  log('\n' + '='.repeat(60));
  log('BUG HUNTER CYCLE COMPLETE');
  log('='.repeat(60));
  log(`Files scanned: ${stats.scanned}`);
  log(`Issues found: ${stats.issuesFound}`);
  log(`Bugs submitted: ${stats.bugsSubmitted}`);
  log(`Duplicates skipped: ${stats.duplicatesSkipped}`);
  log(`Rate limited: ${stats.rateLimited}`);
  log(`Duration: ${duration}ms`);
  log('='.repeat(60));
  
  return stats;
}

// ============================================================
// Main Loop
// ============================================================

async function main() {
  if (!CONFIG.ENABLED) {
    log('BUG_HUNTER_ENABLED is not set to true. Exiting.');
    log('To enable, set BUG_HUNTER_ENABLED=true in your .env');
    process.exit(0);
  }
  
  const once = process.argv.includes('--once');
  
  log('='.repeat(60));
  log('BUG HUNTER AGENT v1.0');
  log('='.repeat(60));
  log(`Base URL: ${CONFIG.BASE_URL}`);
  log(`Interval: ${CONFIG.INTERVAL_SECONDS}s (${(CONFIG.INTERVAL_SECONDS / 60).toFixed(1)} min)`);
  log(`Mode: ${once ? 'single run' : 'continuous'}`);
  log(`Telegram notifications: ${CONFIG.NOTIFY_TELEGRAM ? 'enabled' : 'disabled'}`);
  log(`Auto-assign critical: ${CONFIG.ASSIGN_CRITICAL ? 'enabled' : 'disabled'}`);
  log('='.repeat(60));
  
  if (once) {
    await runBugHunterCycle();
    process.exit(0);
  }
  
  // Run immediately, then on interval
  await runBugHunterCycle();
  
  log(`\nScheduling next run in ${CONFIG.INTERVAL_SECONDS}s...`);
  
  setInterval(async () => {
    await runBugHunterCycle();
    log(`\nScheduling next run in ${CONFIG.INTERVAL_SECONDS}s...`);
  }, CONFIG.INTERVAL_SECONDS * 1000);
}

if (isMainModule(import.meta.url)) {
  main().catch(e => {
    console.error('[BUG-HUNTER] Fatal error:', e);
    process.exit(1);
  });
}

export { runBugHunterCycle };
