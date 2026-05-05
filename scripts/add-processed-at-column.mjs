// Quick script to add processed_at column to signals table
// Run: node scripts/add-processed-at-column.mjs
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

// Try via RPC first
const { error: rpcError } = await supabase.rpc('exec_sql', {
  sql: 'ALTER TABLE signals ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;'
});

if (rpcError) {
  logger.info(`RPC not available (${rpcError.message}), trying direct insert...`);
  
  // Fallback: try to insert a dummy row with processed_at to trigger schema update
  // This won't work for ALTER TABLE, so we need another approach
  
  // Try using the Supabase management API
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (supabaseUrl && serviceKey && !supabaseUrl.includes('your-project')) {
    logger.info('Attempting direct SQL via Supabase REST API...');
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          sql: 'ALTER TABLE signals ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;'
        })
      });
      logger.info(`Response: ${response.status} ${response.statusText}`);
      const text = await response.text();
      logger.info(`Body: ${text}`);
    } catch (e) {
      logger.error(`Direct SQL failed: ${e.message}`);
    }
  } else {
    logger.error('Cannot run SQL: Supabase is in no-op mode or using placeholder credentials.');
    logger.error('Please run this SQL in the Supabase SQL Editor:');
    logger.error('  ALTER TABLE signals ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;');
    logger.error('  CREATE INDEX IF NOT EXISTS idx_signals_processed_at ON signals(processed_at) WHERE processed_at IS NULL;');
  }
} else {
  logger.info('Column added successfully via RPC!');
}

process.exit(0);
