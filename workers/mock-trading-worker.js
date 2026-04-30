// ============================================================
// Mock Trading Worker
// Opens paper trades for high-probability signals and monitors them.
// Runs every 3 minutes on VPS.
// ============================================================

import fetch from 'node-fetch';
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
    // Fallback: if signal_feature_scores is empty, read signals directly
    let scoredSignals = [];
    try {
      const { data: recentScores } = await supabase
        .from('signal_feature_scores')
        .select('*, signal:signal_id(*)')
        .gte('final_probability', 65)
        .order('created_at', { ascending: false })
        .limit(20);
      scoredSignals = recentScores || [];
    } catch (e) {
      logger.debug('[MOCK-WORKER] signal_feature_scores query failed, falling back to signals table');
    }

    // Fallback: read valid active signals directly if no feature scores
    if (scoredSignals.length === 0) {
      try {
        const now = new Date().toISOString();
        const isPaper = (process.env.TRADING_MODE || 'paper') === 'paper';
        let query = supabase
          .from('signals')
          .select('*')
          .eq('status', 'active')
          .order('generated_at', { ascending: false })
          .limit(20);
        // In paper mode be permissive; live mode only non-expired
        if (!isPaper) query = query.gt('valid_until', now);
        const { data: recentSignals } = await query;
        scoredSignals = (recentSignals || []).map(s => ({
          signal: s,
          final_probability: Math.round((s.confidence || 0.5) * 100)
        }));
      } catch (e) {
        logger.warn('[MOCK-WORKER] Fallback signal read failed:', e.message);
      }
    }

    for (const score of scoredSignals) {
      const signal = score.signal;
      if (!signal) continue;

      const normalizedSide = (signal.side || '').toLowerCase();

      // Dedup by open position for this symbol+side (works for both signal sources)
      const { data: existing } = await supabase
        .from('mock_trades')
        .select('id')
        .eq('symbol', signal.symbol)
        .eq('side', normalizedSide)
        .eq('status', 'open')
        .limit(1);
      if (existing?.length) continue;

      // Normalize signal — null out id when it comes from signal_logs (not signals table)
      // to avoid FK violation on mock_trades.signal_id → signals(id)
      const isFromSignalsTable = !score.signal_id; // feature_scores path has signal_id FK to signal_logs
      const normalizedSignal = {
        ...signal,
        id: isFromSignalsTable ? signal.id : null,
        side: normalizedSide,
        strategy: signal.strategy || signal.strategy_name,
        best_leverage: 2,
        stop_loss_pct: 1.2,
        take_profit_pct: 2.5
      };

      try {
        await openMockTrade(normalizedSignal, { finalProbability: score.final_probability });
      } catch (e) {
        logger.warn(`[MOCK-WORKER] openMockTrade failed for ${signal.symbol}: ${e.message}`);
      }
    }

    // 2. Monitor open mock trades for SL/TP or time exit
    const { data: openTrades } = await supabase
      .from('mock_trades')
      .select('*')
      .eq('status', 'open');

    for (const trade of openTrades || []) {
      try {
        // Public price fetch — no API key needed; Binance requires no slash (BTCUSDT not BTC/USDT)
        const binanceSymbol = trade.symbol.replace('/', '');
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`);
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
