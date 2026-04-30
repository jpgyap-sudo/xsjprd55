// ============================================================
// Bug Auto-Fix Pipeline — xsjprd55
// Scans critical/high bugs from Supabase, creates dev tasks
// in SQLite, and queues them for the coding agent to fix.
// ============================================================

import { supabase } from '../supabase.js';
import {
  createDevelopmentTask,
  updateTaskStatus,
  logPipelineAction,
  listDevelopmentTasks,
  initDevPipelineTables
} from './product-dev-pipeline.js';

// In-memory cache of recently processed bug fingerprints to avoid
// creating duplicate tasks within the same process lifetime
const _recentlyQueued = new Set();
const RECENT_WINDOW_MS = 3600000; // 1 hour

/**
 * Initialize bug-fix pipeline tables (extends dev pipeline)
 */
export function initBugFixPipelineTables() {
  initDevPipelineTables();
  // The bug-to-task linkage is stored in dev_pipeline_actions
  // with action_type = 'bug_fix_queued'
}

/**
 * Find un-fixed critical/high severity bugs and queue them as dev tasks.
 * Returns summary of actions taken.
 */
export async function runBugAutoFixCycle() {
  const results = {
    scanned: 0,
    queued: 0,
    skipped: 0,
    errors: [],
    tasksCreated: []
  };

  try {
    // Fetch critical and high severity bugs with status 'new' or 'investigating'
    const { data: bugs, error } = await supabase
      .from('bugs_to_fix')
      .select('*')
      .in('severity', ['critical', 'high'])
      .in('status', ['new', 'investigating'])
      .order('detected_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    results.scanned = bugs?.length || 0;
    if (!bugs?.length) return results;

    for (const bug of bugs) {
      const fingerprint = bug.fingerprint || `${bug.id}`;

      // Skip if recently processed (dedup within cycle)
      if (_recentlyQueued.has(fingerprint)) {
        results.skipped++;
        continue;
      }

      // Check if a dev task already exists for this bug
      const existing = findExistingBugTask(bug.id);
      if (existing) {
        results.skipped++;
        continue;
      }

      try {
        const task = await queueBugForFix(bug);
        results.queued++;
        results.tasksCreated.push({ bugId: bug.id, taskId: task.id, title: task.title });
        _recentlyQueued.add(fingerprint);
      } catch (err) {
        results.errors.push({ bugId: bug.id, error: err.message });
      }
    }

    // Clean old fingerprints from memory cache
    // (simplistic: clear all after each cycle since we check DB anyway)
    _recentlyQueued.clear();

    return results;
  } catch (e) {
    results.errors.push({ cycle: true, error: e.message });
    return results;
  }
}

/**
 * Create a development task for a single bug.
 */
export async function queueBugForFix(bug) {
  const files = inferFilesFromBug(bug);
  const priority = bug.severity === 'critical' ? 'high' : 'high';

  const task = createDevelopmentTask({
    proposalId: null, // bugs don't come from proposals
    title: `[BUG] ${bug.title}`,
    description: buildBugTaskDescription(bug),
    priority,
    filesToModify: files,
    estimatedEffort: bug.severity === 'critical' ? 'high' : 'medium',
    tags: ['bug-fix', 'auto-generated', bug.severity, bug.source_agent || 'debug_crawler'],
    metadata: {
      bug_id: bug.id,
      bug_fingerprint: bug.fingerprint,
      bug_severity: bug.severity,
      bug_source: bug.source_agent,
      auto_queued: true,
      detected_at: bug.detected_at
    }
  });

  // Link bug to task via pipeline action log
  logPipelineAction(task.id, 'bug_fix_queued', `Bug #${bug.id} auto-queued for fix. Severity: ${bug.severity}.`, 'debug_agent', `Task #${task.id} created.`);

  // Update bug status to 'queued_for_fix' in Supabase
  await supabase
    .from('bugs_to_fix')
    .update({ status: 'queued_for_fix', metadata: { ...bug.metadata, auto_fix_task_id: task.id } })
    .eq('id', bug.id);

  return task;
}

/**
 * Manually queue a specific bug for auto-fix (called from dashboard)
 */
export async function manualQueueBugForFix(bugId) {
  const { data: bug, error } = await supabase
    .from('bugs_to_fix')
    .select('*')
    .eq('id', bugId)
    .single();

  if (error) throw error;
  if (!bug) throw new Error('Bug not found');

  const existing = findExistingBugTask(bug.id);
  if (existing) {
    return { alreadyQueued: true, task: existing };
  }

  const task = await queueBugForFix(bug);
  return { alreadyQueued: false, task };
}

/**
 * Get list of bugs that are currently queued for auto-fix
 */
export async function getQueuedBugs(limit = 50) {
  const { data, error } = await supabase
    .from('bugs_to_fix')
    .select('*')
    .eq('status', 'queued_for_fix')
    .order('detected_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Get auto-fix pipeline stats
 */
export async function getBugFixPipelineStats() {
  const { count: criticalCount } = await supabase
    .from('bugs_to_fix')
    .select('*', { count: 'exact', head: true })
    .eq('severity', 'critical')
    .in('status', ['new', 'investigating']);

  const { count: highCount } = await supabase
    .from('bugs_to_fix')
    .select('*', { count: 'exact', head: true })
    .eq('severity', 'high')
    .in('status', ['new', 'investigating']);

  const { count: queuedCount } = await supabase
    .from('bugs_to_fix')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'queued_for_fix');

  const { count: fixedCount } = await supabase
    .from('bugs_to_fix')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'fixed');

  const tasks = listDevelopmentTasks({ status: undefined, limit: 200 })
    .filter(t => t.tags && t.tags.includes('bug-fix'));

  return {
    criticalPending: criticalCount ?? 0,
    highPending: highCount ?? 0,
    queued: queuedCount ?? 0,
    fixed: fixedCount ?? 0,
    activeTasks: tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length,
    completedTasks: tasks.filter(t => t.status === 'completed').length
  };
}

// ── Helpers ──────────────────────────────────────────────

function findExistingBugTask(bugId) {
  const tasks = listDevelopmentTasks({ status: undefined, limit: 200 });
  return tasks.find(t => {
    const meta = t.metadata || {};
    return meta.bug_id === bugId;
  });
}

function buildBugTaskDescription(bug) {
  return `Auto-generated bug fix task.

**Bug:** ${bug.title}
**Severity:** ${bug.severity}
**Source:** ${bug.source_agent || 'debug_crawler_agent'}
**Detected:** ${bug.detected_at || bug.created_at}
**File:** ${bug.file_path || 'unknown'}
**Affected Area:** ${bug.affected_area || 'unknown'}

**Description:**
${bug.description || 'No description provided.'}

**Recommendation:**
${bug.recommendation || 'Investigate and fix the root cause.'}

**Instructions for Coding Agent:**
1. Open the affected file(s).
2. Reproduce or understand the bug from the description.
3. Implement a minimal, safe fix.
4. Run any existing tests or sanity checks.
5. Update this task status when complete.
`;
}

function inferFilesFromBug(bug) {
  if (bug.file_path) return [bug.file_path];
  if (bug.affected_area) {
    const area = bug.affected_area.toLowerCase();
    if (area.includes('signal')) return ['lib/signal-engine.js', 'api/signals.js'];
    if (area.includes('mock') || area.includes('trade')) return ['lib/mock-trading/', 'workers/mock-trading-worker.js'];
    if (area.includes('perpetual')) return ['lib/perpetual-trader/', 'workers/perpetual-trader-worker.js'];
    if (area.includes('news')) return ['lib/news-store.js', 'workers/news-ingest-worker.js'];
    if (area.includes('ui') || area.includes('frontend') || area.includes('dashboard')) return ['public/index.html'];
    if (area.includes('api') || area.includes('endpoint')) return ['api/'];
    if (area.includes('research')) return ['lib/ml/', 'workers/research-agent-worker.js'];
    if (area.includes('risk')) return ['lib/risk.js', 'lib/perpetual-trader/risk.js'];
    if (area.includes('exchange')) return ['lib/exchange.js'];
  }
  return ['public/index.html', 'lib/'];
}
