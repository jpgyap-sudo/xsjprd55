// ============================================================
// Aggressive Mock Trading Worker v3
// Trades ALL Binance perpetuals using ML-adaptive leverage.
// Integrates with TV TA, ML service, and RL agent.
// Runs every 90 seconds.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import {
  getOrCreateAggressiveAccount,
  openAggressiveTrade,
  monitorAndCloseAggressive,
  getAllPerpetualSymbols,
} from '../lib/mock-trading/aggressive-engine.js';
import { fetchTvAnalysisBatch, tvAnalysisToResearchItem } from '../lib/tradingview-ta.js';
import { storeResearchItem } from '../lib/ml/researchAgent.js';
import { dedupSendIdea } from '../lib/agent-improvement-bus.js';

const INTERVAL_MS = 90 * 1000;
const TV_SCAN_BATCH_SIZE = 15;

export async function runAggressiveWorker() {
  if (!config.ENABLE_MOCK_TRADING_WORKER) {
    logger.debug('[AGGRESSIVE-WORKER] Disabled by config');
    return;
  }

  logger.info('[AGGRESSIVE-WORKER] Tick');

  try {
    // ── 1. Close / monitor existing trades ──────────────────
    const closed = await monitorAndCloseAggressive();
    if (closed.length) {
      logger.info(`[AGGRESSIVE-WORKER] Closed ${closed.length} trades`);
    }

    // ── 2. Fetch recent high-confidence signals ─────────────
    const { data: recentSignals } = await supabase
      .from('signals')
      .select('*')
      .eq('status', 'active')
      .gte('confidence', 0.55)
      .gte('generated_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order('generated_at', { ascending: false })
      .limit(30);

    const account = await getOrCreateAggressiveAccount();
    const openCount = (await supabase.from('mock_trades').select('id', { count: 'exact', head: true }).eq('status', 'open')).count || 0;

    for (const signal of recentSignals || []) {
      // Skip if already traded
      const { data: existing } = await supabase
        .from('mock_trades')
        .select('id')
        .eq('signal_id', signal.id)
        .limit(1);
      if (existing?.length) continue;

      // Skip if max open reached
      if (openCount >= (config.MOCK_MAX_OPEN_TRADES || 50)) break;

      const trade = await openAggressiveTrade({
        id: signal.id,
        symbol: signal.symbol,
        side: signal.side.toLowerCase(),
        price: signal.entry_price,
        confidence: signal.confidence,
        strategy: signal.strategy,
        timeframe: signal.timeframe,
        volatility_pct: signal.metadata?.volatility_pct || 2,
      });

      if (trade) openCount++;
    }

    // ── 3. Scan TradingView TA for additional opportunities ─
    if (config.ENABLE_TV_TA_SCAN) {
      await scanTradingViewOpportunities();
    }

    // ── 4. Report daily summary if needed ───────────────────
    await reportDailySummary();

    logger.info('[AGGRESSIVE-WORKER] Tick complete');
  } catch (err) {
    logger.error(`[AGGRESSIVE-WORKER] ${err.message}`);
    await dedupSendIdea({
      sourceBot: 'Aggressive Mock Trader',
      ideaType: 'Bug Fix',
      featureAffected: 'Aggressive Mock Worker',
      observation: `Worker crashed: ${err.message}`,
      recommendation: 'Check exchange API connectivity and Supabase query limits.',
      priority: 'High',
      confidence: 'High',
      status: 'New',
      relatedErrorId: err.message,
    });
  }
}

async function scanTradingViewOpportunities() {
  try {
    const symbols = await getAllPerpetualSymbols();
    // Scan a rotating subset each tick
    const offset = Math.floor(Date.now() / INTERVAL_MS) % Math.max(1, Math.ceil(symbols.length / TV_SCAN_BATCH_SIZE));
    const batch = symbols.slice(offset * TV_SCAN_BATCH_SIZE, (offset + 1) * TV_SCAN_BATCH_SIZE);

    const analyses = await fetchTvAnalysisBatch(batch, '15m');
    for (const analysis of analyses) {
      // Feed to research agent
      const item = tvAnalysisToResearchItem(analysis);
      storeResearchItem(item);

      // If strong signal and no existing trade, consider opening
      if (analysis.overall === 'BUY' || analysis.overall === 'SELL') {
        const { data: existing } = await supabase
          .from('mock_trades')
          .select('id')
          .eq('symbol', analysis.symbol)
          .eq('status', 'open')
          .limit(1);
        if (existing?.length) continue;

        const confidence = analysis.overall === 'BUY' ? 0.62 : 0.62;
        await openAggressiveTrade({
          symbol: analysis.symbol,
          side: analysis.overall === 'BUY' ? 'long' : 'short',
          price: analysis.close,
          confidence,
          strategy: 'tv_ta_scan',
          timeframe: '15m',
          volatility_pct: Math.abs(analysis.rsi - 50) / 10,
        });
      }
    }
  } catch (e) {
    logger.warn(`[AGGRESSIVE-WORKER] TV scan failed: ${e.message}`);
  }
}

async function reportDailySummary() {
  const now = new Date();
  if (now.getHours() !== 23 || now.getMinutes() > 5) return; // Once at 23:00

  const today = now.toISOString().slice(0, 10);
  const { data: closed } = await supabase
    .from('mock_trades')
    .select('*')
    .eq('status', 'closed')
    .gte('closed_at', `${today}T00:00:00Z`);

  if (!closed?.length) return;

  const wins = closed.filter((t) => (t.pnl_usd || 0) > 0);
  const totalPnl = closed.reduce((s, t) => s + (t.pnl_usd || 0), 0);
  const winRate = wins.length / closed.length;

  logger.info(`[AGGRESSIVE-WORKER] Daily Summary: ${closed.length} trades, WR=${(winRate * 100).toFixed(0)}%, PnL=$${totalPnl.toFixed(0)}`);

  if (winRate < 0.4 && closed.length >= 5) {
    await dedupSendIdea({
      sourceBot: 'Aggressive Mock Trader',
      ideaType: 'Risk Management',
      featureAffected: 'Daily Performance Gate',
      observation: `Poor day: ${closed.length} trades, ${(winRate * 100).toFixed(0)}% win rate, PnL=$${totalPnl.toFixed(0)}`,
      recommendation: 'Pause new entries for 2 hours and reduce leverage cap to 5x. Review signal filters.',
      priority: 'High',
      confidence: 'High',
      status: 'New',
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  logger.info('[AGGRESSIVE-WORKER] Starting loop...');
  await runAggressiveWorker();
  setInterval(runAggressiveWorker, INTERVAL_MS);
}
