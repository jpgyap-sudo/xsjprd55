// Push AI Consultant migration to Supabase via Management API
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env
const envPath = resolve(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf8');
const getEnv = (key) => {
  const m = envContent.match(new RegExp(`^${key}=(.+)`, 'm'));
  return m ? m[1].trim() : null;
};

const SUPABASE_URL = getEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

console.log('Supabase URL:', SUPABASE_URL);
console.log('Service role key present:', !!SUPABASE_SERVICE_ROLE_KEY);

// Read migration SQL
const sqlPath = resolve(__dirname, '..', 'supabase', 'migrations', '20260515_ai_consultant_mode.sql');
const sql = readFileSync(sqlPath, 'utf8');

console.log(`Migration SQL length: ${sql.length} chars`);

// Create Supabase client with service role key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // Split SQL into individual statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`Found ${statements.length} SQL statements to execute`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      console.log(`\n[${i + 1}/${statements.length}] Executing...`);
      console.log(`  ${stmt.substring(0, 100)}...`);

      const { error } = await supabase.rpc('exec_sql', { sql: stmt + ';' });

      if (error) {
        // Try direct query instead
        console.log(`  rpc failed, trying direct query...`);
        const { error: queryError } = await supabase
          .from('_sql_exec')
          .select('*')
          .limit(1);

        if (queryError && queryError.message?.includes('relation') || queryError?.message?.includes('does not exist')) {
          // Try raw SQL via the management API
          console.log(`  Direct query approach not available, trying REST...`);
          
          const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({})
          });
          
          // Fallback: try the SQL endpoint directly
          const sqlResponse = await fetch(`${SUPABASE_URL}/rest/v1/`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'Prefer': 'params=single-object'
            },
            body: JSON.stringify({ query: stmt + ';' })
          });
          
          console.log(`  SQL endpoint status: ${sqlResponse.status}`);
          const text = await sqlResponse.text();
          console.log(`  Response: ${text.substring(0, 200)}`);
          
          if (sqlResponse.ok) {
            successCount++;
          } else {
            failCount++;
            console.error(`  FAILED: ${text.substring(0, 300)}`);
          }
        } else {
          failCount++;
          console.error(`  FAILED: ${error.message}`);
        }
      } else {
        successCount++;
        console.log(`  OK`);
      }
    } catch (err) {
      failCount++;
      console.error(`  ERROR: ${err.message}`);
    }
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`Success: ${successCount}, Failed: ${failCount}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
