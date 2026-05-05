// ============================================================
// ML Loop SQLite Database — xsjprd55
// Local DB for signal snapshots, models, and mock trading.
// Uses absolute path based on project root so workers + API
// share the same file regardless of cwd.
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Absolute path to project-root/data/ml-loop.sqlite
const dbPath = process.env.ML_DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'ml-loop.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

let db;
try {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  console.log(`[ML-DB] SQLite path: ${dbPath}`);
} catch (err) {
  console.error(`[ML-DB] Failed to open SQLite database at ${dbPath}: ${err.message}`);
  console.error(`[ML-DB] If the database is corrupted, delete the file and restart.`);
  // Export a stub that throws on any operation — callers must handle
  db = null;
}

export { db };

export function initMlDb() {
  if (!db) {
    console.error('[ML-DB] Cannot initialize — database is null (corrupted or inaccessible). Delete the file and restart.');
    return;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS signal_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      price REAL NOT NULL,
      signal_side TEXT NOT NULL,
      rule_probability REAL NOT NULL,
      ml_probability REAL,
      final_probability REAL,
      features_json TEXT NOT NULL,
      rationale_json TEXT NOT NULL,
      outcome_label INTEGER,
      outcome_return_pct REAL,
      outcome_checked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ml_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      model_name TEXT NOT NULL,
      version TEXT NOT NULL,
      feature_names_json TEXT NOT NULL,
      model_json TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS mock_strategy_stats (
      strategy_name TEXT PRIMARY KEY,
      trades INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      total_pnl_usd REAL NOT NULL DEFAULT 0,
      max_drawdown_pct REAL NOT NULL DEFAULT 0,
      score REAL NOT NULL DEFAULT 0,
      is_promoted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mock_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      symbol TEXT NOT NULL,
      strategy_name TEXT NOT NULL,
      side TEXT NOT NULL,
      entry_price REAL NOT NULL,
      size_usd REAL NOT NULL,
      leverage REAL NOT NULL,
      take_profit_pct REAL NOT NULL,
      stop_loss_pct REAL NOT NULL,
      status TEXT NOT NULL,
      exit_price REAL,
      pnl_usd REAL,
      pnl_pct REAL,
      rationale_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mock_account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      balance_usd REAL NOT NULL,
      peak_balance_usd REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO mock_account (id, balance_usd, peak_balance_usd, updated_at)
    VALUES (1, 1000000, 1000000, datetime('now'));

    CREATE TABLE IF NOT EXISTS research_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_url TEXT,
      content TEXT NOT NULL,
      extracted_hints_json TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS strategy_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      rules_json TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      tested INTEGER NOT NULL DEFAULT 0,
      promoted INTEGER NOT NULL DEFAULT 0,
      rejected INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS mock_strategy_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_name TEXT NOT NULL UNIQUE,
      trades INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      total_pnl_usd REAL NOT NULL DEFAULT 0,
      max_drawdown_pct REAL NOT NULL DEFAULT 0,
      feedback_score REAL NOT NULL DEFAULT 0,
      promoted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backtest_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT NOT NULL,
      strategy_name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      total_return_pct REAL NOT NULL DEFAULT 0,
      total_trades INTEGER NOT NULL DEFAULT 0,
      win_rate REAL NOT NULL DEFAULT 0,
      sharpe_ratio REAL NOT NULL DEFAULT 0,
      max_drawdown_pct REAL NOT NULL DEFAULT 0,
      profit_factor REAL NOT NULL DEFAULT 0,
      trade_log_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS strategy_lifecycle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER,
      strategy_name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'researched',
      historical_backtest_score REAL NOT NULL DEFAULT 0,
      mock_trading_score REAL NOT NULL DEFAULT 0,
      approved_for_mock INTEGER NOT NULL DEFAULT 0,
      rejected_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_signal_symbol_time ON signal_snapshots(symbol, created_at);
    CREATE INDEX IF NOT EXISTS idx_signal_outcome ON signal_snapshots(outcome_label);
    CREATE INDEX IF NOT EXISTS idx_backtest_strategy ON backtest_results(strategy_name, run_at);
    CREATE INDEX IF NOT EXISTS idx_lifecycle_status ON strategy_lifecycle(status);
  `);
}
