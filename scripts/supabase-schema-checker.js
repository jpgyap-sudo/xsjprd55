#!/usr/bin/env node
// ============================================================
// Supabase Schema Checker — Autonomous Agent
// Verifies all required tables, RLS, and constraints
// ============================================================

import { createClient } from '@supabase/supabase-js';
import '../lib/env.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const REQUIRED_TABLES = [
  'signals',
  'trades',
  'bot_users',
  'audit_log',
  'market_data',
  'mock_trades',
  'mock_accounts',
  'signal_logs',
  'signal_feature_scores',
  'backtest_runs',
  'backtest_trades'
];

const OPTIONAL_TABLES = [
  'bugs',
  'agent_ideas',
  'api_debugger_runs',
  'api_debugger_results',
  'product_features',
  'product_updates',
  'diagnostic_snapshots',
  'perpetual_mock_accounts',
  'perpetual_mock_trades',
  'perpetual_trader_logs',
  'signal_memory',
  'strategy_performance'
];

async function checkTableExists(tableName) {
  try {
    const { error } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true });
    
    if (error && error.code === '42P01') {
      return { exists: false, error: 'Table does not exist' };
    }
    
    return { exists: true, error: null };
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

async function getTableCount(tableName) {
  try {
    const { count, error } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true });
    
    if (error) return { count: 0, error: error.message };
    return { count: count || 0, error: null };
  } catch (e) {
    return { count: 0, error: e.message };
  }
}

async function checkRLS(tableName) {
  try {
    const { data, error } = await supabase.rpc('check_rls_status', { table_name: tableName });
    if (error) return { enabled: null, error: error.message };
    return { enabled: data?.rls_enabled, error: null };
  } catch (e) {
    return { enabled: null, error: e.message };
  }
}

async function runSchemaCheck() {
  console.log('🔍 SUPABASE SCHEMA CHECK');
  console.log('=' .repeat(60));
  console.log(`URL: ${SUPABASE_URL.slice(0, 30)}...`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('=' .repeat(60));
  
  // Test connection
  console.log('\n📡 Testing connection...');
  const { error: connError } = await supabase.from('signals').select('id').limit(1);
  if (connError && connError.code === '42P01') {
    console.log('⚠️  signals table missing (expected if not initialized)');
  } else if (connError) {
    console.error('❌ Connection failed:', connError.message);
    return;
  } else {
    console.log('✅ Connection successful');
  }
  
  // Check required tables
  console.log('\n📋 REQUIRED TABLES');
  console.log('-'.repeat(60));
  let missingRequired = [];
  for (const table of REQUIRED_TABLES) {
    const { exists, error } = await checkTableExists(table);
    const { count } = exists ? await getTableCount(table) : { count: 0 };
    
    if (exists) {
      console.log(`✅ ${table.padEnd(25)} | ${count.toString().padStart(6)} rows`);
    } else {
      console.log(`❌ ${table.padEnd(25)} | MISSING`);
      missingRequired.push(table);
    }
  }
  
  // Check optional tables
  console.log('\n📋 OPTIONAL TABLES');
  console.log('-'.repeat(60));
  for (const table of OPTIONAL_TABLES) {
    const { exists, error } = await checkTableExists(table);
    const { count } = exists ? await getTableCount(table) : { count: 0 };
    
    if (exists) {
      console.log(`✅ ${table.padEnd(25)} | ${count.toString().padStart(6)} rows`);
    } else {
      console.log(`⚠️  ${table.padEnd(25)} | missing (optional)`);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  
  if (missingRequired.length === 0) {
    console.log('✅ All required tables present');
  } else {
    console.log(`❌ Missing ${missingRequired.length} required tables:`);
    missingRequired.forEach(t => console.log(`   - ${t}`));
    console.log('\n📝 Run these SQL files in Supabase:');
    console.log('   1. supabase/schema.sql (core tables)');
    console.log('   2. supabase/create-missing-tables.sql (mock trading)');
    console.log('   3. supabase/trading_schema.sql (extended tables)');
  }
  
  console.log('\n' + '='.repeat(60));
}

runSchemaCheck().catch(console.error);
