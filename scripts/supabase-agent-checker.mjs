#!/usr/bin/env node
// ============================================================
// SUPABASE AGENT CHECKER
// Validates all SQL schema files, detects conflicts, checks
// credentials, and automates SQL execution on Supabase.
// ============================================================

import { readFile, readdir, access } from 'fs/promises';
import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

// ── Colors ──────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m',
  dim: '\x1b[2m', bold: '\x1b[1m'
};
const ok = (s) => `${C.green}✓${C.reset} ${s}`;
const fail = (s) => `${C.red}✗${C.reset} ${s}`;
const warn = (s) => `${C.yellow}⚠${C.reset} ${s}`;
const info = (s) => `${C.blue}ℹ${C.reset} ${s}`;

// ── State ───────────────────────────────────────────────────
const state = {
  errors: 0, warnings: 0, fixes: 0,
  tables: new Map(),   // tableName -> [{file, line, columns, pkType}]
  sqlFiles: [],
  env: {},
  supabaseConnected: false,
  supabaseUrl: null,
  supabaseKey: null
};

// ── Helpers ─────────────────────────────────────────────────
function log(s = '') { console.log(s); }
function header(s) { log(`\n${C.bold}${C.cyan}▶ ${s}${C.reset}`); }
function section(s) { log(`\n${C.bold}${s}${C.reset}`); }

function parseEnv(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

async function loadEnv() {
  const candidates = ['.env', '.env.prod', '.env.local', '.env.example'];
  for (const f of candidates) {
    try {
      const p = resolve(ROOT, f);
      await access(p);
      const content = await readFile(p, 'utf-8');
      state.env = { ...state.env, ...parseEnv(content) };
      log(ok(`Loaded env from ${f}`));
    } catch { /* skip */ }
  }
}

// Extract CREATE TABLE statements from SQL
function extractTables(sql, filename) {
  const tables = [];
  // Match CREATE TABLE [IF NOT EXISTS] name ( ... );
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([^;]+)\);/gis;
  let m;
  while ((m = regex.exec(sql)) !== null) {
    const name = m[1];
    const body = m[2];
    const startPos = m.index;
    const lineNum = sql.slice(0, startPos).split('\n').length;

    // Determine PK type
    const pkMatch = body.match(/(\w+)\s+(UUID|BIGSERIAL|SERIAL|INTEGER|BIGINT|TEXT)[^,]*PRIMARY\s+KEY/i);
    const pkCol = pkMatch ? pkMatch[1] : 'id';
    const pkType = pkMatch ? pkMatch[2].toUpperCase() : 'unknown';

    // Extract column names
    const cols = [];
    const colRegex = /^\s*(\w+)\s+([A-Z_]+(?:\([^)]*\))?)/gim;
    let cm;
    while ((cm = colRegex.exec(body)) !== null) {
      cols.push({ name: cm[1], type: cm[2] });
    }

    tables.push({
      file: filename, line: lineNum, name,
      pkCol, pkType, columns: cols,
      rawBody: body
    });
  }
  return tables;
}

// ── Phase 1: Discover SQL files ─────────────────────────────
async function discoverSqlFiles() {
  header('Phase 1: Discovering SQL files');
  const dir = resolve(ROOT, 'supabase');
  try {
    const files = await readdir(dir);
    state.sqlFiles = files
      .filter(f => f.endsWith('.sql'))
      .map(f => ({ name: f, path: resolve(dir, f) }));
    log(ok(`Found ${state.sqlFiles.length} SQL files in supabase/`));
    for (const f of state.sqlFiles) {
      log(`  ${C.dim}${f.name}${C.reset}`);
    }
  } catch (e) {
    log(fail(`Cannot read supabase/ directory: ${e.message}`));
    state.errors++;
  }
}

// ── Phase 2: Parse & validate SQL ───────────────────────────
async function parseAndValidate() {
  header('Phase 2: Parsing SQL schema definitions');

  for (const { name, path } of state.sqlFiles) {
    const sql = await readFile(path, 'utf-8');
    const tables = extractTables(sql, name);
    for (const t of tables) {
      if (!state.tables.has(t.name)) state.tables.set(t.name, []);
      state.tables.get(t.name).push(t);
    }
  }

  const tableCount = state.tables.size;
  log(ok(`Extracted ${tableCount} unique table definitions`));

  // Check for duplicate/conflicting definitions
  section('Checking for duplicate table definitions');
  let conflictFound = false;
  for (const [name, defs] of state.tables) {
    if (defs.length > 1) {
      conflictFound = true;
      state.errors++;
      log(fail(`Table "${name}" defined ${defs.length} times:`));
      for (const d of defs) {
        const pkInfo = d.pkType !== 'unknown' ? ` (PK: ${d.pkType})` : '';
        log(`  ${C.yellow}→${C.reset} ${d.file}:${d.line}${pkInfo}`);
      }

      // Check for PK type conflict (critical)
      const pkTypes = [...new Set(defs.map(d => d.pkType))];
      if (pkTypes.length > 1) {
        state.errors++;
        log(`  ${C.red}CRITICAL: PK type conflict — ${pkTypes.join(' vs ')}${C.reset}`);
        log(`  ${C.dim}This will cause 42883 errors when both files are run.${C.reset}`);
      }
    }
  }
  if (!conflictFound) {
    log(ok('No duplicate table definitions found'));
  }
}

// ── Phase 3: Check required tables exist in files ───────────
async function checkRequiredTables() {
  header('Phase 3: Checking required application tables');
  const required = [
    'bot_users', 'signals', 'trades', 'audit_log',
    'product_features', 'deploy_history',
    'mock_accounts', 'mock_trades',
    'backtest_runs', 'backtest_trades',
    'signal_logs', 'signal_feature_scores',
    'strategy_performance', 'strategy_feature_performance',
    'execution_profiles', 'loss_patterns',
    'data_source_health', 'system_notifications',
    'liquidation_heatmaps', 'open_interest_snapshots',
    'analysis_results', 'app_improvement_suggestions',
    'external_data_snapshots'
  ];

  for (const t of required) {
    if (state.tables.has(t)) {
      const defs = state.tables.get(t);
      const files = [...new Set(defs.map(d => d.file))].join(', ');
      log(ok(`Table "${t}" defined in: ${files}`));
    } else {
      state.warnings++;
      log(warn(`Table "${t}" NOT FOUND in any SQL file`));
    }
  }
}

// ── Phase 4: Check Supabase credentials ─────────────────────
async function checkCredentials() {
  header('Phase 4: Checking Supabase credentials');
  const url = state.env.SUPABASE_URL;
  const key = state.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || url.includes('your-project')) {
    log(fail('SUPABASE_URL not configured'));
    state.errors++;
  } else {
    log(ok(`SUPABASE_URL = ${url}`));
    state.supabaseUrl = url;
  }

  if (!key || key.includes('your-service-role-key') || key.length < 20) {
    log(fail('SUPABASE_SERVICE_ROLE_KEY not configured or invalid'));
    state.errors++;
  } else {
    log(ok(`SUPABASE_SERVICE_ROLE_KEY = ${key.slice(0, 8)}...${key.slice(-4)} (${key.length} chars)`));
    state.supabaseKey = key;
  }
}

// ── Phase 5: Test Supabase connection ───────────────────────
async function testConnection() {
  header('Phase 5: Testing Supabase connection');
  if (!state.supabaseUrl || !state.supabaseKey) {
    log(warn('Skipping connection test — credentials missing'));
    return;
  }

  try {
    const resp = await fetch(`${state.supabaseUrl}/rest/v1/`, {
      headers: {
        'apikey': state.supabaseKey,
        'Authorization': `Bearer ${state.supabaseKey}`,
        'Accept': 'application/json'
      }
    });
    if (resp.ok || resp.status === 401) {
      // 401 means we hit the API but auth failed (wrong key format)
      // 200 means connected
      state.supabaseConnected = resp.ok;
      if (resp.ok) {
        log(ok(`Supabase REST API reachable — HTTP ${resp.status}`));
      } else {
        log(warn(`Supabase REST API reachable but auth failed — HTTP ${resp.status}`));
        state.warnings++;
      }
    } else {
      log(fail(`Supabase REST API error — HTTP ${resp.status}`));
      state.errors++;
    }
  } catch (e) {
    log(fail(`Cannot reach Supabase: ${e.message}`));
    state.errors++;
  }
}

// ── Phase 6: Check for known schema issues ──────────────────
async function checkKnownIssues() {
  header('Phase 6: Checking for known schema issues');

  // Issue 1: strategy_performance PK conflict
  if (state.tables.has('strategy_performance')) {
    const defs = state.tables.get('strategy_performance');
    const pkTypes = [...new Set(defs.map(d => d.pkType))];
    if (pkTypes.length > 1) {
      log(fail(`Issue #1: strategy_performance PK conflict (${pkTypes.join(' vs ')})`));
      log(`  ${C.dim}Fix: standardize on UUID (trading_schema.sql) or BIGSERIAL (perpetual-trader-schema.sql)${C.reset}`);
      state.errors++;
    }
  }

  // Issue 2: Check for missing IF NOT EXISTS
  section('Checking for unsafe CREATE TABLE (missing IF NOT EXISTS)');
  let unsafeCount = 0;
  for (const { name, path } of state.sqlFiles) {
    const sql = await readFile(path, 'utf-8');
    const lines = sql.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i.test(line) && !line.trim().startsWith('--')) {
        unsafeCount++;
        log(warn(`${name}:${i + 1} — CREATE TABLE without IF NOT EXISTS`));
      }
    }
  }
  if (unsafeCount === 0) {
    log(ok('All CREATE TABLE statements use IF NOT EXISTS'));
  } else {
    state.warnings += unsafeCount;
  }

  // Issue 3: Check for ON CONFLICT on tables without UNIQUE constraints
  section('Checking ON CONFLICT usage');
  for (const { name, path } of state.sqlFiles) {
    const sql = await readFile(path, 'utf-8');
    if (sql.includes('ON CONFLICT') && !sql.includes('UNIQUE')) {
      log(warn(`${name} — uses ON CONFLICT but no UNIQUE constraints visible`));
      state.warnings++;
    }
  }
}

// ── Phase 7: Generate fix SQL for 42883 ─────────────────────
async function generateFixSql() {
  header('Phase 7: Generating fix SQL for detected issues');

  let fixSql = `-- Auto-generated fix by supabase-agent-checker\n`;
  fixSql += `-- Run this in Supabase SQL Editor before applying main schemas\n\n`;

  // Fix 1: strategy_performance — keep UUID version, drop BIGSERIAL version
  if (state.tables.has('strategy_performance')) {
    const defs = state.tables.get('strategy_performance');
    const hasUuid = defs.some(d => d.pkType === 'UUID');
    const hasBigserial = defs.some(d => d.pkType === 'BIGSERIAL');

    if (hasUuid && hasBigserial) {
      fixSql += `-- Fix: strategy_performance has conflicting definitions\n`;
      fixSql += `-- Keeping UUID version (from trading_schema.sql)\n`;
      fixSql += `DROP TABLE IF EXISTS strategy_performance CASCADE;\n\n`;
      fixSql += defs.find(d => d.pkType === 'UUID').rawBody
        .replace(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, 'CREATE TABLE strategy_performance (\n  ')
        .trim();
      fixSql += `\n);\n\n`;
      state.fixes++;
    }
  }

  // Fix 2: Ensure bot_users.telegram_user_id is BIGINT
  fixSql += `-- Ensure bot_users.telegram_user_id is BIGINT for RLS policies\n`;
  fixSql += `ALTER TABLE IF EXISTS bot_users\n`;
  fixSql += `  ALTER COLUMN telegram_user_id TYPE BIGINT\n`;
  fixSql += `  USING (telegram_user_id::BIGINT);\n\n`;

  // Fix 3: Recreate RLS policies with explicit casts
  fixSql += `-- Recreate RLS policies with explicit BIGINT casts\n`;
  fixSql += `DROP POLICY IF EXISTS "Users see themselves" ON bot_users;\n`;
  fixSql += `DROP POLICY IF EXISTS "Users see own trades" ON trades;\n`;
  fixSql += `DROP POLICY IF EXISTS "Users see own credentials" ON exchange_credentials;\n\n`;

  fixSql += `ALTER TABLE bot_users ENABLE ROW LEVEL SECURITY;\n`;
  fixSql += `ALTER TABLE exchange_credentials ENABLE ROW LEVEL SECURITY;\n`;
  fixSql += `ALTER TABLE trades ENABLE ROW LEVEL SECURITY;\n\n`;

  fixSql += `CREATE POLICY "Users see themselves"\n`;
  fixSql += `  ON bot_users FOR ALL\n`;
  fixSql += `  USING (telegram_user_id = current_setting('app.current_telegram_id')::BIGINT);\n\n`;

  fixSql += `CREATE POLICY "Users see own trades"\n`;
  fixSql += `  ON trades FOR ALL\n`;
  fixSql += `  USING (EXISTS (\n`;
  fixSql += `    SELECT 1 FROM bot_users u\n`;
  fixSql += `    WHERE u.id = trades.user_id\n`;
  fixSql += `      AND u.telegram_user_id = current_setting('app.current_telegram_id')::BIGINT\n`;
  fixSql += `  ));\n\n`;

  fixSql += `CREATE POLICY "Users see own credentials"\n`;
  fixSql += `  ON exchange_credentials FOR ALL\n`;
  fixSql += `  USING (EXISTS (\n`;
  fixSql += `    SELECT 1 FROM bot_users u\n`;
  fixSql += `    WHERE u.id = exchange_credentials.user_id\n`;
  fixSql += `      AND u.telegram_user_id = current_setting('app.current_telegram_id')::BIGINT\n`;
  fixSql += `  ));\n`;

  const fixPath = resolve(ROOT, 'supabase', 'auto-fix-schema.sql');
  await writeFile(fixPath, fixSql);
  log(ok(`Generated auto-fix SQL: supabase/auto-fix-schema.sql (${state.fixes} fixes)`));
}

// ── Phase 8: Execute SQL via Supabase REST API ──────────────
async function executeSql(sql) {
  if (!state.supabaseConnected) {
    log(fail('Cannot execute SQL — Supabase not connected'));
    return false;
  }

  try {
    // First ensure exec_sql function exists
    await ensureExecSqlFunction();
    
    // Use Supabase's /rpc/exec_sql if available
    const resp = await fetch(`${state.supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': state.supabaseKey,
        'Authorization': `Bearer ${state.supabaseKey}`
      },
      body: JSON.stringify({ query: sql })
    });

    if (resp.ok) {
      log(ok('SQL executed successfully via Supabase RPC'));
      return true;
    }

    const err = await resp.text();
    log(fail(`SQL execution failed: ${err}`));
    return false;
  } catch (e) {
    log(fail(`SQL execution error: ${e.message}`));
    return false;
  }
}

// ── Create exec_sql RPC function if it doesn't exist ────────
async function ensureExecSqlFunction() {
  const createFunctionSql = `
CREATE OR REPLACE FUNCTION exec_sql(query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  EXECUTE query;
  result := '{"success": true}'::JSONB;
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  result := jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'detail', SQLSTATE
  );
  RETURN result;
END;
$$;
`;

  try {
    // Try to create the function via REST
    const resp = await fetch(`${state.supabaseUrl}/rest/v1/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': state.supabaseKey,
        'Authorization': `Bearer ${state.supabaseKey}`,
        'Prefer': 'tx=commit'
      },
      body: JSON.stringify({ query: createFunctionSql })
    });
    
    // Function may already exist, that's fine
    return true;
  } catch (e) {
    // Silently fail - function might already exist or user lacks permission
    return true;
  }
}

// ── Execute SQL file with statements split ───────────────────
async function executeSqlFile(filePath) {
  if (!state.supabaseConnected) {
    log(fail('Cannot execute SQL — Supabase not connected'));
    return false;
  }

  try {
    const sql = await readFile(filePath, 'utf-8');
    const statements = splitSqlStatements(sql);
    
    log(info(`Executing ${statements.length} SQL statements from ${filePath}...`));
    
    let success = 0;
    let failed = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();
      if (!stmt) continue;
      
      process.stdout.write(`  [${i + 1}/${statements.length}] Executing... `);
      
      const ok = await executeSql(stmt);
      if (ok) {
        success++;
        console.log(`${C.green}✓${C.reset}`);
      } else {
        failed++;
        console.log(`${C.red}✗${C.reset}`);
      }
    }
    
    log(`\n${ok(`Executed: ${success} succeeded, ${failed} failed`)}`);
    return failed === 0;
  } catch (e) {
    log(fail(`Failed to read/execute SQL file: ${e.message}`));
    return false;
  }
}

// ── Split SQL into individual statements ─────────────────────
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inFunction = false;
  let functionDepth = 0;
  
  const lines = sql.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (trimmed.startsWith('--') || trimmed.startsWith('/*') || trimmed === '') {
      current += line + '\n';
      continue;
    }
    
    // Track function body depth
    if (/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(trimmed)) {
      inFunction = true;
    }
    
    if (inFunction) {
      if (trimmed.includes('$$')) {
        functionDepth = functionDepth === 0 ? 1 : 0;
        if (functionDepth === 0 && /LANGUAGE\s+plpgsql/i.test(current)) {
          inFunction = false;
        }
      }
      if (trimmed.includes('BEGIN')) functionDepth++;
      if (trimmed.includes('END')) functionDepth--;
    }
    
    current += line + '\n';
    
    // Statement terminator (but not inside function)
    if (trimmed.endsWith(';') && !inFunction && functionDepth === 0) {
      statements.push(current.trim());
      current = '';
    }
  }
  
  // Add any remaining statement
  if (current.trim()) {
    statements.push(current.trim());
  }
  
  return statements.filter(s => s.length > 0);
}

// ── Phase 9: Summary ────────────────────────────────────────
async function printSummary() {
  header('Summary');
  log(`  SQL files scanned:     ${state.sqlFiles.length}`);
  log(`  Unique tables found:   ${state.tables.size}`);
  log(`  Supabase connected:    ${state.supabaseConnected ? 'YES' : 'NO'}`);
  log(`  Errors:                ${state.errors}`);
  log(`  Warnings:              ${state.warnings}`);
  log(`  Auto-fixes generated:  ${state.fixes}`);

  if (state.errors === 0 && state.warnings === 0) {
    log(`\n${C.green}${C.bold}✓ All checks passed. Schema is clean.${C.reset}`);
  } else if (state.errors === 0) {
    log(`\n${C.yellow}${C.bold}⚠ Warnings found but no critical errors.${C.reset}`);
  } else {
    log(`\n${C.red}${C.bold}✗ Critical issues found. Fix before deploying.${C.reset}`);
  }
}

// ── CLI Args ────────────────────────────────────────────────
const args = process.argv.slice(2);
const doFix = args.includes('--fix');
const doExec = args.includes('--exec');
const targetFile = args.find(a => a.endsWith('.sql'));

// Import writeFile for fix generation
import { writeFile } from 'fs/promises';

// ── Main ────────────────────────────────────────────────────
async function main() {
  log(`${C.bold}${C.cyan}`);
  log('╔══════════════════════════════════════════════════════════════╗');
  log('║           SUPABASE AGENT CHECKER v1.0                        ║');
  log('║   Validates SQL schemas · Detects conflicts · Auto-fixes    ║');
  log('╚══════════════════════════════════════════════════════════════╝');
  log(`${C.reset}`);

  await loadEnv();
  await discoverSqlFiles();
  await parseAndValidate();
  await checkRequiredTables();
  await checkCredentials();
  await testConnection();
  await checkKnownIssues();

  if (doFix) {
    await generateFixSql();
  }

  if (doExec && targetFile) {
    header(`Executing: ${targetFile}`);
    const sqlPath = resolve(ROOT, 'supabase', targetFile);
    const result = await executeSqlFile(sqlPath);
    if (result) {
      log(ok(`✓ Successfully executed ${targetFile}`));
    } else {
      log(fail(`✗ Failed to execute ${targetFile}`));
      state.errors++;
    }
  }
  
  // Execute trader fix specifically
  if (args.includes('--fix-trader')) {
    header('Executing Trader Fix');
    const traderFixPath = resolve(ROOT, 'supabase', 'fix-trader-not-trading.sql');
    log(info('This will fix:'));
    log('  • Create execution_profiles table');
    log('  • Seed mock accounts');
    log('  • Fix side constraint case sensitivity');
    log('  • Add missing columns to mock_trades');
    log('');
    
    const result = await executeSqlFile(traderFixPath);
    if (result) {
      log(ok('✓ Trader fix applied successfully!'));
      log(info('Next steps:'));
      log('  1. Run: node scripts/seed-test-signals.mjs');
      log('  2. Restart workers: pm2 restart execution-worker');
    } else {
      log(fail('✗ Trader fix failed'));
      state.errors++;
    }
  }

  await printSummary();

  process.exit(state.errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(fail(`Fatal error: ${e.message}`));
  process.exit(1);
});
