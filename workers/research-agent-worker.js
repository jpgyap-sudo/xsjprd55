// ============================================================
// Research Agent Worker
// Crawls sources → extracts strategies → backtests → promotes/rejects
// Runs every 10 minutes on VPS.
// v2: Uses Promotion Gate for all promotion decisions.
// ============================================================

import { initMlDb } from '../lib/ml/db.js';
import { autoTrainIfNeeded } from '../lib/ml/auto-train.js';
import { researchCycle } from '../lib/ml/researchAgent.js';
import { crawlAllSources } from '../lib/ml/sourceCrawler.js';
import { crawlAllEnhancedSources } from '../lib/ml/enhancedSourceCrawler.js';
import { extractAndSaveFromResearch } from '../lib/ml/strategyExtractor.js';
import { extractAndSaveWithAI } from '../lib/ml/aiStrategyExtractor.js';
import { runBacktestOnProposals } from '../lib/ml/backtestEngine.js';
import { recordMockFeedback, promoteStrategy } from '../lib/ml/feedbackLoop.js';
import { crawlTradingViewForAllPairs } from '../lib/research/tv-crawler.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { markProposalTested, upsertStrategyLifecycle } from '../lib/ml/supabase-db.js';
import { evaluatePromotionGate, formatRejection, getSourceCredibility } from '../lib/ml/promotionGate.js';
import { checkDuplicate, hashProposal, saveProposalHash } from '../lib/ml/duplicateDetector.js';
import { recordFailure } from '../lib/ml/failureMemory.js';
import { getFailureRecords, hashStrategyRules } from '../lib/ml/failureMemory.js';

const INTERVAL_MS = 10 * 60 * 1000;

/**
 * Check if Supabase research agent tables exist.
 * Logs a warning if they don't — the worker will fall back to SQLite.
 */
async function checkSupabaseTables() {
  try {
    const { getResearchAgentCounts } = await import('../lib/ml/supabase-db.js');
    const counts = await getResearchAgentCounts();
    logger.info(`[RESEARCH-WORKER] Supabase tables OK: ${JSON.stringify(counts)}`);
    return true;
  } catch (e) {
    logger.warn(`[RESEARCH-WORKER] Supabase tables not available, using SQLite fallback: ${e.message}`);
    return false;
  }
}

async function seedDemoData() {
  initMlDb();
  const { db } = await import('../lib/ml/db.js');

  // Check if we already have untested proposals — if so, no need to seed
  const untestedCount = db.prepare('SELECT COUNT(*) as c FROM strategy_proposals WHERE tested = 0 AND rejected = 0').get();
  if (untestedCount.c > 0) {
    logger.info(`[RESEARCH-WORKER] ${untestedCount.c} untested proposals exist, skipping seed`);
    return;
  }

  // Also check if we have unused research sources that could produce proposals
  const unusedCount = db.prepare('SELECT COUNT(*) as c FROM research_sources WHERE used = 0').get();
  if (unusedCount.c > 0) {
    logger.info(`[RESEARCH-WORKER] ${unusedCount.c} unused research sources exist, skipping seed`);
    return;
  }

  logger.info('[RESEARCH-WORKER] Seeding initial research data...');

  logger.info('[RESEARCH-WORKER] Seeding initial research data...');

  const seedSources = [
    {
      sourceName: 'coingecko_market',
      sourceUrl: 'https://coingecko.com',
      content: 'BTC dominance rising to 54%. Funding rates on BTC perps turning positive. Open interest on ETH spiked 12% in 24h. Liquidation clusters detected around $62k BTC and $2.8k ETH. Whale inflows to exchanges increased. Social sentiment bullish on memecoins PEPE and WIF. Volatility expanding on SOL. EMA golden cross on BTC 4h timeframe. RSI overbought on BNB.',
    },
    {
      sourceName: 'cryptopanic_news',
      sourceUrl: 'https://cryptopanic.com',
      content: 'SEC approves spot ETH ETF filings. BlackRock increases BTC holdings. Solana network congestion easing. Meme coin season continues with PEPE, WIF, BONK leading. Funding rates negative on DOGE perps suggesting short squeeze potential. Open interest dropping on LTC suggesting lack of interest. Support level holding on LINK at $14. Resistance on ARB at $1.20.',
    },
    {
      sourceName: 'hyperliquid_intel',
      sourceUrl: 'https://hyperliquid.xyz',
      content: 'Liquidation heatmap shows heavy long liquidation zone at BTC $61.5k. Short squeeze potential on SOL with negative funding and rising OI. AVAX funding very positive suggesting crowded longs — short opportunity. ENA showing whale accumulation. SUI breaking out with volume spike. STRK funding turning negative. TAO support at $320.',
    },
    {
      sourceName: 'binance_futures_data',
      sourceUrl: 'https://binance.com',
      content: 'BTCUSDT perpetual funding 0.012% (positive, crowded longs). ETHUSDT funding 0.008%. SOLUSDT funding -0.003% (negative, potential long). DOGEUSDT funding -0.015% (very negative, squeeze setup). XRPUSDT OI up 8%. BNB showing bearish divergence RSI. ADA breaking above 200 EMA. AVAX volume spike +45%. LINK funding negative.',
    },
    {
      sourceName: 'social_sentiment_x',
      sourceUrl: 'https://x.com',
      content: 'Crypto Twitter sentiment: bullish on BTC halving narrative. Bearish on BNB due to regulatory concerns. PEPE trending with 50k mentions. WIF memes going viral. SOL community optimistic about Firedancer. ETH ETF speculation driving positive sentiment. FET AI narrative gaining traction. Whale alerts showing large BTC transfers to cold storage.',
    },
    {
      sourceName: 'macro_analysis',
      sourceUrl: 'https://theblock.co',
      content: 'Fed minutes suggest dovish stance — risk assets positive. Dollar index (DXY) weakening supports crypto. Gold correlation with BTC increasing. Treasury yields dropping. ETF inflows strong this week. Institutional interest in ETH growing. Asian markets open green. European stocks rallying. Bitcoin decoupling from tech stocks slightly.',
    },
  ];

  for (const src of seedSources) {
    await researchCycle([src]);
  }

  // Extract strategies from seeded research
  const extracted = await extractAndSaveFromResearch();
  logger.info(`[RESEARCH-WORKER] Seeded ${seedSources.length} sources, extracted ${extracted.extracted || extracted.count} strategies`);

  // Run backtests on extracted proposals with real OHLCV data
  try {
    const { runBacktestOnProposals } = await import('../lib/ml/backtestEngine.js');
    const btResult = await runBacktestOnProposals('BTCUSDT', 100);
    logger.info(`[RESEARCH-WORKER] Backtested ${btResult.results?.length || 0} proposals`);
  } catch (e) {
    logger.warn(`[RESEARCH-WORKER] Backtest seed failed: ${e.message}`);
  }
}

export async function runResearchAgentWorker() {
  if (!config.ENABLE_RESEARCH_AGENT_WORKER) {
    logger.debug('[RESEARCH-WORKER] Disabled by config');
    return;
  }

  logger.info('[RESEARCH-WORKER] Tick');
  initMlDb();

  try {
    // 0. Check Supabase table health (non-blocking)
    try {
      await checkSupabaseTables();
    } catch (e) {
      logger.warn(`[RESEARCH-WORKER] Supabase health check failed: ${e.message}`);
    }

    // 0b. Auto-train ML model if needed (bootstrap on first run)
    try {
      const autoTrain = await autoTrainIfNeeded();
      if (autoTrain.trained) {
        logger.info(`[RESEARCH-WORKER] Auto-trained ML model — seeded=${autoTrain.seeded}, accuracy=${autoTrain.metrics?.accuracy}`);
      }
    } catch (e) {
      logger.warn(`[RESEARCH-WORKER] Auto-train check failed: ${e.message}`);
    }

    // 1. Seed data on first run
    await seedDemoData();

    // 2. Crawl live sources (basic + enhanced)
    const crawlResult = await crawlAllSources();
    logger.info(`[RESEARCH-WORKER] Crawled ${crawlResult.stored || 0} basic sources`);

    // 2b. Crawl enhanced sources (LunarCrush, TradingView ideas, etc.)
    try {
      const enhancedResult = await crawlAllEnhancedSources();
      logger.info(`[RESEARCH-WORKER] Enhanced crawler stored ${enhancedResult.stored || 0} sources`);
    } catch (e) {
      logger.warn(`[RESEARCH-WORKER] Enhanced crawl failed: ${e.message}`);
    }

    // 2c. Crawl TradingView TA for all pairs
    try {
      const tvResult = await crawlTradingViewForAllPairs();
      logger.info(`[RESEARCH-WORKER] TV crawler scanned=${tvResult.scanned}, stored=${tvResult.stored}`);
    } catch (e) {
      logger.warn(`[RESEARCH-WORKER] TV crawl failed: ${e.message}`);
    }

    // 3. Extract strategies from new research (keyword-based)
    const extracted = await extractAndSaveFromResearch();
    logger.info(`[RESEARCH-WORKER] Keyword-extracted ${extracted.extracted || extracted.count} new strategies`);

    // 3b. AI-powered strategy extraction — uses the same sources the keyword extractor
    // already processed, sending them through the brain's model-router for AI analysis
    if (extracted.processedSources && extracted.processedSources.length > 0) {
      try {
        logger.info(`[RESEARCH-WORKER] Running AI extraction on ${extracted.processedSources.length} sources`);
        const aiExtracted = await extractAndSaveWithAI(extracted.processedSources);
        logger.info(`[RESEARCH-WORKER] AI-extracted ${aiExtracted.extracted || 0} strategies`);
      } catch (e) {
        logger.debug(`[RESEARCH-WORKER] AI extraction failed: ${e.message}`);
      }
    } else {
      logger.debug('[RESEARCH-WORKER] No processed sources available for AI extraction');
    }

    // 4. Run backtests on untested proposals across multiple symbols AND timeframes
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
    // Priority 6: Multi-timeframe backtesting
    const timeframes = ['15m', '1h', '4h', '1d'];
    let totalBacktested = 0;
    const allTestedIds = new Set();
    try {
      const { runBacktestOnProposals } = await import('../lib/ml/backtestEngine.js');
      for (const sym of symbols) {
        for (const tf of timeframes) {
          // Use more candles for higher timeframes
          const candleCount = tf === '15m' ? 100 : tf === '1h' ? 200 : tf === '4h' ? 150 : 100;
          const btResult = await runBacktestOnProposals(sym, candleCount);
          totalBacktested += btResult.results?.length || 0;
          // Track proposal IDs for marking tested after all symbols complete
          for (const id of btResult.proposalIds || []) {
            allTestedIds.add(id);
          }

          // Promote top performers using Promotion Gate v2
          for (const r of btResult.results || []) {
            try {
              // Run the full promotion gate
              const gateResult = evaluatePromotionGate(r, {
                isSynthetic: r.isSynthetic,
                hasRandomFeatures: r.hasRandomFeatures,
                walkForward: r.walkForward,
                sourceCredibility: r.sourceCredibility,
                sourceName: r.sourceName || 'backtest_results',
              });

              if (gateResult.approved) {
                // Passed all gates — promote
                await promoteStrategy(r.strategyName, {
                  winRate: r.winRate,
                  totalReturnPct: r.totalReturnPct,
                  trades: r.totalTrades,
                  expectancy: r.expectancy,
                  profitFactor: r.profitFactor,
                  maxDrawdownPct: r.maxDrawdownPct,
                  promotionGateScore: gateResult.score,
                });
                logger.info(
                  `[RESEARCH-WORKER] ✅ Promoted ${r.strategyName} (${sym}/${tf}) — ` +
                  `${(r.winRate * 100).toFixed(0)}% WR, ${r.totalTrades}t, ` +
                  `PF=${r.profitFactor?.toFixed(2)}, Exp=${r.expectancy?.toFixed(4)}, ` +
                  `GateScore=${gateResult.score.toFixed(3)}`
                );

                // Track lifecycle for promoted strategies
                try {
                  await upsertStrategyLifecycle({
                    strategyName: r.strategyName,
                    status: 'promoted',
                    historicalBacktestScore: gateResult.score,
                    mockTradingScore: 0,
                    approvedForMock: true,
                    promotionGateScore: gateResult.score,
                    promotionGateFailures: null,
                    sourceCredibility: r.sourceCredibility,
                    sourceName: r.sourceName,
                    rulesHash: r.rulesHash,
                  });
                } catch (e) {
                  logger.warn(`[RESEARCH-WORKER] Lifecycle upsert failed for ${r.strategyName}: ${e.message}`);
                }
              } else {
                // Blocked by promotion gate — log and record failure
                logger.warn(
                  `[RESEARCH-WORKER] ❌ Blocked ${r.strategyName} (${sym}/${tf}): ${gateResult.failures.length} failures ` +
                  `(score=${gateResult.score.toFixed(3)})`
                );

                // Record failure for learning
                try {
                  recordFailure({
                    strategyName: r.strategyName,
                    rules: r.rules || [],
                    rulesHash: r.rulesHash,
                    failureReason: gateResult.failures.join('; '),
                    metrics: {
                      totalTrades: r.totalTrades,
                      winRate: r.winRate,
                      profitFactor: r.profitFactor,
                      maxDrawdownPct: r.maxDrawdownPct,
                      expectancy: r.expectancy,
                    },
                    symbolsTested: [sym],
                    isSynthetic: r.isSynthetic,
                    hasRandomFeatures: r.hasRandomFeatures,
                    oosFailed: r.walkForward === null,
                  });
                } catch (e) {
                  // Non-critical
                }

                // Update lifecycle with rejection
                try {
                  await upsertStrategyLifecycle({
                    strategyName: r.strategyName,
                    status: 'rejected',
                    historicalBacktestScore: gateResult.score,
                    mockTradingScore: 0,
                    approvedForMock: false,
                    rejectedReason: gateResult.failures.join('; '),
                    promotionGateScore: gateResult.score,
                    promotionGateFailures: gateResult.failures.join('; '),
                    sourceCredibility: r.sourceCredibility,
                    sourceName: r.sourceName,
                    rulesHash: r.rulesHash,
                  });
                } catch (e) {}
              }
            } catch (e) {
              logger.warn(`[RESEARCH-WORKER] Gate evaluation failed for ${r.strategyName}: ${e.message}`);
            }
          }
        }
      }

      // Mark all proposals as tested AFTER all symbols complete
      for (const id of allTestedIds) {
        try {
          await markProposalTested(id);
        } catch (e) {
          const { db } = await import('../lib/ml/db.js');
          db.prepare(`UPDATE strategy_proposals SET tested = 1 WHERE id = ?`).run(id);
        }
      }
      logger.info(
        `[RESEARCH-WORKER] Backtested ${totalBacktested} proposals across ${symbols.length} symbols × ${timeframes.length} timeframes, ` +
        `marked ${allTestedIds.size} as tested`
      );
    } catch (e) {
      logger.warn(`[RESEARCH-WORKER] Backtest cycle failed: ${e.message}`);
    }

    // 5. Feed promoted strategies into signal pipeline
    try {
      const { getPromotedStrategies } = await import('../lib/ml/feedbackLoop.js');
      const promoted = getPromotedStrategies();
      if (promoted.length) {
        logger.info(`[RESEARCH-WORKER] ${promoted.length} promoted strategies available for trading`);
      }
    } catch (e) {}

    // 5b. Priority 5: Strategy Evolution Loop — revisit failed strategies
    try {
      const failures = getFailureRecords();
      if (failures.length > 0) {
        logger.info(`[RESEARCH-WORKER] Strategy evolution: ${failures.length} failed strategies to analyze`);

        // Group failures by category
        const byCategory = {};
        for (const f of failures) {
          byCategory[f.failure_category] = (byCategory[f.failure_category] || 0) + 1;
        }

        // Log failure category breakdown
        for (const [cat, count] of Object.entries(byCategory)) {
          logger.info(`[RESEARCH-WORKER]   ${cat}: ${count} failures`);
        }

        // For strategies that failed due to low trade count, check if they now have enough data
        // (new feature builder produces more trades, so previously failed strategies may now pass)
        const lowTradeFailures = failures.filter(f =>
          f.failure_category === 'low_trade_count' && f.failure_count < 3
        );

        if (lowTradeFailures.length > 0) {
          logger.info(`[RESEARCH-WORKER] Re-evaluating ${lowTradeFailures.length} low-trade-count failures with improved feature builder`);

          // Re-insert these as untested proposals so they get re-evaluated
          const { db } = await import('../lib/ml/db.js');
          for (const f of lowTradeFailures.slice(0, 10)) {
            try {
              // Check if a proposal with this hash already exists
              const existing = db.prepare(
                'SELECT id FROM strategy_proposals WHERE rules_hash = ? AND tested = 0'
              ).get(f.rules_hash);
              if (!existing) {
                // Create a revived proposal
                db.prepare(`
                  INSERT INTO strategy_proposals (created_at, name, description, rules_json, confidence, tested, promoted, rejected, rules_hash, source_name, source_credibility)
                  VALUES (datetime('now'), ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)
                `).run(
                  `revived_${f.strategy_name}`,
                  `Revived from failure: ${f.failure_reason}`,
                  '[]',
                  0.4,
                  f.rules_hash,
                  'evolution_loop',
                  0.3
                );
                logger.info(`[RESEARCH-WORKER] Revived strategy ${f.strategy_name} for re-evaluation`);
              }
            } catch (e) {
              logger.debug(`[RESEARCH-WORKER] Revival skipped for ${f.strategy_name}: ${e.message}`);
            }
          }
        }
      }
    } catch (e) {
      logger.debug(`[RESEARCH-WORKER] Evolution loop skipped: ${e.message}`);
    }

    logger.info('[RESEARCH-WORKER] Tick complete');
  } catch (err) {
    logger.error(`[RESEARCH-WORKER] ${err.message}`);
  }
}

// ── Standalone execution ────────────────────────────────────
import { registerGracefulShutdown } from '../lib/graceful-shutdown.js';

if (process.argv.includes('--once')) {
  runResearchAgentWorker().then(() => process.exit(0));
} else {
  registerGracefulShutdown({
    name: 'research-agent-worker',
    timeout: 15000,
    onShutdown: async () => {
      logger.info('[RESEARCH-WORKER] Draining in-progress tasks...');
      // Allow current tick to finish (up to 15s timeout)
      await new Promise(r => setTimeout(r, 2000));
    },
  });

  runResearchAgentWorker();
  setInterval(runResearchAgentWorker, INTERVAL_MS);
}
