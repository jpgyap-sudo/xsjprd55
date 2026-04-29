#!/usr/bin/env python3
# ============================================================
# SUPABASE AGENT CHECKER (Python) — ASCII-only for Windows
# Validates all SQL schema files, detects conflicts, checks
# credentials, and automates SQL execution on Supabase.
# Run: python scripts/supabase-agent-checker.py
# ============================================================

import os, sys, re, json, glob
from pathlib import Path
from urllib import request, error

# Fix Windows cp1252 encoding
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer)
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer)

ROOT = Path(__file__).resolve().parent.parent
SUPABASE_DIR = ROOT / "supabase"

# ── Colors ──────────────────────────────────────────────────
class C:
    RESET = '\033[0m'; RED = '\033[31m'; GREEN = '\033[32m'
    YELLOW = '\033[33m'; BLUE = '\033[34m'; CYAN = '\033[36m'
    DIM = '\033[2m'; BOLD = '\033[1m'

def ok(s): return f"{C.GREEN}[OK]{C.RESET} {s}"
def fail(s): return f"{C.RED}[ERR]{C.RESET} {s}"
def warn(s): return f"{C.YELLOW}[WARN]{C.RESET} {s}"
def info(s): return f"{C.BLUE}[INFO]{C.RESET} {s}"

# ── State ───────────────────────────────────────────────────
state = {
    "errors": 0, "warnings": 0, "fixes": 0,
    "tables": {},
    "sqlFiles": [],
    "env": {},
    "supabaseConnected": False,
    "supabaseUrl": None,
    "supabaseKey": None
}

def log(s=""): print(s)
def header(s): log(f"\n{C.BOLD}{C.CYAN}>> {s}{C.RESET}")
def section(s): log(f"\n{C.BOLD}{s}{C.RESET}")

def parse_env(content):
    env = {}
    for line in content.split('\n'):
        m = re.match(r'^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$', line)
        if m: env[m.group(1)] = m.group(2).strip()
    return env

def load_env():
    header("Phase 1: Loading environment variables")
    candidates = ['.env', '.env.prod', '.env.local', '.env.example']
    for f in candidates:
        p = ROOT / f
        if p.exists():
            state["env"].update(parse_env(p.read_text(encoding='utf-8')))
            log(ok(f"Loaded env from {f}"))

def extract_tables(sql, filename):
    tables = []
    pattern = r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\((.+?)\);'
    for m in re.finditer(pattern, sql, re.DOTALL | re.IGNORECASE):
        name = m.group(1)
        body = m.group(2)
        start_pos = m.start()
        line_num = sql[:start_pos].count('\n') + 1

        pk_match = re.search(r'(\w+)\s+(UUID|BIGSERIAL|SERIAL|INTEGER|BIGINT|TEXT)[^,]*PRIMARY\s+KEY', body, re.IGNORECASE)
        pk_col = pk_match.group(1) if pk_match else 'id'
        pk_type = pk_match.group(2).upper() if pk_match else 'unknown'

        cols = []
        for cm in re.finditer(r'^\s*(\w+)\s+([A-Z_]+(?:\([^)]*\))?)', body, re.MULTILINE | re.IGNORECASE):
            cols.append({"name": cm.group(1), "type": cm.group(2)})

        tables.append({
            "file": filename, "line": line_num, "name": name,
            "pkCol": pk_col, "pkType": pk_type, "columns": cols,
            "rawBody": body
        })
    return tables

def discover_sql_files():
    header("Phase 2: Discovering SQL files")
    files = sorted(SUPABASE_DIR.glob("*.sql"))
    state["sqlFiles"] = files
    log(ok(f"Found {len(files)} SQL files in supabase/"))
    for f in files:
        log(f"  {C.DIM}{f.name}{C.RESET}")

def parse_and_validate():
    header("Phase 3: Parsing SQL schema definitions")
    for f in state["sqlFiles"]:
        sql = f.read_text(encoding='utf-8')
        tables = extract_tables(sql, f.name)
        for t in tables:
            state["tables"].setdefault(t["name"], []).append(t)

    log(ok(f"Extracted {len(state['tables'])} unique table definitions"))

    section("Checking for duplicate table definitions")
    conflict_found = False
    for name, defs in state["tables"].items():
        if len(defs) > 1:
            conflict_found = True
            state["errors"] += 1
            log(fail(f'Table "{name}" defined {len(defs)} times:'))
            for d in defs:
                pk_info = f" (PK: {d['pkType']})" if d['pkType'] != 'unknown' else ''
                log(f"  -> {d['file']}:{d['line']}{pk_info}")
            pk_types = list(set(d['pkType'] for d in defs))
            if len(pk_types) > 1:
                state["errors"] += 1
                log(f"  {C.RED}CRITICAL: PK type conflict -- {' vs '.join(pk_types)}{C.RESET}")
                log(f"  {C.DIM}This will cause 42883 errors when both files are run.{C.RESET}")
    if not conflict_found:
        log(ok("No duplicate table definitions found"))

def check_required_tables():
    header("Phase 4: Checking required application tables")
    required = [
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
    ]
    for t in required:
        if t in state["tables"]:
            defs = state["tables"][t]
            files = ', '.join(sorted(set(d['file'] for d in defs)))
            log(ok(f'Table "{t}" defined in: {files}'))
        else:
            state["warnings"] += 1
            log(warn(f'Table "{t}" NOT FOUND in any SQL file'))

def check_credentials():
    header("Phase 5: Checking Supabase credentials")
    url = state["env"].get("SUPABASE_URL", "")
    key = state["env"].get("SUPABASE_SERVICE_ROLE_KEY", "")

    if not url or "your-project" in url:
        log(fail("SUPABASE_URL not configured"))
        state["errors"] += 1
    else:
        log(ok(f"SUPABASE_URL = {url}"))
        state["supabaseUrl"] = url

    if not key or "your-service-role-key" in key or len(key) < 20:
        log(fail("SUPABASE_SERVICE_ROLE_KEY not configured or invalid"))
        state["errors"] += 1
    else:
        log(ok(f"SUPABASE_SERVICE_ROLE_KEY = {key[:8]}...{key[-4:]} ({len(key)} chars)"))
        state["supabaseKey"] = key

def test_connection():
    header("Phase 6: Testing Supabase connection")
    if not state["supabaseUrl"] or not state["supabaseKey"]:
        log(warn("Skipping connection test -- credentials missing"))
        return

    try:
        req = request.Request(
            f"{state['supabaseUrl']}/rest/v1/",
            headers={
                "apikey": state["supabaseKey"],
                "Authorization": f"Bearer {state['supabaseKey']}",
                "Accept": "application/json"
            }
        )
        resp = request.urlopen(req, timeout=10)
        state["supabaseConnected"] = True
        log(ok(f"Supabase REST API reachable -- HTTP {resp.status}"))
    except error.HTTPError as e:
        if e.code == 401:
            log(warn(f"Supabase REST API reachable but auth failed -- HTTP {e.code}"))
            state["warnings"] += 1
        else:
            log(fail(f"Supabase REST API error -- HTTP {e.code}"))
            state["errors"] += 1
    except Exception as e:
        log(fail(f"Cannot reach Supabase: {e}"))
        state["errors"] += 1

def check_known_issues():
    header("Phase 7: Checking for known schema issues")

    if "strategy_performance" in state["tables"]:
        defs = state["tables"]["strategy_performance"]
        pk_types = list(set(d['pkType'] for d in defs))
        if len(pk_types) > 1:
            log(fail(f"Issue #1: strategy_performance PK conflict ({' vs '.join(pk_types)})"))
            log(f"  {C.DIM}Fix: standardize on UUID (trading_schema.sql) or BIGSERIAL (perpetual-trader-schema.sql){C.RESET}")
            state["errors"] += 1

    section("Checking for unsafe CREATE TABLE (missing IF NOT EXISTS)")
    unsafe_count = 0
    for f in state["sqlFiles"]:
        sql = f.read_text(encoding='utf-8')
        for i, line in enumerate(sql.split('\n'), 1):
            if re.search(r'CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)', line, re.IGNORECASE) and not line.strip().startswith('--'):
                unsafe_count += 1
                log(warn(f"{f.name}:{i} -- CREATE TABLE without IF NOT EXISTS"))
    if unsafe_count == 0:
        log(ok("All CREATE TABLE statements use IF NOT EXISTS"))
    else:
        state["warnings"] += unsafe_count

def generate_fix_sql():
    header("Phase 8: Generating fix SQL for detected issues")
    fix_sql = "-- Auto-generated fix by supabase-agent-checker\n"
    fix_sql += "-- Run this in Supabase SQL Editor before applying main schemas\n\n"

    if "strategy_performance" in state["tables"]:
        defs = state["tables"]["strategy_performance"]
        has_uuid = any(d['pkType'] == 'UUID' for d in defs)
        has_bigserial = any(d['pkType'] == 'BIGSERIAL' for d in defs)
        if has_uuid and has_bigserial:
            fix_sql += "-- Fix: strategy_performance has conflicting definitions\n"
            fix_sql += "-- Keeping UUID version (from trading_schema.sql)\n"
            fix_sql += "DROP TABLE IF EXISTS strategy_performance CASCADE;\n\n"
            state["fixes"] += 1

    fix_sql += "-- Ensure bot_users.telegram_user_id is BIGINT for RLS policies\n"
    fix_sql += "ALTER TABLE IF EXISTS bot_users\n"
    fix_sql += "  ALTER COLUMN telegram_user_id TYPE BIGINT\n"
    fix_sql += "  USING (telegram_user_id::BIGINT);\n\n"

    fix_sql += "-- Recreate RLS policies with explicit BIGINT casts\n"
    fix_sql += 'DROP POLICY IF EXISTS "Users see themselves" ON bot_users;\n'
    fix_sql += 'DROP POLICY IF EXISTS "Users see own trades" ON trades;\n'
    fix_sql += 'DROP POLICY IF EXISTS "Users see own credentials" ON exchange_credentials;\n\n'
    fix_sql += "ALTER TABLE bot_users ENABLE ROW LEVEL SECURITY;\n"
    fix_sql += "ALTER TABLE exchange_credentials ENABLE ROW LEVEL SECURITY;\n"
    fix_sql += "ALTER TABLE trades ENABLE ROW LEVEL SECURITY;\n\n"
    fix_sql += 'CREATE POLICY "Users see themselves"\n'
    fix_sql += "  ON bot_users FOR ALL\n"
    fix_sql += "  USING (telegram_user_id = current_setting('app.current_telegram_id')::BIGINT);\n\n"
    fix_sql += 'CREATE POLICY "Users see own trades"\n'
    fix_sql += "  ON trades FOR ALL\n"
    fix_sql += "  USING (EXISTS (\n"
    fix_sql += "    SELECT 1 FROM bot_users u\n"
    fix_sql += "    WHERE u.id = trades.user_id\n"
    fix_sql += "      AND u.telegram_user_id = current_setting('app.current_telegram_id')::BIGINT\n"
    fix_sql += "  ));\n\n"
    fix_sql += 'CREATE POLICY "Users see own credentials"\n'
    fix_sql += "  ON exchange_credentials FOR ALL\n"
    fix_sql += "  USING (EXISTS (\n"
    fix_sql += "    SELECT 1 FROM bot_users u\n"
    fix_sql += "    WHERE u.id = exchange_credentials.user_id\n"
    fix_sql += "      AND u.telegram_user_id = current_setting('app.current_telegram_id')::BIGINT\n"
    fix_sql += "  ));\n"

    fix_path = SUPABASE_DIR / "auto-fix-schema.sql"
    fix_path.write_text(fix_sql, encoding='utf-8')
    log(ok(f"Generated auto-fix SQL: supabase/auto-fix-schema.sql ({state['fixes']} fixes)"))

def execute_sql(sql_path):
    header(f"Phase 9: Executing {sql_path.name}")
    if not state["supabaseConnected"]:
        log(fail("Cannot execute SQL -- Supabase not connected"))
        return False

    sql = sql_path.read_text(encoding='utf-8')
    try:
        req = request.Request(
            f"{state['supabaseUrl']}/rest/v1/rpc/exec_sql",
            data=json.dumps({"query": sql}).encode(),
            headers={
                "Content-Type": "application/json",
                "apikey": state["supabaseKey"],
                "Authorization": f"Bearer {state['supabaseKey']}"
            },
            method="POST"
        )
        resp = request.urlopen(req, timeout=30)
        log(ok("SQL executed successfully via Supabase RPC"))
        return True
    except error.HTTPError as e:
        err_body = e.read().decode()
        log(fail(f"SQL execution failed: HTTP {e.code} -- {err_body}"))
        return False
    except Exception as e:
        log(fail(f"SQL execution error: {e}"))
        return False

def print_summary():
    header("Summary")
    log(f"  SQL files scanned:     {len(state['sqlFiles'])}")
    log(f"  Unique tables found:   {len(state['tables'])}")
    log(f"  Supabase connected:    {'YES' if state['supabaseConnected'] else 'NO'}")
    log(f"  Errors:                {state['errors']}")
    log(f"  Warnings:              {state['warnings']}")
    log(f"  Auto-fixes generated:  {state['fixes']}")

    if state["errors"] == 0 and state["warnings"] == 0:
        log(f"\n{C.GREEN}{C.BOLD}[PASS] All checks passed. Schema is clean.{C.RESET}")
    elif state["errors"] == 0:
        log(f"\n{C.YELLOW}{C.BOLD}[WARN] Warnings found but no critical errors.{C.RESET}")
    else:
        log(f"\n{C.RED}{C.BOLD}[FAIL] Critical issues found. Fix before deploying.{C.RESET}")

def main():
    args = sys.argv[1:]
    do_fix = '--fix' in args
    do_exec = '--exec' in args
    target_file = None
    for a in args:
        if a.endswith('.sql'):
            target_file = Path(a)
            if not target_file.is_absolute():
                target_file = SUPABASE_DIR / target_file.name

    log(f"{C.BOLD}{C.CYAN}")
    log("==============================================================")
    log("       SUPABASE AGENT CHECKER v1.0 (Python)")
    log("  Validates SQL schemas | Detects conflicts | Auto-fixes")
    log("==============================================================")
    log(f"{C.RESET}")

    load_env()
    discover_sql_files()
    parse_and_validate()
    check_required_tables()
    check_credentials()
    test_connection()
    check_known_issues()

    if do_fix:
        generate_fix_sql()

    if do_exec and target_file and target_file.exists():
        execute_sql(target_file)
    elif do_exec and target_file:
        log(fail(f"File not found: {target_file}"))

    print_summary()
    sys.exit(1 if state["errors"] > 0 else 0)

if __name__ == "__main__":
    main()
