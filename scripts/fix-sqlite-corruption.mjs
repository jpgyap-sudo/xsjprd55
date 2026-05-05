// ============================================================
// Fix SQLite database corruption
// Restores from backup or recreates the database
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const dbPath = path.join(root, 'data/ml-loop.sqlite');
const backupPath = dbPath + '.corrupt.1777763649.bak';

function cleanWalFiles() {
  for (const ext of ['-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ok */ }
  }
}

function tryOpenDb(filePath) {
  try {
    const db = new Database(filePath, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    db.close();
    return { ok: true, tables: tables.map(t => t.name) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function recreateDatabase() {
  console.log('Recreating database from scratch...');
  cleanWalFiles();
  try { fs.unlinkSync(dbPath); } catch (e) { /* ok */ }
  
  const db = new Database(dbPath);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      source_url TEXT,
      content TEXT NOT NULL,
      extracted_hints TEXT DEFAULT '[]',
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS strategy_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      rules TEXT DEFAULT '[]',
      confidence REAL DEFAULT 0,
      tested INTEGER DEFAULT 0,
      promoted INTEGER DEFAULT 0,
      rejected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS backtest_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      total_return_pct REAL DEFAULT 0,
      total_trades INTEGER DEFAULT 0,
      win_rate REAL DEFAULT 0,
      sharpe_ratio REAL DEFAULT 0,
      max_drawdown_pct REAL DEFAULT 0,
      profit_factor REAL DEFAULT 0,
      trade_log TEXT DEFAULT '[]',
      run_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS strategy_lifecycle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_name TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'researched',
      historical_backtest_score REAL DEFAULT 0,
      mock_trading_score REAL DEFAULT 0,
      approved_for_mock INTEGER DEFAULT 0,
      rejected_reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS mock_strategy_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_name TEXT NOT NULL UNIQUE,
      trades INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      total_pnl_usd REAL DEFAULT 0,
      max_drawdown_pct REAL DEFAULT 0,
      feedback_score REAL DEFAULT 0,
      promoted INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS signal_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      price REAL NOT NULL,
      signal_side TEXT NOT NULL,
      rule_probability REAL NOT NULL,
      ml_probability REAL,
      final_probability REAL,
      features TEXT DEFAULT '{}',
      rationale TEXT DEFAULT '{}',
      outcome_label INTEGER,
      outcome_return_pct REAL,
      outcome_checked_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS ml_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      version TEXT NOT NULL,
      feature_names TEXT DEFAULT '[]',
      model_data TEXT DEFAULT '{}',
      metrics TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
  `);
  
  db.close();
  console.log('Database recreated successfully');
}

async function main() {
  console.log('Checking main database...');
  const mainResult = tryOpenDb(dbPath);
  
  if (mainResult.ok) {
    console.log('Main database is healthy. Tables:', mainResult.tables.join(', '));
    cleanWalFiles();
    console.log('Cleaned WAL/SHM files');
    return;
  }
  
  console.log('Main database corrupt:', mainResult.error);
  
  // Try backup
  if (fs.existsSync(backupPath)) {
    console.log('Checking backup...');
    const backupResult = tryOpenDb(backupPath);
    
    if (backupResult.ok) {
      console.log('Backup is healthy. Restoring...');
      cleanWalFiles();
      fs.copyFileSync(backupPath, dbPath);
      console.log('Restored from backup successfully');
      return;
    }
    
    console.log('Backup also corrupt:', backupResult.error);
  }
  
  // Recreate from scratch
  recreateDatabase();
}

main().catch(console.error);
