// ============================================================
// ML Signal Snapshot Logger — xsjprd55
// Records every signal into the local SQLite for model training.
// ============================================================

import { db } from './db.js';
import { buildFeatures, vectorize } from './features.js';
import { predictMlProbability } from './model.js';

/**
 * Log a signal snapshot for later ML training / backtesting.
 * @param {import('./features.js').MarketRawInput} input
 * @param {Object} rationale
 * @param {number} [ruleProbability] 0..1 base probability from rule engine
 * @returns {{snapshotId:number, mlProbability:number|null, finalProbability:number}}
 */
export function logSignalSnapshot(input, rationale, ruleProbability = 0.5) {
  const features = buildFeatures(input);
  const mlProbability = predictMlProbability(features);
  const finalProbability = mlProbability !== null
    ? Number(((ruleProbability * 0.4) + (mlProbability * 0.6)).toFixed(4))
    : ruleProbability;

  const result = db.prepare(`
    INSERT INTO signal_snapshots
      (created_at, symbol, timeframe, price, signal_side, rule_probability, ml_probability, final_probability, features_json, rationale_json)
    VALUES
      (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.symbol || 'UNKNOWN',
    input.timeframe || '1h',
    input.price || 0,
    input.side || 'LONG',
    ruleProbability,
    mlProbability,
    finalProbability,
    JSON.stringify(features),
    JSON.stringify(rationale || {})
  );

  return {
    snapshotId: Number(result.lastInsertRowid),
    mlProbability,
    finalProbability,
  };
}

/**
 * Quick helper to log a prediction result without saving full snapshot.
 * @param {number} snapshotId
 * @param {number} mlProbability
 */
export function logMlPredict(snapshotId, mlProbability) {
  db.prepare(`
    UPDATE signal_snapshots
    SET ml_probability = ?
    WHERE id = ?
  `).run(mlProbability, snapshotId);
}
