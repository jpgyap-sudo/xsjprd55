// ============================================================
// Continuous Backtester Worker
// Polls recent signals, scores them, runs backtests, saves results.
// Runs every 5 minutes on VPS.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { calculateProbability } from '../lib/scoring/probability-engine.js';
import { runBacktest } from '../lib/backtest/backtest-engine.js';
import { createExchange } from '../lib/trading.js';
import { dedupSendIdea } from '../lib/agent-improvement-bus.js';

const INTERVAL_MS = 5 * 60 * 1000;

export async function runContinuousBacktester() {
  if (!config.ENABLE_CONTINUOUS_BACKTESTER) {
    logger.debug('[BACKTEST-WORKER] Disabled by config');
    return;
  }

  logger.info('[BACKTEST-WORKER] Tick');

  try {
    // Fetch recent signals from the actual signals table
    const { data: signals, error } = await supabase
      .from('signals')
      .select('*')
      .order('generated_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    const ex = createExchange('binance');

    for (const signal of signals || []) {
      // Skip if already backtested
      const { data: existing } = await supabase
        .from('backtest_trades')
        .select('id')
        .eq('symbol', signal.symbol)
        .gt('created_at', signal.generated_at)
        .limit(1);
      if (existing?.length) continue;

      // Build scores from available data
      const scores = {
        market: signal.confidence ? signal.confidence * 100 : 55,
        liquidation: 50,
        social: 50,
        fundingOi: 50,
        liquidity: 55,
        strategyHistory: 50,
      };

      const probability = calculateProbability(scores, {
        sampleSize: 0,
        dataQuality: 60,
      });

      // Save feature scores
      await supabase.from('signal_feature_scores').insert({
        signal_id: signal.id,
        market_score: probability.scores.market,
        liquidation_score: probability.scores.liquidation,
        social_score: probability.scores.social,
        funding_oi_score: probability.scores.fundingOi,
        liquidity_score: probability.scores.liquidity,
        strategy_history_score: probability.scores.strategyHistory,
        final_probability: probability.finalProbability,
        confidence_level: probability.confidence,
        score_breakdown: probability,
      });

      // Fetch forward candles for backtest simulation
      const since = new Date(signal.generated_at).getTime();
      const candles = await ex.fetchOHLCV(signal.symbol, signal.timeframe, since, 100);

      if (candles && candles.length > 5) {
        const { trades, summary } = runBacktest({
          signals: [{
            symbol: signal.symbol,
            side: signal.side.toLowerCase(),
            price: signal.entry_price || signal.price,
            scores,
          }],
          candleMap: { [signal.symbol]: candles.map(c => ({ open: c[1], high: c[2], low: c[3], close: c[4], time: c[0] })) },
          config: { leverage: 1, stopLossPct: 1.2, takeProfitPct: 2.5 },
        });

        // Cross-agent improvement: flag underperforming strategies
        if (summary.winRate < 0.4 && summary.totalTrades >= 3) {
          await dedupSendIdea({
            sourceBot: 'Backtesting Bot',
            ideaType: 'Strategy Improvement',
            featureAffected: signal.strategy,
            observation: `Backtest shows ${(summary.winRate * 100).toFixed(1)}% win rate over ${summary.totalTrades} trades for ${signal.strategy} on ${signal.symbol}.`,
            recommendation: 'Review entry/exit conditions. Consider adding volatility filter or regime detection before entering.',
            expectedBenefit: 'Avoid taking low-quality signals and improve overall portfolio win rate.',
            priority: 'High',
            confidence: 'Medium',
            status: 'Needs Backtest',
            relatedBacktestId: null,
          });
        }

        // Save backtest run summary
        await supabase.from('backtest_runs').insert({
          strategy_name: signal.strategy,
          symbol: signal.symbol,
          timeframe: signal.timeframe,
          side: signal.side.toLowerCase(),
          total_trades: summary.totalTrades,
          win_rate: summary.winRate,
          avg_pnl: summary.avgPnl,
          config: { leverage: 1, stopLossPct: 1.2, takeProfitPct: 2.5 },
        });

        for (const t of trades) {
          await supabase.from('backtest_trades').insert({
            symbol: signal.symbol,
            side: signal.side.toLowerCase(),
            strategy_name: signal.strategy,
            entry_price: t.entryPrice,
            exit_price: t.exitPrice,
            leverage: t.leverage,
            position_size_usd: t.positionSizeUsd,
            stop_loss: t.stopLoss,
            take_profit: t.takeProfit,
            pnl_pct: t.pnlPct,
            pnl_usd: t.pnlUsd,
            result: t.result,
            exit_reason: t.exitReason,
            probability_at_entry: t.probabilityAtEntry,
            trade_rationale: t.tradeRationale,
            score_breakdown: t.scoreBreakdown,
          });
        }
      }
    }

    logger.info('[BACKTEST-WORKER] Tick complete');
  } catch (err) {
    logger.error(`[BACKTEST-WORKER] ${err.message}`);
    await dedupSendIdea({
      sourceBot: 'Backtesting Bot',
      ideaType: 'Bug Fix',
      featureAffected: 'Continuous Backtester',
      observation: `Backtester worker crashed: ${err.message}`,
      recommendation: 'Add defensive checks for missing OHLCV data and exchange connection timeouts.',
      priority: 'High',
      confidence: 'High',
      status: 'New',
      relatedErrorId: err.message,
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  logger.info('[BACKTEST-WORKER] Starting loop...');
  await runContinuousBacktester();
  setInterval(runContinuousBacktester, INTERVAL_MS);
}
