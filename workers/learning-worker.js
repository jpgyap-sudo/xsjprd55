// ============================================================
// Learning Worker — Periodically runs the brain learning cycle
// to analyze past signals and generate strategy suggestions.
// ============================================================

import 'dotenv/config';
import { runLearningCycle } from '../lib/brain/learning-engine.js';

const INTERVAL_MS = parseInt(process.env.BRAIN_LEARNING_INTERVAL_MS || '86400000', 10); // 24h default

console.log(`[learning-worker] Starting — interval=${INTERVAL_MS}ms`);

async function tick() {
  try {
    const result = await runLearningCycle();
    if (result.ok) {
      console.log(`[learning-worker] Cycle complete — ${result.reports?.length || 0} reports generated`);
      if (result.reports?.[0]?.summary) {
        const s = result.reports[0].summary;
        console.log(`[learning-worker] Summary: ${s.total_signals_analyzed} signals, ${s.strategies_to_review} strategies need review`);
      }
    } else {
      console.error('[learning-worker] Cycle failed:', result.error);
    }
  } catch (err) {
    console.error('[learning-worker] Error:', err.message);
  }
}

// Run immediately, then on interval
tick();
setInterval(tick, INTERVAL_MS);
