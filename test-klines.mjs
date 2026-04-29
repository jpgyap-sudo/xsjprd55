import { fetchBinanceKlines } from './lib/crawler-ohlcv.js';
try {
  const d = await fetchBinanceKlines('BTC/USDT', '15m', 5);
  console.log('OK', d.length, d[0]);
} catch(e) {
  console.log('ERR', e.message);
}
