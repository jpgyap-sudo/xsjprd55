// ============================================================
// Strategy Monitor Worker
// Monitors strategy win rates and auto-disables strategies
// with win rate < 40% (configurable threshold).
// Runs every 30 minutes on VPS.
// ============================================================

import { supabase, isSupabaseNoOp } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { isMainModule } from '../lib/entrypoint.js';
import { registerGracefulShutdown } from '../lib/graceful-shutdown.js';

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_WIN_RATE = Number(process.env.STRATEGY_MIN_WIN_RATE || 0.40); // 40%
const MIN_TRADES = Number(process.env.STRATEGY_MIN_TRADES || 10); // Minimum trades before evaluation

// Track disabled strategies to avoid repeated logging
const DISABLED_STRATEGIES = new Set();

export async function runStrategyMonitor() {
  if (!config.ENABLE_STRATEGY_MONITOR_WORKER && config.ENABLE_STRATEGY_MONITOR_WORKER !== undefined) {
    logger.debug('[STRAT-MONITOR] Disabled by config');
    return;
  }

  if (isSupabaseNoOp()) {
    logger.error('[STRAT-MONITOR] Supabase is in NO-OP mode');
    return;
  }

  logger.info('[STRAT-MONITOR] Tick');

  try {
    // 1. Analyze mock_trades for strategy performance
    const { data: strategyStats } = await supabase
      .from('mock_trades')
      .select('strategy, status, pnl')
      .neq('strategy', null)
      .neq('strategy', '');

    if (!strategyStats?.length) {
      logger.debug('[STRAT-MONITOR] No mock trades to analyze');
      return;
    }

    // Group by strategy
    const byStrategy = {};
    for (const trade of strategyStats) {
      const name = trade.strategy || 'unknown';
      if (!byStrategy[name]) byStrategy[name] = { total: 0, wins: 0, losses: 0, totalPnl: 0 };
      byStrategy[name].total++;
      byStrategy[name].totalPnl += Number(trade.pnl || 0);
      if (trade.status === 'closed') {
        if (Number(trade.pnl || 0) > 0) byStrategy[name].wins++;
        else if (Number(trade.pnl || 0) < 0) byStrategy[name].losses++;
      }
    }

    let disabled = 0;
    let enabled = 0;

    for (const [name, stats] of Object.entries(byStrategy)) {
      if (stats.total < MIN_TRADES) continue; // Not enough data

      const winRate = stats.total > 0 ? stats.wins / stats.total : 0;
      const lossRate = stats.total > 0 ? stats.losses / stats.total : 0;
      const closedCount = stats.wins + stats.losses;

      logger.info(
        `[STRAT-MONITOR] Strategy "${name}": ${stats.total}t, ${(winRate * 100).toFixed(1)}% WR, ` +
        `$${stats.totalPnl.toFixed(2)} PnL, ${closedCount} closed`
      );

      // Auto-disable if win rate below threshold AND enough closed trades
      if (closedCount >= MIN_TRADES && winRate < MIN_WIN_RATE) {
        if (!DISABLED_STRATEGIES.has(name)) {
          DISABLED_STRATEGIES.add(name);
          disabled++;

          logger.warn(`[STRAT-MONITOR] 🚫 Disabling strategy "${name}" — WR ${(winRate * 100).toFixed(1)}% < ${(MIN_WIN_RATE * 100).toFixed(0)}% threshold`);

          // Update strategy_lifecycle if it exists
          try {
            await supabase
              .from('strategy_lifecycle')
              .update({
                approved_for_mock: false,
                status: 'disabled',
                mock_trading_score: winRate,
                rejected_reason: `Auto-disabled by Strategy Monitor: WR ${(winRate * 100).toFixed(1)}% < ${(MIN_WIN_RATE * 100).toFixed(0)}% threshold (${closedCount} closed trades, $${stats.totalPnl.toFixed(2)} PnL)`,
                updated_at: new Date().toISOString()
              })
              .eq('strategy_name', name);
          } catch (e) {
            logger.debug(`[STRAT-MONITOR] strategy_lifecycle update skipped for "${name}": ${e.message}`);
          }

          // Log to audit
          try {
            await supabase.from('audit_log').insert({
              event: 'strategy_auto_disabled',
              metadata: {
                strategy: name,
                win_rate: winRate,
                total_trades: stats.total,
                closed_trades: closedCount,
                total_pnl: stats.totalPnl,
                threshold: MIN_WIN_RATE,
                reason: `Win rate ${(winRate * 100).toFixed(1)}% below ${(MIN_WIN_RATE * 100).toFixed(0)}% threshold`
              }
            });
          } catch (e) {
            // Non-critical
          }
        }
      } else if (winRate >= MIN_WIN_RATE && DISABLED_STRATEGIES.has(name)) {
        // Strategy recovered — re-enable
        DISABLED_STRATEGIES.delete(name);
        enabled++;

        logger.info(`[STRAT-MONITOR] ✅ Re-enabling strategy "${name}" — WR ${(winRate * 100).toFixed(1)}% >= ${(MIN_WIN_RATE * 100).toFixed(0)}% threshold`);

        try {
          await supabase
            .from('strategy_lifecycle')
            .update({
              approved_for_mock: true,
              status: 'promoted',
              mock_trading_score: winRate,
              rejected_reason: null,
              updated_at: new Date().toISOString()
            })
            .eq('strategy_name', name);
        } catch (e) {
          logger.debug(`[STRAT-MONITOR] Re-enable update skipped for "${name}": ${e.message}`);
        }
      }
    }

    if (disabled > 0 || enabled > 0) {
      logger.info(`[STRAT-MONITOR] Actions: disabled=${disabled}, re-enabled=${enabled}`);
    }

    // 2. Also check perpetual_mock_trades for perpetual trader strategies
    try {
      const { data: perpStats } = await supabase
        .from('perpetual_mock_trades')
        .select('strategy, status, pnl')
        .neq('strategy', null)
        .neq('strategy', '');

      if (perpStats?.length) {
        const perpByStrategy = {};
        for (const trade of perpStats) {
          const name = trade.strategy || 'unknown';
          if (!perpByStrategy[name]) perpByStrategy[name] = { total: 0, wins: 0, totalPnl: 0 };
          perpByStrategy[name].total++;
          perpByStrategy[name].totalPnl += Number(trade.pnl || 0);
          if (trade.status === 'closed' && Number(trade.pnl || 0) > 0) perpByStrategy[name].wins++;
        }

        for (const [name, stats] of Object.entries(perpByStrategy)) {
          if (stats.total >= MIN_TRADES) {
            const winRate = stats.wins / stats.total;
            logger.info(
              `[STRAT-MONITOR] Perp strategy "${name}": ${stats.total}t, ${(winRate * 100).toFixed(1)}% WR, ` +
              `$${stats.totalPnl.toFixed(2)} PnL`
            );
          }
        }
      }
    } catch (e) {
      logger.debug(`[STRAT-MONITOR] Perpetual trade analysis skipped: ${e.message}`);
    }

    logger.info('[STRAT-MONITOR] Tick complete');
  } catch (err) {
    logger.error(`[STRAT-MONITOR] ${err.message}`);
  }
}

// ── Standalone execution ────────────────────────────────────
if (isMainModule(import.meta.url)) {
  logger.info('[STRAT-MONITOR] Starting loop...');
  await runStrategyMonitor();
  setInterval(runStrategyMonitor, INTERVAL_MS);

  registerGracefulShutdown({
    name: 'strategy-monitor-worker',
    timeout: 10000,
    onShutdown: async () => {
      logger.info('[STRAT-MONITOR] Shutting down...');
      await new Promise(r => setTimeout(r, 1000));
    },
  });
}
