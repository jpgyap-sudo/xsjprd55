// One-time migration: create perpetual trader tables in Supabase
// Run from VPS: node scripts/run-perp-migration.cjs
// Requires DATABASE_URL env var (get from Supabase → Connect → URI)
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL env var not set.');
  console.error('Get it from: Supabase Dashboard → Project → Settings → Database → Connection string → URI');
  console.error('Then run: DATABASE_URL="postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres" node scripts/run-perp-migration.cjs');
  process.exit(1);
}

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'perpetual-trader-history-schema.sql'), 'utf8');

async function run() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log('Connected to database.');
    await client.query(sql);
    console.log('✅ Perpetual trader schema created successfully.');
    const res = await client.query("SELECT name, current_balance, trading_enabled FROM perpetual_mock_accounts LIMIT 1");
    console.log('Account:', res.rows[0]);
  } catch (e) {
    console.error('❌ Migration failed:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
