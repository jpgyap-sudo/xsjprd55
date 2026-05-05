// ============================================================
// Run Supabase SQL migrations via REST API (pg_dump alternative)
// Uses the Supabase management API SQL endpoint.
// Run from VPS: node scripts/run-supabase-migration.mjs
// ============================================================
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nqcgnwpfxnbtdrvtkwej.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY env var not set.');
  console.error('Set it from your .env file or Supabase dashboard.');
  process.exit(1);
}

async function runSql(sql, label) {
  console.log(`\n--- Running ${label} ---`);
  
  // Use Supabase REST API to execute SQL via the /rest/v1/ endpoint
  // We'll use the pg_dump approach: send SQL as a query parameter
  const url = `${SUPABASE_URL}/rest/v1/rpc/`;
  
  // Supabase has a built-in function to execute arbitrary SQL
  // Alternative: use the management API
  // For now, we'll use the direct approach with the service role key
  
  // Split SQL into individual statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const stmt of statements) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          query: stmt + ';'
        })
      });
      
      if (response.ok || response.status === 204) {
        successCount++;
      } else {
        // Try alternative: use the SQL endpoint
        const text = await response.text();
        // Many "already exists" errors are harmless
        if (text.includes('already exists') || text.includes('duplicate')) {
          successCount++;
        } else {
          console.warn(`  ⚠ Statement ${successCount + errorCount + 1}: ${text.substring(0, 200)}`);
          errorCount++;
        }
      }
    } catch (err) {
      console.warn(`  ⚠ Statement ${successCount + errorCount + 1}: ${err.message.substring(0, 200)}`);
      errorCount++;
    }
  }
  
  console.log(`  ✓ ${successCount} statements OK, ${errorCount} warnings (harmless if "already exists")`);
  return { successCount, errorCount };
}

async function runSqlViaDirectEndpoint(sql, label) {
  console.log(`\n--- Running ${label} ---`);
  
  // Use the Supabase SQL endpoint (available on self-hosted or via pg)
  // For Supabase cloud, we use the management API
  const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    method: 'GET',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Accept': 'application/json'
    }
  });
  
  console.log(`  REST API status: ${response.status}`);
  
  // Try the pg_dump approach via the SQL endpoint
  // Supabase cloud doesn't expose a raw SQL endpoint via REST
  // We need to use the management API or direct PostgreSQL connection
  
  // Let's try using the supabase-js client approach
  // For now, we'll use fetch to the management API
  const mgmtResponse = await fetch(
    `https://api.supabase.com/v1/projects/nqcgnwpfxnbtdrvtkwej/postgres`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: sql })
    }
  );
  
  if (mgmtResponse.ok) {
    const result = await mgmtResponse.json();
    console.log(`  ✓ Migration applied successfully`);
    return result;
  } else {
    const text = await mgmtResponse.text();
    console.error(`  ❌ Management API error: ${text.substring(0, 300)}`);
    console.log(`\n  Trying alternative: direct SQL execution via fetch...`);
    
    // Alternative: use the Supabase REST API to check if tables exist
    // and create them via individual requests
    return await runSqlStatementsViaRest(sql, label);
  }
}

async function runSqlStatementsViaRest(sql, label) {
  console.log(`\n--- ${label} (REST API fallback) ---`);
  
  // Parse SQL for CREATE TABLE IF NOT EXISTS statements
  const tableRegex = /CREATE TABLE IF NOT EXISTS (\w+)/g;
  const tables = [];
  let match;
  while ((match = tableRegex.exec(sql)) !== null) {
    tables.push(match[1]);
  }
  
  console.log(`  Tables to create/verify: ${tables.join(', ')}`);
  
  // Check which tables already exist
  const existingTables = [];
  const missingTables = [];
  
  for (const table of tables) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=count&limit=1`, {
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        existingTables.push(table);
      } else {
        missingTables.push(table);
      }
    } catch {
      missingTables.push(table);
    }
  }
  
  console.log(`  Existing: ${existingTables.length}, Missing: ${missingTables.length}`);
  
  if (missingTables.length === 0) {
    console.log(`  ✓ All tables already exist — no migration needed`);
    return;
  }
  
  console.log(`  Missing tables: ${missingTables.join(', ')}`);
  console.log(`  ⚠ Cannot create tables via REST API — need direct PostgreSQL connection.`);
  console.log(`  Use one of these methods:`);
  console.log(`    1. Supabase Dashboard → SQL Editor → paste the SQL file`);
  console.log(`    2. Local psql: psql "postgresql://..." -f supabase/research-agent-schema.sql`);
  console.log(`    3. VPS with DB_PASSWORD: DB_PASSWORD="..." node scripts/run-sql-supabase.mjs`);
  
  return { existingTables, missingTables };
}

async function main() {
  console.log('=== Supabase Migration Runner ===');
  console.log(`URL: ${SUPABASE_URL}`);
  
  // Migration 1: Research Agent Schema
  const raSql = readFileSync(join(__dirname, '..', 'supabase', 'research-agent-schema.sql'), 'utf8');
  await runSqlStatementsViaRest(raSql, 'Research Agent Schema');
  
  // Migration 2: Perpetual Trader History Schema
  const ptSql = readFileSync(join(__dirname, '..', 'supabase', 'perpetual-trader-history-schema.sql'), 'utf8');
  await runSqlStatementsViaRest(ptSql, 'Perpetual Trader History Schema');
  
  console.log('\n=== Migration Check Complete ===');
  console.log('If tables are missing, run the SQL manually in Supabase Dashboard SQL Editor.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
