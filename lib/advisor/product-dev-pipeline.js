// ============================================================
// Product Dev Pipeline — xsjprd55
// Stores development tasks generated from approved proposals.
// When user clicks "Proceed Development", a task is created
// and the coding agent can pick it up automatically.
// ============================================================

import { db } from '../ml/db.js';
import { logger } from '../logger.js';
import { logTaskCompletionAsUpdate } from './product-update-log.js';

/* ── Schema helpers ───────────────────────────────────────── */

export function initDevPipelineTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS development_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      assigned_to TEXT NOT NULL DEFAULT 'coding_agent',
      files_to_modify TEXT NOT NULL DEFAULT '[]',
      implementation_notes TEXT,
      estimated_effort TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      result_summary TEXT,
      commit_hash TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_dev_tasks_status ON development_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_dev_tasks_proposal ON development_tasks(proposal_id);
    CREATE INDEX IF NOT EXISTS idx_dev_tasks_created ON development_tasks(created_at);

    CREATE TABLE IF NOT EXISTS dev_pipeline_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      action_type TEXT NOT NULL,
      description TEXT,
      performed_by TEXT,
      performed_at TEXT NOT NULL,
      result TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_dev_actions_task ON dev_pipeline_actions(task_id);
  `);
}

/* ── Task CRUD ────────────────────────────────────────────── */

export function createDevelopmentTask({ proposalId, title, description, priority = 'medium', filesToModify = [], estimatedEffort = 'medium', tags = [], metadata = {} }) {
  initDevPipelineTables();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO development_tasks
      (proposal_id, title, description, status, priority, assigned_to, files_to_modify, estimated_effort, created_at, tags, metadata_json)
    VALUES (?, ?, ?, 'pending', ?, 'coding_agent', ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    proposalId || null,
    title,
    description || '',
    priority,
    JSON.stringify(filesToModify),
    estimatedEffort,
    now,
    JSON.stringify(tags),
    JSON.stringify(metadata)
  );

  const task = {
    id: result.lastInsertRowid,
    proposalId,
    title,
    description,
    status: 'pending',
    priority,
    assignedTo: 'coding_agent',
    filesToModify,
    estimatedEffort,
    createdAt: now,
    tags,
    metadata
  };

  logPipelineAction(task.id, 'task_created', `Task created from proposal #${proposalId || 'manual'}: ${title}`, 'product_agent');
  logger.info(`[DEV-PIPELINE] Created task #${task.id}: ${title}`);
  return task;
}

export function listDevelopmentTasks({ status, limit = 50 } = {}) {
  initDevPipelineTables();
  let sql = `SELECT * FROM development_tasks`;
  const params = [];
  if (status) {
    sql += ` WHERE status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return rows.map(r => ({
    id: r.id,
    proposalId: r.proposal_id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    assignedTo: r.assigned_to,
    filesToModify: JSON.parse(r.files_to_modify || '[]'),
    implementationNotes: r.implementation_notes,
    estimatedEffort: r.estimated_effort,
    createdAt: r.created_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    resultSummary: r.result_summary,
    commitHash: r.commit_hash,
    tags: JSON.parse(r.tags || '[]'),
    metadata: JSON.parse(r.metadata_json || '{}')
  }));
}

export function getTaskStats() {
  initDevPipelineTables();
  const rows = db.prepare(`SELECT status, COUNT(*) as c FROM development_tasks GROUP BY status`).all();
  const stats = { total: 0, pending: 0, in_progress: 0, completed: 0, failed: 0 };
  for (const r of rows) {
    stats[r.status] = r.c;
    stats.total += r.c;
  }
  return stats;
}

export function updateTaskStatus(id, status, notes = '') {
  initDevPipelineTables();
  const now = new Date().toISOString();
  const extra = { updated_at: now };
  if (status === 'in_progress') extra.started_at = now;
  if (status === 'completed' || status === 'failed') extra.completed_at = now;
  if (notes) extra.result_summary = notes;

  const sets = ['status = ?'];
  const vals = [status];
  if (extra.started_at) { sets.push('started_at = ?'); vals.push(extra.started_at); }
  if (extra.completed_at) { sets.push('completed_at = ?'); vals.push(extra.completed_at); }
  if (extra.result_summary) { sets.push('result_summary = ?'); vals.push(extra.result_summary); }
  vals.push(id);

  db.prepare(`UPDATE development_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  logPipelineAction(id, 'status_changed', `Status changed to ${status}${notes ? ': ' + notes : ''}`, 'coding_agent');
}

export function getTaskActions(taskId) {
  initDevPipelineTables();
  return db.prepare(`SELECT * FROM dev_pipeline_actions WHERE task_id = ? ORDER BY performed_at DESC`).all(taskId);
}

/* ── Pipeline Actions ─────────────────────────────────────── */

export function logPipelineAction(taskId, actionType, description, performedBy = 'system', result = '') {
  initDevPipelineTables();
  db.prepare(`
    INSERT INTO dev_pipeline_actions (task_id, action_type, description, performed_by, performed_at, result)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(taskId, actionType, description, performedBy, new Date().toISOString(), result);
}

/* ── Proceed Development Flow ─────────────────────────────── */

export function proceedWithDevelopment(proposalId, opts = {}) {
  initDevPipelineTables();
  const { title, description, category, capabilityArea, impactScore, effortEstimate, tags } = opts;

  // Derive likely files to modify based on category
  const filesToModify = inferFilesFromCategory(category, capabilityArea);

  const task = createDevelopmentTask({
    proposalId,
    title: title || `Implement proposal #${proposalId}`,
    description: description || 'Development task created from approved proposal.',
    priority: impactScore >= 0.9 ? 'high' : impactScore >= 0.7 ? 'medium' : 'low',
    filesToModify,
    estimatedEffort: effortEstimate || 'medium',
    tags: tags || [],
    metadata: { source: 'proposal', proposalId, category, capabilityArea, impactScore }
  });

  return task;
}

function inferFilesFromCategory(category, capabilityArea) {
  const map = {
    'ui': ['public/index.html', 'public/styles.css'],
    'infra': ['ecosystem.config.cjs', 'docker-compose.yml', 'server.js'],
    'strategy': ['lib/ml/strategies.js', 'lib/ml/dynamicStrategies.js', 'api/signals.js'],
    'feature': ['api/signals.js', 'lib/config.js'],
    'ml': ['lib/ml/', 'ml-service/'],
    'risk': ['lib/trading.js', 'lib/perpetual-trader/risk.js'],
    'data-source': ['lib/news-aggregator.js', 'lib/social-crawler.js'],
    'realtime': ['server.js', 'public/index.html'],
    'monitoring': ['workers/diagnostic-worker.js', 'api/health.js'],
    'notifications': ['lib/notification-engine.js', 'api/telegram.js'],
    'exchange-integration': ['lib/exchange.js'],
    'on-chain': ['lib/'],
    'trading-gate': ['lib/trading.js'],
    'position-sizing': ['lib/mock-trading/mock-account-engine.js', 'lib/perpetual-trader/risk.js'],
    'self-improvement': ['lib/advisor/'],
    'meta': ['lib/advisor/']
  };
  return map[category] || map[capabilityArea] || ['lib/', 'api/', 'workers/'];
}

/* ── Coding Agent Integration ─────────────────────────────── */

export function getNextPendingTask() {
  initDevPipelineTables();
  const row = db.prepare(`
    SELECT * FROM development_tasks WHERE status = 'pending' ORDER BY 
      CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      created_at ASC
    LIMIT 1
  `).get();
  if (!row) return null;
  return {
    id: row.id,
    proposalId: row.proposal_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    filesToModify: JSON.parse(row.files_to_modify || '[]'),
    estimatedEffort: row.estimated_effort,
    createdAt: row.created_at,
    tags: JSON.parse(row.tags || '[]'),
    metadata: JSON.parse(row.metadata_json || '{}')
  };
}

export function markTaskInProgress(taskId) {
  updateTaskStatus(taskId, 'in_progress', 'Coding agent picked up the task');
}

export function markTaskCompleted(taskId, commitHash, summary) {
  initDevPipelineTables();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE development_tasks
    SET status = 'completed', completed_at = ?, commit_hash = ?, result_summary = ?
    WHERE id = ?
  `).run(now, commitHash || '', summary || '', taskId);
  logPipelineAction(taskId, 'task_completed', `Task completed. Commit: ${commitHash || 'N/A'}`, 'coding_agent', summary);

  // Auto-log to product update changelog
  try {
    const row = db.prepare('SELECT * FROM development_tasks WHERE id = ?').get(taskId);
    if (row) {
      const task = {
        id: row.id,
        proposalId: row.proposal_id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        assignedTo: row.assigned_to,
        filesToModify: JSON.parse(row.files_to_modify || '[]'),
        estimatedEffort: row.estimated_effort,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        resultSummary: row.result_summary,
        commitHash: row.commit_hash,
        tags: JSON.parse(row.tags || '[]'),
        metadata: JSON.parse(row.metadata_json || '{}')
      };
      logTaskCompletionAsUpdate(task);
    }
  } catch (e) {
    logger.warn('[DEV-PIPELINE] Failed to auto-log update:', e.message);
  }
}
