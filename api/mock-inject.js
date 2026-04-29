// ============================================================
// Mock Inject — injects test signals into Supabase for pipeline verification
// GET  : injects 2 test signals (BTC LONG, ETH SHORT)
// POST : injects custom signal from body
// Requires x-cron-secret header if CRON_SECRET is set
// ============================================================

import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  // Auth check
  const provided = req.headers['x-cron-secret'];
  if (CRON_SECRET && provided !== CRON_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const now = new Date();
  const later = new Date(now.getTime() + 3600000);

  const defaultSignals = [
    {
      symbol: 'BTCUSDT',
      side: 'LONG',
      entry_price: 95000,
      stop_loss: 93500,
      take_profit: [97500, 100000],
      confidence: 0.72,
      strategy: 'Test_Injection',
      timeframe: '15m',
      generated_at: now.toISOString(),
      valid_until: later.toISOString(),
      source: 'manual_inject',
      mode: 'paper',
      status: 'active',
      metadata: { injected: true, injected_at: now.toISOString() }
    },
    {
      symbol: 'ETHUSDT',
      side: 'SHORT',
      entry_price: 3200,
      stop_loss: 3280,
      take_profit: [3100, 3000],
      confidence: 0.68,
      strategy: 'Test_Injection',
      timeframe: '15m',
      generated_at: now.toISOString(),
      valid_until: later.toISOString(),
      source: 'manual_inject',
      mode: 'paper',
      status: 'active',
      metadata: { injected: true, injected_at: now.toISOString() }
    }
  ];

  const signals = req.method === 'POST' && req.body?.symbol
    ? [{
        ...defaultSignals[0],
        ...req.body,
        generated_at: now.toISOString(),
        valid_until: later.toISOString(),
        status: 'active',
        metadata: { injected: true, ...req.body.metadata }
      }]
    : defaultSignals;

  try {
    const { data, error } = await supabase.from('signals').insert(signals).select();
    if (error) {
      logger.error('[MOCK-INJECT] Insert error:', error.message);
      return res.status(500).json({ ok: false, error: error.message });
    }

    logger.info(`[MOCK-INJECT] Inserted ${data.length} test signals`);
    return res.status(200).json({
      ok: true,
      inserted: data.length,
      signals: data.map(s => ({
        id: s.id,
        symbol: s.symbol,
        side: s.side,
        entry_price: s.entry_price,
        confidence: s.confidence,
        valid_until: s.valid_until
      }))
    });
  } catch (err) {
    logger.error('[MOCK-INJECT] Unexpected error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
