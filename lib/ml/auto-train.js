// ============================================================
// ML Auto-Train — Seeds synthetic labeled data when no model exists
// Uses mock trade history + heuristic rules to bootstrap the RF model.
// Called on startup if signal_snapshots table has < 100 labeled rows.
// ============================================================

import { db } from './db.js';
import { vectorize } from './features.js';
import { trainModel } from './model.js';
import { logger } from '../logger.js';

const MIN_SAMPLES = 100;

/**
 * Generate synthetic labeled snapshots from simple heuristic rules.
 * These are NOT retrofitted — they're based on well-known market microstructure.
 */
function generateSyntheticSamples(count = 200) {
  const samples = [];
  const sides = ['LONG', 'SHORT'];
  const symbols = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','LTCUSDT'];

  for (let i = 0; i < count; i++) {
    const side = sides[i % 2];
    const symbol = symbols[i % symbols.length];
    const rsi = 20 + Math.random() * 60; // 20-80
    const funding = (Math.random() - 0.5) * 0.1; // -0.05 to +0.05
    const oiChange = (Math.random() - 0.5) * 20; // -10% to +10%
    const volSpike = 0.5 + Math.random() * 3; // 0.5x to 3.5x
    const liqImbalance = (Math.random() - 0.5) * 2; // -1 to +1
    const sentiment = (Math.random() - 0.5) * 2; // -1 to +1
    const priceChange24h = (Math.random() - 0.5) * 10; // -5% to +5%

    // Heuristic: mean-reversion + funding alignment
    let winProb = 0.5;
    if (side === 'LONG') {
      winProb += (rsi < 35 ? 0.15 : 0);
      winProb += (funding < -0.01 ? 0.1 : 0);
      winProb += (sentiment > 0.3 ? 0.08 : 0);
      winProb += (priceChange24h < -3 ? 0.1 : 0); // bounce after drop
    } else {
      winProb += (rsi > 65 ? 0.15 : 0);
      winProb += (funding > 0.01 ? 0.1 : 0);
      winProb += (sentiment < -0.3 ? 0.08 : 0);
      winProb += (priceChange24h > 3 ? 0.1 : 0); // pullback after rally
    }
    winProb += (volSpike > 2 ? 0.05 : 0);
    winProb += (Math.abs(oiChange) > 8 ? 0.05 : 0);
    winProb = Math.max(0.1, Math.min(0.9, winProb));

    const outcome = Math.random() < winProb ? 1 : 0;

    const features = {
      rsi,
      ema9Dist: (Math.random() - 0.5) * 4,
      ema21Dist: (Math.random() - 0.5) * 6,
      volumeSpike: volSpike,
      fundingRate: funding,
      oiChangePct: oiChange,
      liqImbalance: liqImbalance,
      socialSentiment: sentiment,
      newsSentiment: sentiment * 0.8,
      volatility24h: Math.abs(priceChange24h),
      btcDominance: 50 + Math.random() * 10,
      fearGreed: 30 + Math.random() * 40,
      side: side === 'LONG' ? 1 : 0,
    };

    samples.push({
      created_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      symbol,
      timeframe: ['15m', '1h', '4h'][i % 3],
      price: 50000 + Math.random() * 50000,
      signal_side: side,
      rule_probability: 0.5 + Math.random() * 0.3,
      ml_probability: null,
      final_probability: winProb,
      features_json: JSON.stringify(features),
      rationale_json: JSON.stringify({ source: 'synthetic_seed', reason: 'auto_train_bootstrap' }),
      outcome_label: outcome,
      outcome_return_pct: outcome === 1 ? 1 + Math.random() * 4 : -(0.5 + Math.random() * 2),
      outcome_checked_at: new Date().toISOString(),
    });
  }
  return samples;
}

/**
 * Check if we need to seed data, then train.
 * @returns {Promise<{seeded: number, trained: boolean, metrics?: object}>}
 */
export async function autoTrainIfNeeded() {
  const countRow = db.prepare('SELECT COUNT(*) as c FROM signal_snapshots WHERE outcome_label IS NOT NULL').get();
  const existing = countRow.c;

  if (existing >= MIN_SAMPLES) {
    logger.info(`[AUTO-TRAIN] ${existing} labeled samples exist — no seed needed`);
    return { seeded: 0, trained: false };
  }

  logger.info(`[AUTO-TRAIN] Only ${existing} labeled samples — seeding synthetic data…`);

  const samples = generateSyntheticSamples(Math.max(200, MIN_SAMPLES - existing));
  const insert = db.prepare(`
    INSERT INTO signal_snapshots (
      created_at, symbol, timeframe, price, signal_side, rule_probability,
      ml_probability, final_probability, features_json, rationale_json,
      outcome_label, outcome_return_pct, outcome_checked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows) => {
    for (const r of rows) insert.run(
      r.created_at, r.symbol, r.timeframe, r.price, r.signal_side, r.rule_probability,
      r.ml_probability, r.final_probability, r.features_json, r.rationale_json,
      r.outcome_label, r.outcome_return_pct, r.outcome_checked_at
    );
  });
  tx(samples);

  logger.info(`[AUTO-TRAIN] Seeded ${samples.length} synthetic samples`);

  try {
    const result = trainModel();
    logger.info(`[AUTO-TRAIN] Model trained — accuracy=${result.metrics.accuracy}, samples=${result.metrics.samples}`);
    return { seeded: samples.length, trained: true, metrics: result.metrics };
  } catch (e) {
    logger.error('[AUTO-TRAIN] Training failed:', e.message);
    return { seeded: samples.length, trained: false, error: e.message };
  }
}
