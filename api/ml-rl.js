// ============================================================
// RL Decision Endpoint
// POST /api/ml-rl
// Body: { marketFeatures: {}, portfolioState: { cash, position, ... } }
// ============================================================

import { getRlDecision } from '../lib/ml/ml-client.js';

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // For GET requests, use query params or defaults
    const marketFeatures = req.body?.marketFeatures || req.body?.market_features || {};
    const portfolioState = req.body?.portfolioState || req.body?.portfolio_state || {
      cash: 10000,
      position: 0,
      unrealized_pnl: 0,
      drawdown: 0,
    };

    const result = await getRlDecision(marketFeatures, portfolioState);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    // getRlDecision already has fallback logic, but if it still throws,
    // return a graceful fallback instead of 500
    return res.status(200).json({
      ok: true,
      action: 'HOLD',
      confidence: 0.5,
      reason: `ML service unavailable, fallback: ${err.message}`,
      suggested_position_size: 0,
      source: 'api_fallback'
    });
  }
}
