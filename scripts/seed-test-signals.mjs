// ============================================================
// Seed Test Signals - Injects test signals for trading
// Run: node scripts/seed-test-signals.mjs
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import '../lib/env.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Set these environment variables in your .env file');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const TEST_SIGNALS = [
  {
    symbol: 'BTCUSDT',
    side: 'LONG',
    entry_price: 65000,
    stop_loss: 64000,
    take_profit: [67000, 69000],
    confidence: 0.75,
    strategy: 'EMA_Cross_15m',
    timeframe: '15m',
  },
  {
    symbol: 'ETHUSDT',
    side: 'SHORT',
    entry_price: 3500,
    stop_loss: 3600,
    take_profit: [3300, 3200],
    confidence: 0.72,
    strategy: 'RSI_Bounce',
    timeframe: '1h',
  },
  {
    symbol: 'SOLUSDT',
    side: 'LONG',
    entry_price: 145,
    stop_loss: 140,
    take_profit: [155, 165],
    confidence: 0.68,
    strategy: 'Momentum_EMA20',
    timeframe: '15m',
  },
  {
    symbol: 'BNBUSDT',
    side: 'LONG',
    entry_price: 590,
    stop_loss: 575,
    take_profit: [610, 630],
    confidence: 0.70,
    strategy: 'EMA_Cross_15m',
    timeframe: '15m',
  },
  {
    symbol: 'XRPUSDT',
    side: 'SHORT',
    entry_price: 0.62,
    stop_loss: 0.64,
    take_profit: [0.58, 0.55],
    confidence: 0.65,
    strategy: 'Volume_Breakout',
    timeframe: '1h',
  },
];

async function seedSignals() {
  console.log('🌱 Seeding test signals...\n');
  
  const now = new Date();
  const validUntil = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours validity
  
  const signalsToInsert = TEST_SIGNALS.map(s => ({
    id: uuidv4(),
    symbol: s.symbol,
    side: s.side,
    entry_price: s.entry_price,
    stop_loss: s.stop_loss,
    take_profit: s.take_profit,
    confidence: s.confidence,
    strategy: s.strategy,
    timeframe: s.timeframe,
    source: 'test_seeder',
    mode: 'paper',
    status: 'active',
    generated_at: now.toISOString(),
    valid_until: validUntil.toISOString(),
    metadata: { seeded: true, seed_time: now.toISOString() }
  }));
  
  const { data, error } = await supabase
    .from('signals')
    .insert(signalsToInsert)
    .select();
  
  if (error) {
    console.error('❌ Failed to seed signals:', error.message);
    process.exit(1);
  }
  
  console.log(`✅ Seeded ${data.length} test signals:\n`);
  data.forEach(s => {
    console.log(`  📊 ${s.symbol} ${s.side}`);
    console.log(`     Entry: $${s.entry_price} | SL: $${s.stop_loss} | TP: $${s.take_profit?.join(', $')}`);
    console.log(`     Confidence: ${(s.confidence * 100).toFixed(0)}% | Strategy: ${s.strategy}`);
    console.log(`     Valid until: ${s.valid_until}\n`);
  });
}

async function checkExisting() {
  const { count, error } = await supabase
    .from('signals')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');
  
  if (error) {
    console.error('❌ Failed to check existing signals:', error.message);
    return 0;
  }
  
  return count || 0;
}

async function main() {
  console.log('🔍 Checking existing signals...');
  const existingCount = await checkExisting();
  console.log(`   Found ${existingCount} existing active signals\n`);
  
  if (existingCount > 0) {
    console.log('⚠️  There are already active signals in the database.');
    console.log('   The trader should be processing them.\n');
  }
  
  await seedSignals();
  
  console.log('\n📋 Next steps:');
  console.log('   1. Check if execution-worker is running: pm2 status');
  console.log('   2. Check worker logs: pm2 logs execution-worker');
  console.log('   3. View trades: SELECT * FROM mock_trades;');
  console.log('   4. View dashboard: http://your-domain/api/mock-trading-dashboard');
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
