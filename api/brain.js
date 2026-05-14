// ============================================================
// Trading Central Brain API
// Auto-mounted by server.js at /api/brain
// Endpoints:
//   GET  /api/brain/health    — Brain health check
//   POST /api/brain/signal    — Run brain for a symbol+timeframe
//   POST /api/brain/learn     — Run learning cycle
// ============================================================

import { runTradingBrain } from '../lib/brain/brain-router.js';
import { runLearningCycle } from '../lib/brain/learning-engine.js';
import { checkSupabaseHealth } from '../lib/supabase.js';

/**
 * GET /api/brain/health
 * Returns the health status of the brain and its dependencies.
 */
async function handleHealth(req, res) {
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
}

/**
 * POST /api/brain/signal
 * Runs the full brain pipeline for a given symbol+timeframe.
 * Body: { symbol, timeframe, mode }
 */
async function handleSignal(req, res) {
  try {
    const { symbol, timeframe, mode } = req.body || {};
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });

    const decision = await runTradingBrain({ symbol, timeframe, mode });
    res.json({ ok: true, decision });
  } catch (err) {
    console.error('[brain-api] /signal error:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/brain/learn
 * Runs the learning cycle to analyze past signals and generate suggestions.
 */
async function handleLearn(req, res) {
  try {
    const result = await runLearningCycle();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[brain-api] /learn error:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Main handler — routes based on URL path and HTTP method.
 * Since server.js uses app.all(route, handler), we parse the sub-path manually.
 */
export default async function handler(req, res) {
  // The req.url will be something like /api/brain/health or /api/brain/signal
  // Extract the sub-path after /api/brain
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const subPath = url.pathname.replace(/^\/api\/brain\/?/, '').replace(/\/$/, '');

  if (subPath === 'health' || subPath === '') {
    if (req.method === 'GET') {
      return handleHealth(req, res);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (subPath === 'signal') {
    if (req.method === 'POST') {
      return handleSignal(req, res);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (subPath === 'learn') {
    if (req.method === 'POST') {
      return handleLearn(req, res);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(404).json({ error: `Unknown brain endpoint: /${subPath}` });
}
