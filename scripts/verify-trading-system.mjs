// ============================================================
// Verify Trading System - Comprehensive Diagnostic v2
// Run: node scripts/verify-trading-system.mjs
// Checks ALL components required for mock trading to work
// 2026-05-02
// ============================================================

import { createClient } from '@supabase/supabase-js';
import '../lib/env.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

console.log('🔍 TRADING SYSTEM VERIFICATION v2\n');
console.log('=' .repeat(60));

// ── 1. Environment Variables ───────────────────────────────
console.log('\n📋 1. ENVIRONMENT VARIABLES');
console.log('-'.repeat(40));
const requiredVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ENABLE_MOCK_TRADING_WORKER',
  'TRADING_MODE',
  'MOCK_STARTING_BALANCE'
];
const missing = [];
for (const v of requiredVars) {
  const val = process.env[v];
  if (!val || val.startsWith('your-')) {
    missing.push(v);
    console.log(`   ❌ ${v}: ${val ? 'PLACEHOLDER VALUE' : 'NOT SET'}`);
  } else {
    console.log(`   ✅ ${v}: ${val.substring(0, 20)}...`);
  }
}
if (missing.length > 0) {
  console.log(`\n   ⚠️  Missing ${missing.length} required variables!`);
}

// ── 2. Supabase Connection ─────────────────────────────────
console.log('\n📋 2. SUPABASE CONNECTION');
console.log('-'.repeat(40));

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log('   ❌ Cannot connect - missing credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

try {
  const { error } = await supabase.from('signals').select('id').limit(1);
  if (error && error.code === '42P01') {
    console.log('   ⚠️  signals table missing (expected if not initialized)');
  } else if (error) {
    console.log(`   ❌ Connection failed: ${error.message}`);
    process.exit(1);
  } else {
    console.log('   ✅ Connected');
  }
} catch (e) {
  console.log(`   ❌ Connection exception: ${e.message}`);
  process.exit(1);
}

// ── Helper ─────────────────────────────────────────────────
async function checkTable(tableName, requiredCols = []) {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select(requiredCols.join(',') || '*')
      .limit(1);
    if (error) {
      if (error.code === '42P01') return { ok: false, error: 'TABLE DOES NOT EXIST' };
      if (error.message?.includes('does not exist')) return { ok: false, error: 'TABLE OR COLUMN MISSING' };
      return { ok: false, error: error.message };
    }
    return { ok: true, sample: data?.[0] || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getCount(tableName, filters = {}) {
  try {
    let q = supabase.from(tableName).select('*', { count: 'exact', head: true });
    for (const [col, val] of Object.entries(filters)) {
      q = q.eq(col, val);
    }
    const { count, error } = await q;
    if (error) return { count: 0, error: error.message };
    return { count: count || 0, error: null };
  } catch (e) {
    return { count: 0, error: e.message };
  }
}

// ── 3. Database Tables ─────────────────────────────────────
console.log('\n📋 3. DATABASE TABLES');
console.log('-'.repeat(40));

const tables = [
  { name: 'signals', cols: ['id', 'symbol', 'side', 'status', 'confidence'], critical: true },
  { name: 'mock_accounts', cols: ['id', 'name', 'current_balance', 'peak_balance', 'metadata'], critical: true },
  { name: 'mock_trades', cols: ['id', 'symbol', 'status', 'entry_price', 'metadata', 'trailing_stop_pct', 'highest_price', 'lowest_price'], critical: true },
  { name: 'execution_profiles', cols: ['symbol', 'base_leverage', 'win_rate'], critical: true },
  { name: 'loss_patterns', cols: ['id', 'symbol', 'pnl_usd'], critical: false },
  { name: 'mock_trade_history', cols: ['id', 'trade_id', 'event'], critical: false },
];

let tableIssues = 0;
for (const t of tables) {
  const result = await checkTable(t.name, t.cols);
  const icon = result.ok ? '✅' : (t.critical ? '❌' : '⚠️');
  if (!result.ok) tableIssues++;
  console.log(`   ${icon} ${t.name}: ${result.ok ? 'OK' : result.error}`);
}

// ── 4. Active Signals ──────────────────────────────────────
console.log('\n📋 4. ACTIVE SIGNALS');
console.log('-'.repeat(40));

const { data: signals, error: sigError } = await supabase
  .from('signals')
  .select('id, symbol, side, confidence, generated_at, valid_until, status')
  .eq('status', 'active')
  .order('generated_at', { ascending: false })
  .limit(10);

let signalIssues = 0;
if (sigError) {
  console.log(`   ❌ Error: ${sigError.message}`);
  signalIssues++;
} else if (!signals || signals.length === 0) {
  console.log('   ⚠️  NO ACTIVE SIGNALS found!');
  console.log('   💡 Run: node scripts/seed-test-signals.mjs');
  signalIssues++;
} else {
  console.log(`   ✅ Found ${signals.length} active signals`);
  signals.slice(0, 5).forEach(s => {
    const ageMin = Math.round((Date.now() - new Date(s.generated_at).getTime()) / 60000);
    console.log(`      • ${s.symbol} ${s.side} (${(s.confidence * 100).toFixed(0)}%) — ${ageMin}m ago`);
  });
}

// ── 5. Mock Accounts ───────────────────────────────────────
console.log('\n📋 5. MOCK ACCOUNTS');
console.log('-'.repeat(40));

const { data: accounts, error: accError } = await supabase
  .from('mock_accounts')
  .select('id, name, current_balance, starting_balance, peak_balance, metadata')
  .order('created_at', { ascending: false });

let accountIssues = 0;
if (accError) {
  console.log(`   ❌ Error: ${accError.message}`);
  accountIssues++;
} else if (!accounts || accounts.length === 0) {
  console.log('   ❌ NO ACCOUNTS found!');
  console.log('   💡 Run SQL from supabase/fix-all-mock-trading.sql');
  accountIssues++;
} else {
  console.log(`   ✅ Found ${accounts.length} account(s)`);
  accounts.forEach(a => {
    const bal = a.current_balance ?? a.starting_balance ?? 'N/A';
    console.log(`      • ${a.name}: $${Number(bal).toLocaleString()}`);
  });
}

// ── 6. Mock Trades ─────────────────────────────────────────
console.log('\n📋 6. MOCK TRADES');
console.log('-'.repeat(40));

const openCountRes = await getCount('mock_trades', { status: 'open' });
const closedCountRes = await getCount('mock_trades', { status: 'closed' });

if (openCountRes.error) {
  console.log(`   ❌ Error checking open trades: ${openCountRes.error}`);
} else {
  console.log(`   ✅ Open trades: ${openCountRes.count}`);
}
if (!closedCountRes.error) {
  console.log(`   ✅ Closed trades: ${closedCountRes.count}`);
}

// ── 7. Execution Profiles ──────────────────────────────────
console.log('\n📋 7. EXECUTION PROFILES');
console.log('-'.repeat(40));

const { data: profiles, error: profError } = await supabase
  .from('execution_profiles')
  .select('symbol, base_leverage, win_rate')
  .limit(10);

let profileIssues = 0;
if (profError) {
  if (profError.code === '42P01') {
    console.log('   ❌ execution_profiles table DOES NOT EXIST!');
    profileIssues++;
  } else {
    console.log(`   ❌ Error: ${profError.message}`);
    profileIssues++;
  }
} else if (!profiles || profiles.length === 0) {
  console.log('   ⚠️  No execution profiles found');
  profileIssues++;
} else {
  console.log(`   ✅ Found ${profiles.length} profile(s)`);
}

// ── 8. Side Constraint Check ───────────────────────────────
console.log('\n📋 8. SIDE CONSTRAINT CHECK');
console.log('-'.repeat(40));
try {
  const { error: testErr } = await supabase.from('mock_trades').insert({
    symbol: 'TESTUSDT',
    side: 'LONG',
    entry_price: 1,
    status: 'open',
    leverage: 1,
    created_at: new Date().toISOString()
  }).select().single();
  if (testErr && testErr.message?.includes('mock_trades_side_check')) {
    console.log('   ❌ Side constraint still rejects uppercase (LONG)');
    console.log('   💡 Run SQL from supabase/fix-all-mock-trading.sql');
  } else if (testErr && testErr.code === '23503') {
    console.log('   ✅ Side constraint accepts LONG (FK error is expected for test)');
  } else if (testErr) {
    console.log(`   ⚠️  Test insert error: ${testErr.message}`);
  } else {
    console.log('   ✅ Side constraint OK (test row inserted — clean it up manually)');
  }
} catch (e) {
  console.log(`   ⚠️  Constraint check exception: ${e.message}`);
}

// ── 9. Worker Config Check ─────────────────────────────────
console.log('\n📋 9. WORKER CONFIGURATION');
console.log('-'.repeat(40));
const workerEnv = {
  ENABLE_MOCK_TRADING_WORKER: process.env.ENABLE_MOCK_TRADING_WORKER,
  TRADING_MODE: process.env.TRADING_MODE || 'paper',
  MOCK_STARTING_BALANCE: process.env.MOCK_STARTING_BALANCE || '1_000_000 (default)',
  MOCK_MAX_LEVERAGE: process.env.MOCK_MAX_LEVERAGE || '3 (default)',
};
for (const [k, v] of Object.entries(workerEnv)) {
  console.log(`   ℹ️  ${k}: ${v}`);
}

// ── Summary ────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log('📊 SUMMARY');
console.log('='.repeat(60));

const totalIssues = missing.length + tableIssues + signalIssues + accountIssues + profileIssues;

if (totalIssues === 0) {
  console.log('✅ All checks passed! Trading system should be operational.');
  console.log('\nNext steps:');
  console.log('   1. Ensure workers are running:');
  console.log('      pm2 start workers/execution-worker.js');
  console.log('      pm2 start workers/aggressive-mock-worker.js');
  console.log('      pm2 start workers/mock-trading-worker.js');
  console.log('   2. Check logs: pm2 logs execution-worker');
  console.log('   3. View dashboard: /api/mock-trading-dashboard');
} else {
  console.log(`⚠️  Found ${totalIssues} issue(s) that need attention.`);
  console.log('\nFix these issues:');
  console.log('   1. Set missing environment variables in .env / .env.prod');
  console.log('   2. Run SQL from supabase/fix-all-mock-trading.sql in Supabase SQL Editor');
  console.log('   3. Seed test signals: node scripts/seed-test-signals.mjs');
  console.log('   4. Restart workers: pm2 restart all');
}
