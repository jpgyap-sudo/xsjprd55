// ============================================================
// Verify Trading System - Comprehensive Diagnostic
// Run: node scripts/verify-trading-system.mjs
// Checks all components required for trading to work
// ============================================================

import { createClient } from '@supabase/supabase-js';
import '../lib/env.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

console.log('🔍 TRADING SYSTEM VERIFICATION\n');
console.log('=' .repeat(60));

// Check environment
console.log('\n📋 1. ENVIRONMENT VARIABLES');
console.log('-'.repeat(40));
const requiredVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ENABLE_MOCK_TRADING_WORKER'];
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

// Check Supabase connection
console.log('\n📋 2. SUPABASE CONNECTION');
console.log('-'.repeat(40));

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log('   ❌ Cannot connect - missing credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function checkTable(tableName, requiredCols = []) {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select(requiredCols.join(',') || '*')
      .limit(1);
    
    if (error) {
      if (error.code === '42P01') {
        return { ok: false, error: 'TABLE DOES NOT EXIST' };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true, sample: data?.[0] || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Check tables
console.log('\n📋 3. DATABASE TABLES');
console.log('-'.repeat(40));

const tables = [
  { name: 'signals', cols: ['id', 'symbol', 'side', 'status', 'confidence'] },
  { name: 'mock_accounts', cols: ['id', 'name', 'current_balance'] },
  { name: 'mock_trades', cols: ['id', 'symbol', 'status', 'entry_price'] },
  { name: 'execution_profiles', cols: ['symbol', 'base_leverage'] },
];

for (const t of tables) {
  const result = await checkTable(t.name, t.cols);
  if (result.ok) {
    console.log(`   ✅ ${t.name}: OK`);
  } else {
    console.log(`   ❌ ${t.name}: ${result.error}`);
  }
}

// Check active signals
console.log('\n📋 4. ACTIVE SIGNALS');
console.log('-'.repeat(40));

const { data: signals, error: sigError } = await supabase
  .from('signals')
  .select('id, symbol, side, confidence, generated_at, valid_until, status')
  .eq('status', 'active')
  .order('generated_at', { ascending: false })
  .limit(10);

if (sigError) {
  console.log(`   ❌ Error: ${sigError.message}`);
} else if (!signals || signals.length === 0) {
  console.log('   ⚠️  NO ACTIVE SIGNALS found!');
  console.log('   💡 Run: node scripts/seed-test-signals.mjs');
} else {
  console.log(`   ✅ Found ${signals.length} active signals`);
  signals.slice(0, 3).forEach(s => {
    console.log(`      • ${s.symbol} ${s.side} (${(s.confidence * 100).toFixed(0)}%)`);
  });
}

// Check mock accounts
console.log('\n📋 5. MOCK ACCOUNTS');
console.log('-'.repeat(40));

const { data: accounts, error: accError } = await supabase
  .from('mock_accounts')
  .select('id, name, current_balance, starting_balance');

if (accError) {
  console.log(`   ❌ Error: ${accError.message}`);
} else if (!accounts || accounts.length === 0) {
  console.log('   ❌ NO ACCOUNTS found!');
  console.log('   💡 Run SQL from supabase/fix-trader-not-trading.sql');
} else {
  console.log(`   ✅ Found ${accounts.length} account(s)`);
  accounts.forEach(a => {
    console.log(`      • ${a.name}: $${a.current_balance?.toLocaleString() || 'N/A'}`);
  });
}

// Check mock trades
console.log('\n📋 6. MOCK TRADES');
console.log('-'.repeat(40));

const { data: openTrades, error: openError } = await supabase
  .from('mock_trades')
  .select('id, symbol, side, status, created_at', { count: 'exact' })
  .eq('status', 'open');

const { data: closedTrades, error: closedError } = await supabase
  .from('mock_trades')
  .select('id', { count: 'exact', head: true })
  .eq('status', 'closed');

if (openError) {
  console.log(`   ❌ Error checking open trades: ${openError.message}`);
} else {
  console.log(`   ✅ Open trades: ${openTrades?.length || 0}`);
}

if (!closedError) {
  console.log(`   ✅ Closed trades: ${closedTrades?.length || 0}`);
}

if (openTrades?.length > 0) {
  console.log('\n   Current open positions:');
  openTrades.slice(0, 5).forEach(t => {
    console.log(`      • ${t.symbol} ${t.side} (${t.status})`);
  });
}

// Check execution profiles
console.log('\n📋 7. EXECUTION PROFILES');
console.log('-'.repeat(40));

const { data: profiles, error: profError } = await supabase
  .from('execution_profiles')
  .select('symbol, base_leverage, win_rate')
  .limit(10);

if (profError) {
  if (profError.code === '42P01') {
    console.log('   ❌ execution_profiles table DOES NOT EXIST!');
    console.log('   💡 Run SQL from supabase/fix-trader-not-trading.sql');
  } else {
    console.log(`   ❌ Error: ${profError.message}`);
  }
} else if (!profiles || profiles.length === 0) {
  console.log('   ⚠️  No execution profiles found');
  console.log('   💡 Run SQL from supabase/fix-trader-not-trading.sql');
} else {
  console.log(`   ✅ Found ${profiles.length} profile(s)`);
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 SUMMARY');
console.log('='.repeat(60));

let issues = 0;
if (missing.length > 0) issues++;
if (!signals || signals.length === 0) issues++;
if (!accounts || accounts.length === 0) issues++;
if (profError?.code === '42P01' || !profiles || profiles.length === 0) issues++;

if (issues === 0) {
  console.log('✅ All checks passed! Trading system should be operational.');
  console.log('\nNext steps:');
  console.log('   1. Ensure execution-worker is running: pm2 start workers/execution-worker.js');
  console.log('   2. Check logs: pm2 logs execution-worker');
  console.log('   3. View dashboard: /api/mock-trading-dashboard');
} else {
  console.log(`⚠️  Found ${issues} issue(s) that need attention.`);
  console.log('\nFix these issues:');
  console.log('   1. Set missing environment variables in .env');
  console.log('   2. Run SQL from supabase/fix-trader-not-trading.sql in Supabase');
  console.log('   3. Seed test signals: node scripts/seed-test-signals.mjs');
}
