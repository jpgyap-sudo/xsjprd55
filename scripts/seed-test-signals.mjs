import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.prod' });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const now = new Date().toISOString();
const signals = [
  {
    symbol: 'BTCUSDT',
    side: 'LONG',
    entry_price: 65000,
    stop_loss: 64000,
    take_profit: [67000, 69000],
    confidence: 0.72,
    strategy: 'EMA_Cross_15m',
    timeframe: '15m',
    generated_at: now,
    valid_until: new Date(Date.now() + 3600000).toISOString(),
    source: 'binance_futures',
    mode: 'paper',
    status: 'active',
    metadata: { injected: true, test_signal: true }
  },
  {
    symbol: 'ETHUSDT',
    side: 'SHORT',
    entry_price: 3200,
    stop_loss: 3280,
    take_profit: [3100, 3000],
    confidence: 0.68,
    strategy: 'RSI_Bounce_15m',
    timeframe: '15m',
    generated_at: now,
    valid_until: new Date(Date.now() + 3600000).toISOString(),
    source: 'binance_futures',
    mode: 'paper',
    status: 'active',
    metadata: { injected: true, test_signal: true }
  }
];

const { data, error } = await sb.from('signals').insert(signals).select();
if (error) {
  console.error('INSERT ERROR:', error.message, error.details);
  process.exit(1);
}
console.log('✅ INSERTED', data.length, 'signals:', data.map(s => s.symbol + ' ' + s.side + ' $' + s.entry_price).join(', '));
