// Final attempt: Push AI Consultant migration to Supabase
// Uses @supabase/supabase-js with service_role key
// Tries multiple approaches

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import https from 'https';

const SUPABASE_URL = 'https://nqcgnwpfxnbtdrvtkwej.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xY2dud3BmeG5idGRydnRrd2VqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzIxMDI3NCwiZXhwIjoyMDkyNzg2Mjc0fQ.X3N2peEGhK2_WEwiuVC3gLX930dTce4Y_OonbfZ9HhY';
const PROJECT_REF = 'nqcgnwpfxnbtdrvtkwej';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const sql = fs.readFileSync('supabase/migrations/20260515_ai_consultant_mode.sql', 'utf8');

function httpRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log('=== AI Consultant Migration Pusher ===\n');

  // Step 1: Check if tables already exist
  console.log('Step 1: Checking if advisor_requests table exists...');
  const { data: check, error: checkErr } = await supabase
    .from('advisor_requests')
    .select('id', { count: 'exact', head: true });

  if (checkErr && checkErr.code === '42P01') {
    console.log('  -> Tables do NOT exist. Need to create them.\n');
  } else if (checkErr) {
    console.log('  -> Check error:', checkErr.message, `(code: ${checkErr.code})\n`);
  } else {
    console.log('  -> Tables ALREADY EXIST! Migration already applied.\n');
    return;
  }

  // Step 2: Try Management API with service role key
  console.log('Step 2: Trying Supabase Management API...');
  const body = JSON.stringify({ query: sql });
  const mgmtResult = await httpRequest(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    'POST',
    {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body
  );
  console.log(`  -> Status: ${mgmtResult.status}`);
  console.log(`  -> Response: ${mgmtResult.body.substring(0, 300)}`);

  if (mgmtResult.status === 200) {
    console.log('\n✅ Migration applied successfully via Management API!\n');
    return;
  }

  // Step 3: Try splitting SQL into individual statements
  console.log('\nStep 3: Trying individual SQL statements via Management API...');
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i] + ';';
    const stmtBody = JSON.stringify({ query: stmt });
    const result = await httpRequest(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
      'POST',
      {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      stmtBody
    );
    if (result.status === 200) {
      successCount++;
      console.log(`  [${i + 1}/${statements.length}] ✅ ${stmt.substring(0, 60)}...`);
    } else {
      failCount++;
      console.log(`  [${i + 1}/${statements.length}] ❌ Status ${result.status}: ${result.body.substring(0, 100)}`);
    }
  }

  console.log(`\nResults: ${successCount} succeeded, ${failCount} failed`);

  // Step 4: Verify tables were created
  console.log('\nStep 4: Verifying tables...');
  const tablesToCheck = [
    'advisor_requests', 'advisor_reports', 'strategy_hypotheses',
    'strategy_backtests', 'simulation_agents', 'simulated_trades',
    'signal_outcomes', 'advisor_learning_memory'
  ];

  for (const table of tablesToCheck) {
    const { data, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true });
    if (error) {
      console.log(`  ❌ ${table}: ${error.message}`);
    } else {
      console.log(`  ✅ ${table}: exists`);
    }
  }
}

main().catch(e => console.error('FATAL:', e));
