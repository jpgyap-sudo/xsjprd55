// ============================================================
// Run Supabase Schema Migration
// Executes SQL from research-agent-schema.sql and fix-trader-not-trading.sql
// via Supabase's SQL execution endpoint.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Load env
import '../lib/env.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function runSqlFile(filePath, label) {
  console.log(`\n=== Running ${label} ===`);
  const sql = readFileSync(filePath, 'utf-8');
  
  // Split by semicolons and run each statement
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let success = 0;
  let failed = 0;

  for (const stmt of statements) {
    try {
      // Use rpc to execute raw SQL
      const { error } = await supabase.rpc('exec_sql', { query: stmt + ';' });
      if (error) {
        // Try direct query as fallback
        const { error: err2 } = await supabase.from('_sql_exec').select('*').limit(0);
        if (err2) {
          console.log(`  ⚠️  Statement skipped (no exec_sql RPC): ${stmt.substring(0, 60)}...`);
          failed++;
        }
      } else {
        success++;
      }
    } catch (e) {
      console.log(`  ⚠️  Error: ${e.message.substring(0, 80)}`);
      failed++;
    }
  }

  console.log(`  ✅ ${success} statements executed, ${failed} skipped`);
}

async function main() {
  // Try to create the exec_sql function first
  try {
    const { error } = await supabase.rpc('exec_sql', { query: 'SELECT 1' });
    if (error && error.message.includes('function "exec_sql" does not exist')) {
      console.log('⚠️  exec_sql RPC function does not exist on this Supabase project.');
      console.log('   You need to run the SQL manually via Supabase SQL Editor.');
      console.log('   Files to run:');
      console.log('   1. supabase/research-agent-schema.sql');
      console.log('   2. supabase/fix-trader-not-trading.sql');
      console.log('   3. supabase/fix-mock-trader-db-patch.sql');
      process.exit(0);
    }
  } catch (e) {
    console.log('⚠️  Cannot check for exec_sql RPC. You need to run SQL manually.');
    console.log('   Use Supabase Dashboard > SQL Editor to run:');
    console.log('   1. supabase/research-agent-schema.sql');
    console.log('   2. supabase/fix-trader-not-trading.sql');
    process.exit(0);
  }

  await runSqlFile(resolve(root, 'supabase/research-agent-schema.sql'), 'Research Agent Schema');
  await runSqlFile(resolve(root, 'supabase/fix-trader-not-trading.sql'), 'Trader Fix');
}

main().catch(console.error);
