// ============================================================
// Product Update Log — xsjprd55
// SQLite-backed changelog for all coding changes and updates.
// Designed for high-volume daily updates.
// ============================================================

import { db } from '../ml/db.js';

export function initProductUpdateTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'feature',
      affected_files TEXT NOT NULL DEFAULT '[]',
      author TEXT NOT NULL DEFAULT 'coding_agent',
      created_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_pu_created ON product_updates(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pu_category ON product_updates(category);
    CREATE INDEX IF NOT EXISTS idx_pu_author ON product_updates(author);
  `);
}

export function addProductUpdate({
  version = '',
  title,
  description,
  category = 'feature',
  affectedFiles = [],
  author = 'coding_agent',
  tags = [],
  metadata = {}
}) {
  if (!title || !description) throw new Error('Title and description required');
  const stmt = db.prepare(`
    INSERT INTO product_updates (version, title, description, category, affected_files, author, created_at, tags, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    version,
    title,
    description,
    category,
    JSON.stringify(affectedFiles),
    author,
    new Date().toISOString(),
    JSON.stringify(tags),
    JSON.stringify(metadata)
  );
  return getProductUpdateById(Number(result.lastInsertRowid));
}

export function getProductUpdateById(id) {
  const row = db.prepare('SELECT * FROM product_updates WHERE id = ?').get(id);
  if (!row) return null;
  return normalizeRow(row);
}

export function listProductUpdates({ category, author, search, limit = 50, offset = 0 } = {}) {
  let sql = 'SELECT * FROM product_updates WHERE 1=1';
  const params = [];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (author) {
    sql += ' AND author = ?';
    params.push(author);
  }
  if (search) {
    sql += ' AND (title LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);
  return rows.map(normalizeRow);
}

export function countProductUpdates({ category, author, search } = {}) {
  let sql = 'SELECT COUNT(*) as count FROM product_updates WHERE 1=1';
  const params = [];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (author) {
    sql += ' AND author = ?';
    params.push(author);
  }
  if (search) {
    sql += ' AND (title LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const row = db.prepare(sql).get(...params);
  return row?.count || 0;
}

export function getUpdateStats() {
  const total = db.prepare("SELECT COUNT(*) as count FROM product_updates").get().count;
  const today = db.prepare(`
    SELECT COUNT(*) as count FROM product_updates
    WHERE created_at >= date('now', 'start of day')
  `).get().count;
  const thisWeek = db.prepare(`
    SELECT COUNT(*) as count FROM product_updates
    WHERE created_at >= date('now', '-7 days')
  `).get().count;

  const byCategory = db.prepare(`
    SELECT category, COUNT(*) as count FROM product_updates
    GROUP BY category ORDER BY count DESC
  `).all();

  return { total, today, thisWeek, byCategory };
}

export function deleteOldUpdates(days = 90) {
  const safeDays = Math.max(1, Math.floor(Number(days)));
  const result = db.prepare(`
    DELETE FROM product_updates WHERE created_at < date('now', '-${safeDays} days')
  `).run();
  return result.changes;
}

function normalizeRow(row) {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    description: row.description,
    category: row.category,
    affectedFiles: safeJsonParse(row.affected_files, []),
    author: row.author,
    createdAt: row.created_at,
    tags: safeJsonParse(row.tags, []),
    metadata: safeJsonParse(row.metadata_json, {})
  };
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ── Auto-logging helpers ──────────────────────────────────

/**
 * Auto-log a completed development task as a product update.
 * Called by markTaskCompleted() in product-dev-pipeline.js
 */
export function logTaskCompletionAsUpdate(task) {
  const category = inferCategoryFromTags(task.tags);
  const title = task.title.startsWith('[BUG]')
    ? `Fixed: ${task.title.replace('[BUG] ', '')}`
    : `Implemented: ${task.title}`;

  return addProductUpdate({
    version: task.commitHash || '',
    title,
    description: task.resultSummary || task.description || 'No details provided.',
    category,
    affectedFiles: task.filesToModify || [],
    author: task.assignedTo || 'coding_agent',
    tags: [...(task.tags || []), 'auto-logged', 'dev-pipeline'],
    metadata: {
      task_id: task.id,
      proposal_id: task.proposalId,
      started_at: task.startedAt,
      completed_at: task.completedAt
    }
  });
}

function inferCategoryFromTags(tags = []) {
  const t = tags.map(x => x.toLowerCase());
  if (t.includes('bug-fix')) return 'fix';
  if (t.includes('security')) return 'security';
  if (t.includes('refactor')) return 'refactor';
  if (t.includes('performance') || t.includes('optimization')) return 'improvement';
  return 'feature';
}

/**
 * Log a git commit as a product update.
 * Can be called from a git hook or deployment script.
 */
export function logGitCommitAsUpdate(commitHash, commitMessage, changedFiles = [], author = 'git') {
  const lines = commitMessage.split('\n');
  const title = lines[0].trim();
  const description = lines.slice(1).join('\n').trim() || title;
  const category = inferCategoryFromMessage(title);

  return addProductUpdate({
    version: commitHash,
    title,
    description,
    category,
    affectedFiles: changedFiles,
    author,
    tags: ['git-commit', 'deploy'],
    metadata: { commit_hash: commitHash }
  });
}

function inferCategoryFromMessage(msg) {
  const m = msg.toLowerCase();
  if (m.includes('fix') || m.includes('bug') || m.includes('patch')) return 'fix';
  if (m.includes('security') || m.includes('vuln')) return 'security';
  if (m.includes('refactor')) return 'refactor';
  if (m.includes('perf') || m.includes('optim')) return 'improvement';
  if (m.includes('test') || m.includes('docs')) return 'other';
  return 'feature';
}
