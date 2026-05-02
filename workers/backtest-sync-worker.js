// ============================================================
// Backtest Sync Worker
// Syncs backtest data from Supabase to local SQLite
// This fixes the research dashboard showing no data
// Run: node workers/backtest-sync-worker.js
// Cron: */5 * * * * cd ~/xsjprd55 && node workers/backtest-sync-worker.js
// ============================================================

import { supabase } from '../lib/supabase.js';
import { db, initMlDb } from '../lib/ml/db.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { isMainModule } from '../lib/entrypoint.js';

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export async function syncBacktestData() {
  if (!config.ENABLE_CONTINUOUS_BACKTESTER) {
    logger.debug('[BACKTEST-SYNC] Disabled by config');
    return;
  }

  logger.info('[BACKTEST-SYNC] Starting sync...');
  const stats = { backtestRuns: 0, signalScores: 0, errors: 0 };

  try {
    initMlDb();

    // ── 1. Sync backtest_runs from Supabase → SQLite ───────────
    const { data: supabaseRuns, error: runsError } = await supabase
      .from('backtest_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (runsError) throw runsError;

    if (supabaseRuns?.length > 0) {
      const insertRun = db.prepare(`
        INSERT INTO backtest_results
        (run_at, strategy_name, symbol, total_return_pct, total_trades, win_rate, sharpe_ratio, max_drawdown_pct, profit_factor, trade_log_json)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM backtest_results
          WHERE run_at = ? AND strategy_name = ? AND symbol = ?
        )
      `);

      const transaction = db.transaction((runs) => {
        for (const run of runs) {
          try {
            const runAt = run.created_at || run.run_at;
            const strategyName = run.strategy_name || 'unknown_strategy';
            const symbol = run.symbol || 'UNKNOWN';
            const result = insertRun.run(
              runAt,
              strategyName,
              symbol,
              run.total_return_pct ?? run.avg_pnl ?? 0,
              run.total_trades || 0,
              run.win_rate || 0,
              run.sharpe_ratio || 0,
              run.max_drawdown ?? run.max_drawdown_pct ?? 0,
              run.profit_factor || 0,
              JSON.stringify({
                source: 'supabase.backtest_runs',
                source_id: run.id,
                config: run.config || {},
              }),
              runAt,
              strategyName,
              symbol
            );
            stats.backtestRuns += result.changes;
          } catch (e) {
            logger.warn(`[BACKTEST-SYNC] Failed to insert run ${run.id}: ${e.message}`);
            stats.errors++;
          }
        }
      });

      transaction(supabaseRuns);
      logger.info(`[BACKTEST-SYNC] Synced ${stats.backtestRuns} backtest runs`);
    }

    // ── 2. Sync signal_feature_scores → signal_snapshots ───────
    const { data: supabaseScores, error: scoresError } = await supabase
      .from('signal_feature_scores')
      .select(`
        id,
        created_at,
        signal_id,
        market_score,
        liquidation_score,
        social_score,
        funding_oi_score,
        liquidity_score,
        strategy_history_score,
        final_probability,
        confidence_level,
        score_breakdown
      `)
      .order('created_at', { ascending: false })
      .limit(200);

    if (scoresError) throw scoresError;

    if (supabaseScores?.length > 0) {
      // Get signal details for each score
      const signalIds = supabaseScores.map(s => s.signal_id).filter(Boolean);
      const { data: signals } = await supabase
        .from('signals')
        .select('id, symbol, timeframe, side, entry_price, confidence, generated_at')
        .in('id', signalIds);

      const signalMap = new Map((signals || []).map(s => [s.id, s]));

      const insertSnapshot = db.prepare(`
        INSERT INTO signal_snapshots
        (created_at, symbol, timeframe, price, signal_side, rule_probability, ml_probability, final_probability, features_json, rationale_json, outcome_label, outcome_return_pct, outcome_checked_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM signal_snapshots
          WHERE created_at = ? AND symbol = ? AND timeframe = ? AND signal_side = ?
        )
      `);

      const transaction = db.transaction((scores) => {
        for (const score of scores) {
          try {
            const signal = signalMap.get(score.signal_id) || {};
            const features = {
              market: score.market_score,
              liquidation: score.liquidation_score,
              social: score.social_score,
              fundingOi: score.funding_oi_score,
              liquidity: score.liquidity_score,
              strategyHistory: score.strategy_history_score,
            };
            const symbol = signal.symbol || 'UNKNOWN';
            const timeframe = signal.timeframe || '1h';
            const side = signal.side || 'LONG';

            const result = insertSnapshot.run(
              score.created_at,
              symbol,
              timeframe,
              signal.entry_price || 0,
              side,
              signal.confidence || 0.5,
              score.final_probability,
              score.final_probability,
              JSON.stringify(features),
              JSON.stringify(score.score_breakdown || {}),
              null, // outcome_label - not known yet
              null, // outcome_return_pct
              null, // outcome_checked_at
              score.created_at,
              symbol,
              timeframe,
              side
            );
            stats.signalScores += result.changes;
          } catch (e) {
            logger.warn(`[BACKTEST-SYNC] Failed to insert score ${score.id}: ${e.message}`);
            stats.errors++;
          }
        }
      });

      transaction(supabaseScores);
      logger.info(`[BACKTEST-SYNC] Synced ${stats.signalScores} signal scores`);
    }

    // ── 3. Sync backtest_trades if table exists ────────────────
    try {
      const { data: supabaseTrades, error: tradesError } = await supabase
        .from('backtest_trades')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (!tradesError && supabaseTrades?.length > 0) {
        // Check if backtest_trades table exists in SQLite
        const tableExists = db.prepare(`
          SELECT name FROM sqlite_master WHERE type='table' AND name='backtest_trades'
        `).get();

        if (!tableExists) {
          // Create the table
          db.exec(`
            CREATE TABLE IF NOT EXISTS backtest_trades (
              id INTEGER PRIMARY KEY,
              created_at TEXT NOT NULL,
              symbol TEXT NOT NULL,
              side TEXT NOT NULL,
              strategy_name TEXT NOT NULL,
              entry_price REAL NOT NULL,
              exit_price REAL,
              leverage REAL NOT NULL,
              position_size_usd REAL NOT NULL,
              stop_loss REAL,
              take_profit REAL,
              pnl_pct REAL,
              pnl_usd REAL,
              result TEXT,
              exit_reason TEXT,
              probability_at_entry REAL,
              trade_rationale TEXT,
              score_breakdown TEXT
            )
          `);
        }

        const insertTrade = db.prepare(`
          INSERT OR REPLACE INTO backtest_trades
          (id, created_at, symbol, side, strategy_name, entry_price, exit_price, leverage, position_size_usd, stop_loss, take_profit, pnl_pct, pnl_usd, result, exit_reason, probability_at_entry, trade_rationale, score_breakdown)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let tradeCount = 0;
        const transaction = db.transaction((trades) => {
          for (const trade of trades) {
            try {
              insertTrade.run(
                trade.id,
                trade.created_at,
                trade.symbol,
                trade.side,
                trade.strategy_name,
                trade.entry_price,
                trade.exit_price,
                trade.leverage,
                trade.position_size_usd,
                trade.stop_loss,
                trade.take_profit,
                trade.pnl_pct,
                trade.pnl_usd,
                trade.result,
                trade.exit_reason,
                trade.probability_at_entry,
                trade.trade_rationale,
                JSON.stringify(trade.score_breakdown || {})
              );
              tradeCount++;
            } catch (e) {
              // Ignore duplicate errors
            }
          }
        });

        transaction(supabaseTrades);
        logger.info(`[BACKTEST-SYNC] Synced ${tradeCount} backtest trades`);
      }
    } catch (e) {
      logger.debug(`[BACKTEST-SYNC] Skipping trades sync: ${e.message}`);
    }

    logger.info(`[BACKTEST-SYNC] Sync complete. Runs: ${stats.backtestRuns}, Scores: ${stats.signalScores}, Errors: ${stats.errors}`);

    // Send alert if there were errors
    if (stats.errors > 5) {
      logger.error(`[BACKTEST-SYNC] High error count: ${stats.errors}`);
    }

  } catch (err) {
    logger.error(`[BACKTEST-SYNC] Sync failed: ${err.message}`);
  }
}

// ── Also update research sources from external data if available ──
async function syncExternalSnapshots() {
  try {
    const { data: snapshots } = await supabase
      .from('external_data_snapshots')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (!snapshots?.length) return;

    const insertSource = db.prepare(`
      INSERT OR IGNORE INTO research_sources
      (created_at, source_name, source_url, content, extracted_hints_json, used)
      VALUES (?, ?, ?, ?, ?, 0)
    `);

    const transaction = db.transaction((items) => {
      for (const item of items) {
        insertSource.run(
          item.created_at,
          item.source,
          item.screenshot_url || '',
          item.extracted_summary || JSON.stringify(item.raw_json || {}),
          JSON.stringify({ quality_score: item.quality_score, data_type: item.data_type })
        );
      }
    });

    transaction(snapshots);
    logger.info(`[BACKTEST-SYNC] Synced ${snapshots.length} external snapshots`);
  } catch (e) {
    logger.debug(`[BACKTEST-SYNC] External snapshots sync skipped: ${e.message}`);
  }
}

// ── Main loop ───────────────────────────────────────────────
async function main() {
  logger.info('[BACKTEST-SYNC] Starting sync worker...');
  
  await syncBacktestData();
  await syncExternalSnapshots();
  
  logger.info('[BACKTEST-SYNC] Initial sync complete. Running every 5 minutes...');
  
  setInterval(async () => {
    await syncBacktestData();
    await syncExternalSnapshots();
  }, INTERVAL_MS);
}

if (isMainModule(import.meta.url)) {
  main().catch(e => {
    logger.error('[BACKTEST-SYNC] Fatal error:', e);
    process.exit(1);
  });
}
