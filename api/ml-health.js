// ============================================================
// ML Service Health & Pipeline Status
// GET /api/ml-health
// Returns health of the ML service AND the local ML pipeline
// (SQLite DB, model state, feature extraction, backtest engine).
// ============================================================

import { getMlHealth } from '../lib/ml/ml-client.js';
import { initMlDb } from '../lib/ml/db.js';
import { loadActiveModel } from '../lib/ml/model.js';
import { getRecentBacktests } from '../lib/ml/supabase-db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ── External ML service health ──────────────────────────
    const mlServiceHealth = await getMlHealth();

    // ── Local SQLite DB health ──────────────────────────────
    let dbOk = false;
    let dbTables = [];
    let dbError = null;
    try {
      const db = initMlDb();
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all();
      dbTables = tables.map(t => t.name);
      dbOk = true;
    } catch (e) {
      dbError = e.message;
    }

    // ── Local ML model state ────────────────────────────────
    let modelState = null;
    try {
      modelState = loadActiveModel();
    } catch (e) {
      modelState = { error: e.message };
    }

    // ── Recent backtest activity ────────────────────────────
    let recentBacktests = [];
    try {
      recentBacktests = await getRecentBacktests(5);
    } catch (e) {
      // Silently ignore — Supabase may not have the table
    }

    return res.status(200).json({
      ok: true,
      mlService: mlServiceHealth,
      pipeline: {
        sqlite: {
          ok: dbOk,
          tables: dbTables,
          error: dbError,
        },
        model: modelState
          ? { ok: true, trained: !!modelState.model, features: modelState.featureNames }
          : { ok: false, trained: false },
        recentBacktests: recentBacktests.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      service: 'xsjprd55-ml-pipeline',
      error: err.message,
    });
  }
}
