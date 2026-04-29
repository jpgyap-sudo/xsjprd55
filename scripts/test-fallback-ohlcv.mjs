// ============================================================
// Quick test: fetchOHLCV fallback (no API keys needed)
// ============================================================

import { fetchOHLCV } from '../lib/exchange.js';

async function test() {
  console.log('Testing fetchOHLCV fallback...');
  try {
    const data = await fetchOHLCV('binance', 'BTC/USDT', '1h', 10);
    console.log('✅ Success:', data.length, 'candles');
    console.log('First candle:', data[0]);
    console.log('Last candle:', data[data.length - 1]);
  } catch (e) {
    console.error('❌ Failed:', e.message);
    process.exit(1);
  }
}

test();
