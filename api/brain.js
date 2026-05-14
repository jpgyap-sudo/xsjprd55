// ============================================================
// Trading Central Brain API — Express router
// Auto-mounted by server.js at /api/brain
// Endpoints:
//   GET  /api/brain/health    — Brain health check
//   POST /api/brain/signal    — Run brain for a symbol+timeframe
//   POST /api/brain/learn     — Run learning cycle
// ============================================================

import { Router } from 'express';
import { runTradingBrain } from '../lib/brain/brain-router.js';
import { runLearningCycle } from '../lib/brain/learning-engine.js';
import { checkSupabaseHealth } from '../lib/supabase.js';

const router = Router();

/**
 * GET /api/brain/health
 * Returns the health status of the brain and its dependencies.
 */
router.get('/health', async (req, res) => {
  const dbHealth = await checkSupabaseHealth();
  res.json({
    ok: true,
    brain: 'active',
    supabase: dbHealth.ok ? 'connected' : 'disconnected',
    supabase_error: dbHealth.error || null,
    mode: process.env.BRAIN_LIVE_MODE === 'true' ? 'live' : 'paper',
    scan_interval_ms: parseInt(process.env.BRAIN_SCAN_INTERVAL_MS || '300000', 10),
    symbols: (process.env.BRAIN_SYMBOLS || 'BTCUSDT,ETHUSDT').split(','),
    timeframes: (process.env.BRAIN_TIMEFRAMES || '15m,1h,4h').split(','),
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/brain/signal
 * Runs the full brain pipeline for a given symbol+timeframe.
 * Body: { symbol, timeframe, mode }
 */
router.post('/signal', async (req, res) => {
  try {
    const { symbol, timeframe, mode } = req.body || {};
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });

    const decision = await runTradingBrain({ symbol, timeframe, mode });
    res.json({ ok: true, decision });
  } catch (err) {
    console.error('[brain-api] /signal error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/learn
 * Runs the learning cycle to analyze past signals and generate suggestions.
 */
router.post('/learn', async (req, res) => {
  try {
    const result = await runLearningCycle();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[brain-api] /learn error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
