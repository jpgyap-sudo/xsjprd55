// ============================================================
// API: Mock Trader Feedback
// POST /api/mock-feedback — send strategy performance feedback
// GET  /api/mock-feedback — current feedback table snapshot
// ============================================================

import { recordMockFeedback, getPromotedStrategies } from '../lib/ml/feedbackLoop.js';
import { getMockDashboard } from '../lib/ml/mockTrader.js';
import { db, initMlDb } from '../lib/ml/db.js';

export default async function handler(req, res) {
  initMlDb();

  if (req.method === 'POST') {
    const body = req.body || {};
    const {
      strategyName,
      trades = 0,
      wins = 0,
      losses = 0,
      totalPnlUsd = 0,
      maxDrawdownPct = 0,
    } = body;

    if (!strategyName || typeof strategyName !== 'string') {
      return res.status(400).json({ error: 'strategyName required' });
    }

    const result = recordMockFeedback({
      strategyName,
      trades: Number(trades),
      wins: Number(wins),
      losses: Number(losses),
      totalPnlUsd: Number(totalPnlUsd),
      maxDrawdownPct: Number(maxDrawdownPct),
    });

    return res.status(200).json({ strategyName, ...result, ts: new Date().toISOString() });
  }

  if (req.method === 'GET') {
    const feedback = db.prepare(`
      SELECT strategy_name, trades, wins, losses, total_pnl_usd, max_drawdown_pct, feedback_score, promoted, updated_at
      FROM mock_strategy_feedback
      ORDER BY feedback_score DESC
    `).all();

    const promoted = getPromotedStrategies();
    const mock = getMockDashboard();

    return res.status(200).json({ feedback, promoted, mock, ts: new Date().toISOString() });
  }

  res.status(405).send('Method Not Allowed');
}
