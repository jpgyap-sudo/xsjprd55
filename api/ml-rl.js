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
    return res.status(500).json({ ok: false, error: err.message });
  }
}
