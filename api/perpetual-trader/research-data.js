// ============================================================
// API: Perpetual Trader — Research Data Export
// GET /api/perpetual-trader/research-data
// Returns aggregated trade data for the Research Agent to learn from.
// Includes strategy performance, what worked/failed, and raw trade data.
// ============================================================

import { getResearchData } from '../../lib/perpetual-trader/trade-history.js';
import { logger } from '../../lib/logger.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { strategy, symbol, limit = '500' } = req.query;
    const limitNum = Math.min(parseInt(limit, 10) || 500, 2000);

    const result = await getResearchData({
      strategy: strategy || undefined,
      symbol: symbol ? symbol.toUpperCase() : undefined,
      limit: limitNum,
    });

    if (!result.ok) {
      return res.status(500).json({ ok: false, error: result.error });
    }

    return res.status(200).json({
      ok: true,
      ...result,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`[perp-research-data] Error: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
