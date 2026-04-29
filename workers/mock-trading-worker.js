// ============================================================
// Mock Trading Worker
// Opens paper trades for high-probability signals and monitors them.
// Runs every 3 minutes on VPS.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { getOrCreateMockAccount, openMockTrade, closeMockTrade } from '../lib/mock-trading/mock-account-engine.js';
import { dedupSendIdea } from '../lib/agent-improvement-bus.js';

const INTERVAL_MS = 3 * 60 * 1000;

export async function runMockTradingWorker() {
  if (!config.ENABLE_MOCK_TRADING_WORKER) {
    logger.debug('[MOCK-WORKER] Disabled by config');
    return;
  }

  logger.info('[MOCK-WORKER] Tick');

  try {
    // 1. Open new mock trades for recent high-probability signals
    const { data: recentScores } = await supabase
      .from('signal_feature_scores')
      .select('*, signal:signal_id(*)')
      .gte('final_probability', 65)
      .order('created_at', { ascending: false })
      .limit(20);

    for (const score of recentScores || []) {
      const signal = score.signal;
      if (!signal) continue;

      // Normalize side to lowercase for mock_trades compatibility
      const normalizedSignal = {
        ...signal,
        side: (signal.side || '').toLowerCase(),
        best_leverage: 2,
        stop_loss_pct: 1.2,
        take_profit_pct: 2.5
      };

      // Check if already mocked
      const { data: existing } = await supabase
        .from('mock_trades')
        .select('id')
        .eq('signal_id', signal.id)
        .limit(1);
      if (existing?.length) continue;

      await openMockTrade(normalizedSignal, { finalProbability: score.final_probability });
    }

    // 2. Monitor open mock trades for SL/TP or time exit
    const { data: openTrades } = await supabase
      .from('mock_trades')
      .select('*')
      .eq('status', 'open');

    for (const trade of openTrades || []) {
      try {
        // Public price fetch — no API key needed
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${trade.symbol}`);
        const json = await res.json();
        const price = Number(json.price);
        const sl = Number(trade.stop_loss);
        const tp = Number(trade.take_profit);

        const hitSl = trade.side === 'long' ? price <= sl : price >= sl;
        const hitTp = trade.side === 'long' ? price >= tp : price <= tp;

        if (hitSl) await closeMockTrade(trade.id, price, 'stop_loss');
        else if (hitTp) await closeMockTrade(trade.id, price, 'take_profit');
      } catch (e) {
        logger.warn(`[MOCK-WORKER] Monitor failed for ${trade.symbol}: ${e.message}`);
      }
    }

    // Cross-agent improvement: report mock trading losses and patterns
    try {
      const { data: closed } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('status', 'closed')
        .gte('closed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (closed?.length) {
        const losses = closed.filter(t => (t.pnl || 0) < 0);
        const avgLoss = losses.length ? losses.reduce((s, t) => s + Math.abs(t.pnl || 0), 0) / losses.length : 0;
        const highLevLosses = losses.filter(t => (t.leverage || 1) > 5);

        if (losses.length >= 3 && avgLoss > 10) {
          await dedupSendIdea({
            sourceBot: 'Mock Trading Bot',
            ideaType: 'Risk Management',
            featureAffected: 'Trade Execution Logic',
            observation: `Mock bot lost $${avgLoss.toFixed(2)} avg on ${losses.length} trades in last 24h. ${highLevLosses.length} used >5x leverage.`,
            recommendation: 'Limit leverage to 2x when probability score is below 70%. Enforce tighter stop-losses during high-volatility regimes.',
            expectedBenefit: 'Lower drawdown and better account survival in choppy markets.',
            priority: 'High',
            confidence: 'Needs Testing',
            status: 'Needs Backtest',
          });
        }
      }
    } catch (e) {
      // improvement ideas are best-effort
    }

    logger.info('[MOCK-WORKER] Tick complete');
  } catch (err) {
    logger.error(`[MOCK-WORKER] ${err.message}`);
    await dedupSendIdea({
      sourceBot: 'Mock Trading Bot',
      ideaType: 'Bug Fix',
      featureAffected: 'Mock Trading Worker',
      observation: `Worker crashed: ${err.message}`,
      recommendation: 'Add error boundaries and retry logic for exchange API calls in mock trading worker.',
      priority: 'High',
      confidence: 'High',
      status: 'New',
      relatedErrorId: err.message,
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  logger.info('[MOCK-WORKER] Starting loop...');
  await runMockTradingWorker();
  setInterval(runMockTradingWorker, INTERVAL_MS);
}
