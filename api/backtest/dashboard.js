// ============================================================
// Backtest Dashboard API
// GET /api/backtest/dashboard
// Returns backtest runs, trades, mock account, and suggestions.
// ============================================================

import { supabase } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const [runs, trades, mock, suggestions] = await Promise.all([
      supabase.from('backtest_runs').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('backtest_trades').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('mock_accounts').select('*').limit(1).maybeSingle(),
      supabase.from('app_improvement_suggestions').select('*').order('created_at', { ascending: false }).limit(20),
    ]);

    logger.info('[BACKTEST-DASHBOARD] Served dashboard data');
    return res.status(200).json({
      runs: runs.data || [],
      trades: trades.data || [],
      mockAccount: mock.data || null,
      suggestions: suggestions.data || [],
    });
  } catch (err) {
    logger.error(`[BACKTEST-DASHBOARD] ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
