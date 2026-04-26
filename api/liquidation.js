// ============================================================
// GET /api/liquidation
// Multi-exchange liquidation intelligence endpoint
// Returns aggregated OI, funding, and squeeze signals
// Cache: 60s stale-while-revalidate
// ============================================================

import { buildLiquidationOverview } from '../lib/liquidation.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = await buildLiquidationOverview();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(data);
  } catch (e) {
    console.error('[liquidation]', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
