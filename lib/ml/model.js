// ============================================================
// ML Random Forest Model — xsjprd55 ML Loop
// Trains on labeled signal snapshots; predicts probability.
// ============================================================

import { RandomForestClassifier } from 'ml-random-forest';
import { db } from './db.js';
import { FEATURE_NAMES, vectorize } from './features.js';

/**
 * @typedef {Object} ActiveModel
 * @property {string} modelName
 * @property {string} version
 * @property {RandomForestClassifier} classifier
 * @property {string[]} featureNames
 * @property {Object} metrics
 */

/**
 * Train a new model on labeled signal snapshots.
 * @returns {{modelName:string, version:string, metrics:Object}}
 */
export function trainModel() {
  const rows = db.prepare(`
    SELECT features_json, outcome_label
    FROM signal_snapshots
    WHERE outcome_label IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 5000
  `).all();

  if (rows.length < 100) {
    throw new Error(`Need at least 100 labeled samples, have ${rows.length}`);
  }

  const X = [];
  const y = [];

  for (const row of rows) {
    const feats = JSON.parse(row.features_json);
    const vec = vectorize(feats);
    if (vec.some((v) => !Number.isFinite(v))) continue;
    X.push(vec);
    y.push(row.outcome_label);
  }

  if (X.length < 100) {
    throw new Error(`Only ${X.length} valid vectors after filtering NaN`);
  }

  const classifier = new RandomForestClassifier({
    seed: 42,
    maxFeatures: 0.8,
    replacement: true,
    nEstimators: 80,
    treeOptions: { maxDepth: 12, minNumSamples: 5 },
  });

  classifier.train(X, y);

  // Simple accuracy on training set
  let correct = 0;
  for (let i = 0; i < X.length; i++) {
    const pred = classifier.predict([X[i]]);
    if (pred[0] === y[i]) correct++;
  }
  const accuracy = Number((correct / X.length).toFixed(4));

  const modelName = `rf-${new Date().toISOString().slice(0, 10)}`;
  const version = `${Date.now()}`;
  const metrics = { accuracy, samples: X.length, features: FEATURE_NAMES.length };

  // Persist to DB
  const tx = db.transaction(() => {
    db.prepare(`UPDATE ml_models SET is_active = 0 WHERE is_active = 1`).run();
    db.prepare(`
      INSERT INTO ml_models (created_at, model_name, version, feature_names_json, model_json, metrics_json, is_active)
      VALUES (datetime('now'), ?, ?, ?, ?, ?, 1)
    `).run(
      modelName,
      version,
      JSON.stringify(FEATURE_NAMES),
      JSON.stringify(classifier.toJSON ? classifier.toJSON() : {}),
      JSON.stringify(metrics)
    );
  });
  tx();

  return { modelName, version, metrics };
}

/**
 * Load the most recently trained active model.
 * @returns {ActiveModel|null}
 */
export function loadActiveModel() {
  try {
    const row = db.prepare(`
      SELECT model_name, version, feature_names_json, model_json, metrics_json
      FROM ml_models
      WHERE is_active = 1
      ORDER BY created_at DESC
      LIMIT 1
    `).get();

    if (!row) return null;

    let featureNames = [];
    try { featureNames = JSON.parse(row.feature_names_json); } catch { featureNames = []; }

    const classifier = new RandomForestClassifier();
    let modelLoaded = false;
    try {
      const parsed = JSON.parse(row.model_json);
      if (parsed && Object.keys(parsed).length > 0) {
        classifier.fromJSON(parsed);
        modelLoaded = true;
      }
    } catch (e) {
      logger.warn(`[MODEL] Failed to deserialize model JSON: ${e.message}`);
    }

    let metrics = {};
    try { metrics = JSON.parse(row.metrics_json); } catch { metrics = {}; }

    if (!modelLoaded) {
      logger.warn('[MODEL] Loaded model record but classifier could not be restored from JSON');
      return null;
    }

    return {
      modelName: row.model_name,
      version: row.version,
      classifier,
      featureNames,
      metrics,
    };
  } catch (e) {
    logger.warn(`[MODEL] Failed to load active model: ${e.message}`);
    return null;
  }
}

/**
 * Predict win probability from feature vector.
 * @param {Record<string, number>} features
 * @returns {number|null} 0..1 probability, or null if no model
 */
export function predictMlProbability(features) {
  const model = loadActiveModel();
  if (!model) return null;

  const vec = vectorize(features);
  if (vec.some((v) => !Number.isFinite(v))) return null;

  try {
    const probs = model.classifier.predictProbability([vec]);
    if (probs && probs[0] && probs[0].length >= 2) {
      return Number(probs[0][1].toFixed(4)); // probability of class 1 (win)
    }
  } catch {
    // Model may not support probability
  }

  try {
    const pred = model.classifier.predict([vec]);
    return pred[0] === 1 ? 0.75 : 0.25;
  } catch {
    return null;
  }
}
