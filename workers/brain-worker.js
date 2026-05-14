// ============================================================
// Brain Worker — Periodically scans configured symbols/timeframes
// and runs the Trading Central Brain pipeline.
// ============================================================

import 'dotenv/config';
import { runTradingBrain } from '../lib/brain/brain-router.js';

const INTERVAL_MS = parseInt(process.env.BRAIN_SCAN_INTERVAL_MS || '300000', 10); // 5 min default
const SYMBOLS = (process.env.BRAIN_SYMBOLS || 'BTCUSDT,ETHUSDT').split(',').map(s => s.trim()).filter(Boolean);
const TIMEFRAMES = (process.env.BRAIN_TIMEFRAMES || '15m,1h,4h').split(',').map(t => t.trim()).filter(Boolean);
const MODE = process.env.BRAIN_LIVE_MODE === 'true' ? 'live' : 'paper';

console.log(`[brain-worker] Starting — interval=${INTERVAL_MS}ms symbols=${SYMBOLS.join(',')} timeframes=${TIMEFRAMES.join(',')} mode=${MODE}`);

async function tick() {
  for (const symbol of SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      try {
        const decision = await runTradingBrain({ symbol, timeframe, mode: MODE });
        console.log(`[brain-worker] ${symbol} ${timeframe}: ${decision.side} @ ${decision.confidence} — ${decision.risk_verdict}`);
      } catch (err) {
        console.error(`[brain-worker] Error on ${symbol} ${timeframe}:`, err.message);
      }
    }
  }
}

// Run immediately, then on interval
tick();
setInterval(tick, INTERVAL_MS);
