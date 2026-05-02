// Run SQL file via Supabase REST API (avoids IPv6 pg connection issues)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nqcgnwpfxnbtdrvtkwej.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const sqlFile = process.argv[2] || join(__dirname, '..', 'supabase', 'mock-trade-history.sql');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function run() {
  const sql = readFileSync(sqlFile, 'utf-8');
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    const full = stmt + ';';
    try {
      const { error } = await supabase.rpc('exec_sql', { query: full });
      if (error) {
        if (error.message.includes('does not exist') && full.toLowerCase().includes('drop')) {
          console.log('SKIP (expected):', full.slice(0, 60));
        } else {
          console.log('WARN:', error.message, '|', full.slice(0, 80));
        }
      } else {
        console.log('OK:', full.slice(0, 80));
      }
    } catch (e) {
      console.log('ERR:', e.message, '|', full.slice(0, 80));
    }
  }
  console.log('\nDone.');
}
run();
