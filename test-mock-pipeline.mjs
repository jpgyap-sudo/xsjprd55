import { createClient } from '@supabase/supabase-js';
import './lib/env.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_KEY');
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const now = new Date().toISOString();

// 1. Check fresh signals
const { data: signals, error: sErr } = await sb
  .from('signals')
  .select('*')
  .eq('status', 'active')
  .gt('valid_until', now)
  .order('generated_at', { ascending: false })
  .limit(10);

console.log('=== Fresh signals ===');
console.log('Count:', signals?.length || 0);
if (sErr) console.log('Error:', sErr.message);
(signals || []).forEach(s => console.log(`  ${s.symbol} ${s.side} $${s.entry_price} valid_until=${s.valid_until}`));

// 2. Check existing mock_trades
const { data: trades, error: tErr } = await sb
  .from('mock_trades')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(5);

console.log('\n=== Existing mock_trades ===');
console.log('Count:', trades?.length || 0);
if (tErr) console.log('Error:', tErr.message);
(trades || []).forEach(t => console.log(`  ${t.symbol} ${t.side} status=${t.status}`));

// 3. Check mock_accounts
const { data: account, error: aErr } = await sb
  .from('mock_accounts')
  .select('*')
  .limit(1)
  .maybeSingle();

console.log('\n=== Mock account ===');
if (account) {
  console.log('Found:', account.name, `balance=$${account.current_balance || account.balance}`);
} else if (aErr) {
  console.log('Error:', aErr.message);
} else {
  console.log('No account found');
}

// 4. Check signal_feature_scores
const { data: scores, error: scErr } = await sb
  .from('signal_feature_scores')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(5);

console.log('\n=== signal_feature_scores ===');
console.log('Count:', scores?.length || 0);
if (scErr) console.log('Error:', scErr.message);
(scores || []).forEach(sc => console.log(`  signal_id=${sc.signal_id} prob=${sc.final_probability}`));

// 5. Try inserting a test mock_trade directly
if (signals?.length > 0 && !trades?.length) {
  const sig = signals[0];
  console.log('\n=== Attempting direct mock_trade insert ===');
  const { data: inserted, error: iErr } = await sb
    .from('mock_trades')
    .insert({
      signal_id: sig.id,
      symbol: sig.symbol,
      side: (sig.side || '').toLowerCase(),
      entry_price: sig.entry_price,
      stop_loss: sig.stop_loss,
      take_profit: Array.isArray(sig.take_profit) ? sig.take_profit[0] : sig.take_profit,
      quantity: 0.1,
      leverage: 2,
      status: 'open',
      mode: 'paper',
      metadata: { test_injected: true }
    })
    .select()
    .single();
  
  if (iErr) {
    console.log('INSERT FAILED:', iErr.message, iErr.details || '', iErr.code || '');
  } else {
    console.log('INSERT SUCCESS:', inserted.id, inserted.symbol, inserted.side);
  }
}
