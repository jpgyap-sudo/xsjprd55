// ============================================================
// Execute fix-trader-not-trading.sql in Supabase
// Usage: DB_PASSWORD="your-password" node scripts/execute-trader-fix.mjs
// ============================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_PASSWORD = process.env.DB_PASSWORD;
const PROJECT_REF = 'nqcgnwpfxnbtdrvtkwej';
const DB_HOST = `db.${PROJECT_REF}.supabase.co`;
const DB_USER = 'postgres';
const DB_NAME = 'postgres';
const DB_PORT = 5432;

async function main() {
  if (!DB_PASSWORD) {
    console.error('ERROR: Set DB_PASSWORD env var with your Supabase database password.');
    console.error('Get it from: Supabase Dashboard → Project Settings → Database → Connection String');
    process.exit(1);
  }

  const sqlPath = join(__dirname, '..', 'supabase', 'fix-trader-not-trading.sql');
  console.log(`Reading SQL from: ${sqlPath}`);
  const sql = readFileSync(sqlPath, 'utf-8');

  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log(`Connecting to ${DB_HOST}...`);
    await client.connect();
    console.log('✅ Connected to Supabase database');
    console.log('\n📋 Executing SQL statements...\n');
    
    await client.query(sql);
    console.log('✅ SQL executed successfully.\n');

    // Run verification queries
    console.log('=== TRADER FIX VERIFICATION ===');
    
    const verificationQueries = [
      { name: 'execution_profiles count', query: 'SELECT COUNT(*) as count FROM execution_profiles' },
      { name: 'mock_accounts count', query: 'SELECT COUNT(*) as count FROM mock_accounts' },
      { name: 'mock_accounts seeded', query: `SELECT string_agg(name, ', ') as names FROM mock_accounts` },
      { name: 'mock_trades open count', query: "SELECT COUNT(*) as count FROM mock_trades WHERE status = 'open'" },
      { name: 'mock_trades closed count', query: "SELECT COUNT(*) as count FROM mock_trades WHERE status = 'closed'" },
      { name: 'signals active count', query: "SELECT COUNT(*) as count FROM signals WHERE status = 'active'" }
    ];

    for (const { name, query } of verificationQueries) {
      try {
        const res = await client.query(query);
        const value = res.rows[0].count !== undefined ? res.rows[0].count : res.rows[0].names;
        console.log(`✓ ${name}: ${value}`);
      } catch (err) {
        console.log(`⚠ ${name}: ERROR - ${err.message}`);
      }
    }

    console.log('\n=== TABLE STRUCTURE VERIFICATION ===');
    const tableCheck = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'mock_trades'
      ORDER BY ordinal_position
    `);
    console.log(`\n✓ mock_trades has ${tableCheck.rows.length} columns`);
    
    const criticalColumns = ['account_id', 'signal_id', 'trailing_stop_pct', 'highest_price', 'lowest_price', 'exit_at', 'closed_at'];
    const foundColumns = tableCheck.rows.map(r => r.column_name);
    const missingColumns = criticalColumns.filter(c => !foundColumns.includes(c));
    
    if (missingColumns.length > 0) {
      console.log(`⚠ Missing critical columns: ${missingColumns.join(', ')}`);
    } else {
      console.log('✓ All critical columns present');
    }

    console.log('\n🎉 TRADER FIX DEPLOYMENT COMPLETE');
    console.log('The trading system can now be safely restarted.');

  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    if (err.message.includes('password authentication failed')) {
      console.error('\nThe DB_PASSWORD is incorrect. Copy the password from your Supabase Connection String.');
      console.error('Location: Supabase Dashboard → Project Settings → Database → Connection String');
    }
    if (err.message.includes('connect ETIMEDOUT') || err.message.includes('ECONNREFUSED')) {
      console.error('\nCannot reach Supabase DB. Check your network or if IPv6 is required.');
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
