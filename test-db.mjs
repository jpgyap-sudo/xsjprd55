import { supabase } from './lib/supabase.js';

const { data: signals, error: sErr } = await supabase
  .from('signals')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(5);

console.log('SIGNALS:', signals?.length || 0, sErr?.message || '');
if (signals?.length) console.log(JSON.stringify(signals[0], null, 2));

const { data: trades, error: tErr } = await supabase
  .from('mock_trades')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(5);

console.log('MOCK_TRADES:', trades?.length || 0, tErr?.message || '');
if (trades?.length) console.log(JSON.stringify(trades[0], null, 2));

const { data: account, error: aErr } = await supabase
  .from('mock_accounts')
  .select('*')
  .single();

console.log('ACCOUNT:', account ? `$${account.balance}` : aErr?.message || 'none');
