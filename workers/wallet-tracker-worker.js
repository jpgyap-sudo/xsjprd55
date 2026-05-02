// ============================================================
// Wallet Tracker Worker
// Monitors tracked Hyperliquid wallets for profitable trading
// patterns and generates signals when clusters are detected.
// Runs every 5 minutes by default.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { runWalletTracker } from '../lib/wallet-tracker.js';
import { sendTelegram, formatSignalMessage } from '../lib/telegram.js';
import { dedupSendIdea } from '../lib/agent-improvement-bus.js';
import { isMainModule } from '../lib/entrypoint.js';

const INTERVAL_MS = config.WALLET_TRACKER_INTERVAL_MS || 5 * 60 * 1000;

async function getTrackedWallets() {
  // For MVP: wallets come from env var or can be stored in Supabase
  // Format: WALLET_1=0x123,label1;WALLET_2=0x456,label2
  const wallets = [];
  for (let i = 1; i <= 20; i++) {
    const envVal = process.env[`WALLET_${i}`];
    if (!envVal) continue;
    const [address, label] = envVal.split(',');
    if (address) wallets.push({ address: address.trim(), label: (label || `Wallet ${i}`).trim() });
  }
  return wallets;
}

async function getRecentNews() {
  try {
    const { data } = await supabase
      .from('news_articles')
      .select('*')
      .gte('published_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .limit(50);
    return (data || []).map(n => ({
      asset: n.detected_assets?.[0] || null,
      title: n.title,
      sentiment: n.sentiment_score || 0,
      importance: n.weight || 1,
      publishedAt: n.published_at,
    }));
  } catch (err) {
    logger.warn(`[WALLET-TRACKER] News fetch failed: ${err.message}`);
    return [];
  }
}

export async function runWalletTrackerWorker() {
  if (!config.ENABLE_WALLET_TRACKER_WORKER) {
    logger.debug('[WALLET-TRACKER-WORKER] Disabled by config');
    return;
  }

  const wallets = await getTrackedWallets();
  if (wallets.length === 0) {
    logger.debug('[WALLET-TRACKER-WORKER] No wallets configured');
    return;
  }

  const recentNews = await getRecentNews();

  try {
    const results = await runWalletTracker(wallets, recentNews);

    // Save snapshots to Supabase
    for (const snapshot of results.snapshots) {
      try {
        await supabase.from('wallet_snapshots').insert({
          address: snapshot.address,
          label: snapshot.label,
          account_value: snapshot.accountValue,
          withdrawable: snapshot.withdrawable,
          margin_used: snapshot.marginUsed,
          raw_snapshot: snapshot.raw,
          created_at: snapshot.timestamp,
        });
      } catch (e) {
        // Snapshot table may not exist yet — silently ignore
      }
    }

    // Save/update wallet metrics
    for (const [address, metrics] of Object.entries(results.metrics)) {
      try {
        await supabase.from('tracked_wallets').upsert({
          address,
          label: metrics.label,
          quality_score: metrics.qualityScore,
          realized_pnl: metrics.realizedPnl,
          win_rate: metrics.winRate,
          max_drawdown: metrics.maxDrawdown,
          consistency: metrics.consistency,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'address' });
      } catch (e) {
        // Table may not exist yet
      }
    }

    // Process signals
    for (const signal of results.signals) {
      try {
        // Enrich with current market price
        const symbol = signal.symbol;
        let currentPrice = null;
        try {
          const { createExchange } = await import('../lib/exchange.js');
          const ex = createExchange('hyperliquid');
          const ticker = await ex.fetchTicker(symbol.replace('USDT', '/USDT'));
          currentPrice = ticker.last;
        } catch (_) {}

        if (currentPrice) {
          signal.entry_price = currentPrice;
          const isLong = signal.side === 'LONG';
          signal.stop_loss = isLong ? currentPrice * 0.93 : currentPrice * 1.07;
          signal.take_profit = isLong
            ? [currentPrice * 1.08, currentPrice * 1.15]
            : [currentPrice * 0.92, currentPrice * 0.85];
        }

        // Save signal
        await supabase.from('signals').insert({
          symbol: signal.symbol,
          side: signal.side,
          entry_price: signal.entry_price,
          stop_loss: signal.stop_loss,
          take_profit: signal.take_profit,
          confidence: signal.confidence,
          strategy: signal.strategy,
          timeframe: signal.timeframe,
          generated_at: signal.generated_at,
          valid_until: signal.valid_until,
          source: signal.source,
          mode: signal.mode,
          metadata: signal.metadata,
        });

        // Send Telegram alert for high-confidence signals
        if (signal.confidence >= 0.70 && config.TELEGRAM_GROUP_CHAT_ID) {
          const msg = `🐋 *Whale Signal* (${signal.side})\n` +
            `📊 ${signal.symbol}\n` +
            `💰 Entry: ${signal.entry_price || 'market'}\n` +
            `🎯 TP: ${signal.take_profit?.join(', ') || 'N/A'}\n` +
            `🛡 SL: ${signal.stop_loss || 'N/A'}\n` +
            `📈 Confidence: ${Math.round(signal.confidence * 100)}%\n` +
            `📋 ${signal.metadata?.rationale?.[0] || ''}`;

          await sendTelegram(config.TELEGRAM_GROUP_CHAT_ID, msg);
        }
      } catch (e) {
        logger.error(`[WALLET-TRACKER-WORKER] Signal processing error: ${e.message}`);
      }
    }

    // Cross-agent improvement: wallet regime detection
    try {
      const { data: metrics } = await supabase
        .from('tracked_wallets')
        .select('*')
        .eq('is_active', true)
        .order('quality_score', { ascending: false })
        .limit(20);

      const chopLosers = (metrics || []).filter(m => m.consistency < 0.3 && m.quality_score > 60);
      if (chopLosers.length >= 3) {
        await dedupSendIdea({
          sourceBot: 'Wallet Tracker Bot',
          ideaType: 'Strategy Improvement',
          featureAffected: 'Copy-Trading Signal',
          observation: `${chopLosers.length} profitable wallets show low consistency (<0.3), suggesting they only win in trending markets but lose during chop.`,
          recommendation: 'Add wallet performance tags by market regime: trending, ranging, high volatility. Only copy-trade wallets matched to current regime.',
          expectedBenefit: 'Avoid blindly copying wallets in wrong market conditions.',
          priority: 'High',
          confidence: 'Needs Testing',
          status: 'Needs Backtest',
        });
      }
    } catch (e) {
      // best-effort
    }

    logger.info(`[WALLET-TRACKER-WORKER] Processed ${wallets.length} wallets, ${results.signals.length} signals`);
  } catch (err) {
    logger.error(`[WALLET-TRACKER-WORKER] Error: ${err.message}`);
    await dedupSendIdea({
      sourceBot: 'Wallet Tracker Bot',
      ideaType: 'Bug Fix',
      featureAffected: 'Wallet Tracker Worker',
      observation: `Wallet tracker crashed: ${err.message}`,
      recommendation: 'Add retry logic and graceful degradation when Hyperliquid API is temporarily unavailable.',
      priority: 'High',
      confidence: 'High',
      status: 'New',
      relatedErrorId: err.message,
    });
  }
}

if (isMainModule(import.meta.url)) {
  logger.info('[WALLET-TRACKER-WORKER] Starting loop...');
  await runWalletTrackerWorker();
  setInterval(runWalletTrackerWorker, INTERVAL_MS);
}
