// ============================================================
// Run SQL against Supabase Postgres via direct connection
// Usage: DB_PASSWORD="your-password" node scripts/run-sql-supabase.mjs
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

  const sqlPath = join(__dirname, '..', 'supabase', 'create-missing-tables.sql');
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
    console.log('Connected. Executing SQL...');
    await client.query(sql);
    console.log('SQL executed successfully.');

    // Verify tables exist
    const res = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('product_features', 'deploy_history')
    `);
    console.log('\nVerified tables:');
    for (const row of res.rows) {
      console.log(`  ✓ ${row.table_name}`);
    }
    if (res.rows.length < 2) {
      console.warn('  ⚠ Expected product_features and deploy_history — some tables may be missing.');
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    if (err.message.includes('password authentication failed')) {
      console.error('The DB_PASSWORD is incorrect. Copy the password from your Supabase Connection String.');
    }
    if (err.message.includes('connect ETIMEDOUT') || err.message.includes('ECONNREFUSED')) {
      console.error('Cannot reach Supabase DB. Check your network or if IPv6 is required.');
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
