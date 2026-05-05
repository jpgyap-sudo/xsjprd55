// ============================================================
// Fix signals status check constraint via Supabase REST API
// Adds 'skipped' and 'executed' to the allowed status values
// ============================================================
// Usage: node scripts/fix-signals-status-constraint.mjs
// ============================================================

import '../lib/env.js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey || supabaseKey.includes('your-')) {
  console.error('ERROR: Valid SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('=== Fixing signals status check constraint ===\n');

  // Step 1: Check current constraint
  console.log('1. Checking current signals status constraint...');
  const { data: sample } = await supabase
    .from('signals')
    .select('id, status')
    .limit(1);

  if (!sample || !sample.length) {
    console.log('   No signals found, checking if table exists...');
    const { error: tableCheck } = await supabase
      .from('signals')
      .select('id')
      .limit(0);
    if (tableCheck) {
      console.error(`   Table error: ${tableCheck.message}`);
      process.exit(1);
    }
  } else {
    console.log(`   Sample signal status: "${sample[0].status}"`);
  }

  // Step 2: Try to update a signal to 'skipped' to see if constraint blocks it
  console.log('\n2. Testing if constraint blocks "skipped" status...');
  const { data: testSignal } = await supabase
    .from('signals')
    .select('id, status')
    .eq('status', 'active')
    .limit(1)
    .single();

  if (testSignal) {
    const { error: testUpdate } = await supabase
      .from('signals')
      .update({ status: 'skipped', metadata: { test_skip: true } })
      .eq('id', testSignal.id);

    if (testUpdate) {
      console.log(`   ❌ Update blocked: ${testUpdate.message}`);
      console.log('   Need to fix the check constraint via Supabase SQL Editor');
    } else {
      console.log('   ✅ Update succeeded! Constraint already allows "skipped"');
      // Revert
      await supabase
        .from('signals')
        .update({ status: 'active', metadata: {} })
        .eq('id', testSignal.id);
    }
  }

  // Step 3: Provide SQL to run in Supabase SQL Editor
  console.log('\n3. SQL to run in Supabase SQL Editor:');
  console.log('');
  console.log('   -- Drop old constraint and add new one with expanded values');
  console.log('   ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_status_check;');
  console.log('   ALTER TABLE signals ADD CONSTRAINT signals_status_check');
  console.log("     CHECK (status IN ('active','confirmed','dismissed','expired','skipped','executed'));");
  console.log('');
  console.log('   -- Verify the fix');
  console.log("   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint");
  console.log("     WHERE conrelid = 'signals'::regclass AND conname = 'signals_status_check';");
  console.log('');

  // Step 4: Try via raw SQL endpoint (if available)
  console.log('4. Attempting direct SQL execution via Supabase REST API...');
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        sql: `ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_status_check;
              ALTER TABLE signals ADD CONSTRAINT signals_status_check
                CHECK (status IN ('active','confirmed','dismissed','expired','skipped','executed'));`
      }),
    });

    if (response.ok) {
      console.log('   ✅ SQL executed successfully via exec_sql RPC!');
    } else {
      const text = await response.text();
      console.log(`   ❌ exec_sql RPC failed (${response.status}): ${text.substring(0, 200)}`);
      console.log('   ℹ️  Please run the SQL above manually in Supabase SQL Editor');
    }
  } catch (e) {
    console.log(`   ❌ exec_sql RPC error: ${e.message}`);
    console.log('   ℹ️  Please run the SQL above manually in Supabase SQL Editor');
  }

  // Step 5: Summary
  console.log('\n=== Summary ===');
  console.log('The signals table has a CHECK constraint that only allows these status values:');
  console.log("  active, confirmed, dismissed, expired");
  console.log('');
  console.log('The execution-worker needs to set status to "skipped" or "executed"');
  console.log('to prevent infinite reprocessing loops.');
  console.log('');
  console.log('Fix: Run the SQL in Step 3 in your Supabase SQL Editor.');
  console.log('   URL: https://supabase.com/dashboard/project/nqcgnwpfxnbtdrvtkwej/sql/new');
}

main().catch(console.error);
