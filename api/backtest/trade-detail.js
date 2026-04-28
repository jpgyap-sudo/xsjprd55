// ============================================================
// Backtest Trade Detail API
// GET /api/backtest/trade-detail?id=<tradeId>
// Returns full details for a single backtest trade.
// ============================================================

import { supabase } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tradeId = req.query?.id;
  if (!tradeId) return res.status(400).json({ error: 'Missing trade id' });

  try {
    const { data, error } = await supabase
      .from('backtest_trades')
      .select('*')
      .eq('id', tradeId)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  } catch (err) {
    logger.error(`[BACKTEST-TRADE-DETAIL] ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
