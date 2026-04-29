// ============================================================
// Research Agent Worker
// Crawls sources → extracts strategies → backtests → promotes/rejects
// Runs every 10 minutes on VPS.
// ============================================================

import { initMlDb } from '../lib/ml/db.js';
import { autoTrainIfNeeded } from '../lib/ml/auto-train.js';
import { researchCycle } from '../lib/ml/researchAgent.js';
import { crawlAllSources } from '../lib/ml/sourceCrawler.js';
import { extractAndSaveFromResearch } from '../lib/ml/strategyExtractor.js';
import { runBacktestOnProposals } from '../lib/ml/backtestEngine.js';
import { recordMockFeedback } from '../lib/ml/feedbackLoop.js';
import { crawlTradingViewForAllPairs } from '../lib/research/tv-crawler.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';

const INTERVAL_MS = 10 * 60 * 1000;

async function seedDemoData() {
  initMlDb();
  const { db } = await import('../lib/ml/db.js');

  // Check if we already have data
  const count = db.prepare('SELECT COUNT(*) as c FROM research_sources').get();
  if (count.c > 0) {
    logger.info(`[RESEARCH-WORKER] ${count.c} research sources already exist, skipping seed`);
    return;
  }

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
    researchCycle([src]);
  }

  // Extract strategies from seeded research
  const extracted = extractAndSaveFromResearch();
  logger.info(`[RESEARCH-WORKER] Seeded ${seedSources.length} sources, extracted ${extracted.count} strategies`);

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
    // 0. Auto-train ML model if needed (bootstrap on first run)
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

    // 2. Crawl live sources
    const crawlResult = await crawlAllSources();
    logger.info(`[RESEARCH-WORKER] Crawled ${crawlResult.stored || 0} sources`);

    // 2b. Crawl TradingView TA for all pairs
    try {
      const tvResult = await crawlTradingViewForAllPairs();
      logger.info(`[RESEARCH-WORKER] TV crawler scanned=${tvResult.scanned}, stored=${tvResult.stored}`);
    } catch (e) {
      logger.warn(`[RESEARCH-WORKER] TV crawl failed: ${e.message}`);
    }

    // 3. Extract strategies from new research
    const extracted = extractAndSaveFromResearch();
    logger.info(`[RESEARCH-WORKER] Extracted ${extracted.count} new strategies`);

    // 4. Run backtests on untested proposals across multiple symbols
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
    let totalBacktested = 0;
    try {
      const { runBacktestOnProposals } = await import('../lib/ml/backtestEngine.js');
      for (const sym of symbols) {
        const btResult = await runBacktestOnProposals(sym, 100);
        totalBacktested += btResult.results?.length || 0;
        // Promote top performers immediately
        for (const r of btResult.results || []) {
          if (r.totalTrades >= 5 && r.winRate >= 0.54) {
            try {
              const { promoteStrategy } = await import('../lib/ml/feedbackLoop.js');
              promoteStrategy(r.strategyName, { winRate: r.winRate, totalReturnPct: r.totalReturnPct, trades: r.totalTrades });
              logger.info(`[RESEARCH-WORKER] Auto-promoted ${r.strategyName} — ${(r.winRate*100).toFixed(0)}% WR, ${r.totalTrades} trades`);
            } catch (e) {}
          }
        }
      }
      logger.info(`[RESEARCH-WORKER] Backtested ${totalBacktested} proposals across ${symbols.length} symbols`);
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

    logger.info('[RESEARCH-WORKER] Tick complete');
  } catch (err) {
    logger.error(`[RESEARCH-WORKER] ${err.message}`);
  }
}

// ── Standalone execution ────────────────────────────────────
if (process.argv.includes('--once')) {
  runResearchAgentWorker().then(() => process.exit(0));
} else {
  runResearchAgentWorker();
  setInterval(runResearchAgentWorker, INTERVAL_MS);
}
