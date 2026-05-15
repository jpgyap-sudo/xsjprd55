// ============================================================
// SQLite Migration Runner — xsjprd55
// Applies versioned SQL migration files to the local SQLite DB.
// Tracks applied migrations in a `_migrations` table.
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Run all pending migrations against the given SQLite database instance.
 * Migrations are discovered from .sql files in this directory, sorted by
 * filename (e.g., 001_*.sql, 002_*.sql).
 *
 * @param {import('better-sqlite3').Database} db - The SQLite database instance
 * @param {object} [opts]
 * @param {boolean} [opts.silent=false] - Suppress log output
 * @returns {{ applied: number, total: number, errors: string[] }}
 */
export function runMigrations(db, opts = {}) {
  const errors = [];

  if (!db) {
    return { applied: 0, total: 0, errors: ['Database instance is null'] };
  }

  // Ensure the migrations tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      checksum TEXT
    );
  `);

  // Discover migration files
  let files;
  try {
    files = fs.readdirSync(__dirname)
      .filter(f => /^\d{3}_.+\.sql$/.test(f))
      .sort();
  } catch (e) {
    return { applied: 0, total: 0, errors: [`Failed to read migrations directory: ${e.message}`] };
  }

  if (files.length === 0) {
    if (!opts.silent) {
      console.log('[MIGRATIONS] No migration files found');
    }
    return { applied: 0, total: 0, errors: [] };
  }

  // Get already-applied migrations
  const applied = new Set();
  try {
    const rows = db.prepare('SELECT filename FROM _migrations').all();
    for (const row of rows) {
      applied.add(row.filename);
    }
  } catch (e) {
    errors.push(`Failed to read _migrations table: ${e.message}`);
    return { applied: 0, total: files.length, errors };
  }

  const pending = files.filter(f => !applied.has(f));

  if (pending.length === 0) {
    if (!opts.silent) {
      console.log(`[MIGRATIONS] All ${files.length} migrations already applied`);
    }
    return { applied: 0, total: files.length, errors: [] };
  }

  if (!opts.silent) {
    console.log(`[MIGRATIONS] ${pending.length} pending migration(s) out of ${files.length} total`);
  }

  // Apply each pending migration in a transaction
  for (const file of pending) {
    const filePath = path.join(__dirname, file);
    let sql;
    try {
      sql = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      errors.push(`Failed to read ${file}: ${e.message}`);
      continue;
    }

    // Compute checksum for integrity verification
    const checksum = simpleHash(sql);

    try {
      db.transaction(() => {
        // Execute the migration SQL
        db.exec(sql);

        // Record the migration
        const name = file.replace(/\.sql$/, '');
        db.prepare(
          'INSERT INTO _migrations (name, filename, checksum) VALUES (?, ?, ?)'
        ).run(name, file, checksum);
      })();

      if (!opts.silent) {
        console.log(`[MIGRATIONS] Applied: ${file}`);
      }
    } catch (e) {
      const msg = `Failed to apply ${file}: ${e.message}`;
      errors.push(msg);
      if (!opts.silent) {
        console.error(`[MIGRATIONS] ${msg}`);
      }
      // Continue to next migration — don't block the entire chain
    }
  }

  return {
    applied: pending.length - errors.length,
    total: files.length,
    errors,
  };
}

/**
 * Get the list of applied migrations with metadata.
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{name: string, filename: string, applied_at: string, checksum: string}>}
 */
export function getAppliedMigrations(db) {
  try {
    return db.prepare('SELECT name, filename, applied_at, checksum FROM _migrations ORDER BY id').all();
  } catch {
    return [];
  }
}

/**
 * Simple non-cryptographic hash for migration file integrity.
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}
