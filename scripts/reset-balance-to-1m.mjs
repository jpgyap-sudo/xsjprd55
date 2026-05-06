// Reset execution account balance to $1,000,000
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data: accounts, error: qErr } = await supabase
    .from('mock_accounts')
    .select('id, current_balance, name')
    .eq('name', 'Execution Optimizer v3');

  if (qErr) {
    console.error('Query error:', qErr.message);
    process.exit(1);
  }

  if (!accounts || accounts.length === 0) {
    console.log('No account found with name "Execution Optimizer v3"');
    process.exit(0);
  }

  const acct = accounts[0];
  console.log(`Account: ${acct.name} (${acct.id})`);
  console.log(`Current balance: $${Number(acct.current_balance).toLocaleString()}`);

  const { error: uErr } = await supabase
    .from('mock_accounts')
    .update({
      current_balance: 1_000_000,
      peak_balance: 1_000_000,
      realized_pnl: 0,
    })
    .eq('id', acct.id);

  if (uErr) {
    console.error('Update error:', uErr.message);
    process.exit(1);
  }

  console.log('✅ Balance reset to $1,000,000');
  process.exit(0);
}

main();
