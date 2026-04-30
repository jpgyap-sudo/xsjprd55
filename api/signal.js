// ============================================================
// Signal Generator — /api/signal
// GET  : cron-triggered auto-scan
// POST : manual trigger with optional overrides
// Now integrates Neural Social Intelligence boost.
// Scans multiple exchanges: Binance, Bybit, OKX, Hyperliquid.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { fetchOHLCV } from '../lib/exchange.js';
import { runAllStrategiesWithIntel } from '../lib/signal-engine.js';
import { validateSignal, checkRiskGates, logAudit } from '../lib/risk.js';
import { sendTelegram, formatSignalMessage, signalKeyboard } from '../lib/telegram.js';
import { extractPattern } from '../lib/pattern-learner.js';
import { config } from '../lib/config.js';
import { storeResearchItem } from '../lib/ml/researchAgent.js';

const DEFAULT_PAIRS = config.DEFAULT_PAIRS;
const TIMEFRAMES = config.TIMEFRAMES;
const DEFAULT_EXCHANGE = (process.env.DEFAULT_EXCHANGE || 'binance').trim();
const SCAN_EXCHANGES = config.SCAN_EXCHANGES || ['binance'];

export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isManual = req.method === 'POST';

  // ── GET : return active signals from DB (for frontend dashboard) ──
  if (!isManual) {
    try {
      const { data: activeSignals, error } = await supabase
        .from('signals')
        .select('*')
        .eq('status', 'active')
        .order('generated_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      
      // Enrich signals with clickable details
      const enrichedSignals = (activeSignals || []).map(signal => ({
        ...signal,
        // Clickable URL to TradingView chart
        chartUrl: generateTradingViewUrl(signal.symbol, signal.timeframe),
        // Detailed description
        description: generateSignalDescription(signal),
        // Risk metrics
        riskReward: signal.take_profit && signal.stop_loss ?
          ((signal.take_profit[0] - signal.entry_price) / (signal.entry_price - signal.stop_loss)).toFixed(2) :
          null,
        // Time remaining
        timeRemaining: signal.valid_until ?
          Math.max(0, Math.floor((new Date(signal.valid_until) - new Date()) / 60000)) :
          null,
        // Metadata enrichment
        metadata: {
          ...signal.metadata,
          sourceIcon: getSignalSourceIcon(signal.source),
          strategyDescription: getStrategyDescription(signal.strategy),
        }
      }));
      
      return res.status(200).json({
        ok: true,
        signals: enrichedSignals,
        count: enrichedSignals.length,
        ts: new Date().toISOString()
      });
    } catch (err) {
      console.error('Signal fetch error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ── POST : manual scan ──
  // Auth for the GET (cron) path is handled by server.js middleware.
  // POSTs are manual triggers (e.g. Telegram /scan) — no secret required.
  const pairs    = req.body?.pairs || DEFAULT_PAIRS;
  const tfs      = req.body?.timeframes || TIMEFRAMES;
  const mode     = (req.body?.mode || process.env.TRADING_MODE || 'paper').trim();
  const exchange = (req.body?.exchange || DEFAULT_EXCHANGE).trim();

  const results = { scanned: 0, signals: [], errors: [] };

  try {
    for (const pair of pairs) {
      for (const tf of tfs) {
        results.scanned++;
        try {
          const ohlcv = await fetchOHLCV(exchange, pair, tf, 100);
          if (!ohlcv || ohlcv.length < 55) continue;

          // Cache latest candle to market_data
          const latest = ohlcv[ohlcv.length - 1];
          await supabase.from('market_data').upsert({
            symbol: pair.replace('/',''),
            exchange,
            timeframe: tf,
            timestamp: new Date(latest[0]).toISOString(),
            open: latest[1], high: latest[2], low: latest[3],
            close: latest[4], volume: latest[5]
          }, { onConflict: 'symbol,exchange,timeframe,timestamp' });

          // Run all strategies with social intel boost
          const candidates = await runAllStrategiesWithIntel(pair, tf, ohlcv);
          for (const raw of candidates) {
            raw.mode = mode;

            const v = validateSignal(raw);
            if (!v.ok) {
              results.errors.push({ pair, tf, strategy: raw.strategy, errors: v.errors });
              continue;
            }

            const rg = await checkRiskGates(null, raw, supabase);
            if (!rg.ok) {
              results.errors.push({ pair, tf, strategy: raw.strategy, errors: rg.issues });
              continue;
            }

            // Dedupe active signal same symbol+side
            const { data: dup } = await supabase
              .from('signals')
              .select('id')
              .eq('symbol', raw.symbol)
              .eq('side', raw.side)
              .eq('status', 'active')
              .maybeSingle();
            if (dup) continue;

            // Save
            const { data: saved, error: saveErr } = await supabase
              .from('signals')
              .insert(raw)
              .select()
              .single();
            if (saveErr || !saved) {
              results.errors.push({ pair, tf, strategy: raw.strategy, errors: [saveErr?.message || 'Insert returned null'] });
              continue;
            }

            // Extract pattern for learning
            try {
              await extractPattern(saved);
            } catch (patErr) {
              console.warn('[signal] pattern extraction failed:', patErr.message);
            }

            // Broadcast
            try {
              await sendTelegram(null, formatSignalMessage(saved), { reply_markup: signalKeyboard(saved.id) });
              await logAudit(supabase, 'signal_sent', { signal_id: saved.id, symbol: saved.symbol, side: saved.side, source: 'auto_scan' });
            } catch (tgErr) {
              console.error('Telegram broadcast failed:', tgErr.message);
            }

            results.signals.push({ id: saved.id, symbol: saved.symbol, side: saved.side, strategy: saved.strategy });
          }
        } catch (innerErr) {
          results.errors.push({ pair, tf, strategy: null, errors: [innerErr.message] });
        }
      }
    }

    return res.status(200).json({ ok: true, scanned: results.scanned, signals: results.signals, errors: results.errors });
  } catch (err) {
    console.error('Signal scan fatal error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ── Helper Functions for Signal Enrichment ──────────────────

function generateTradingViewUrl(symbol, timeframe) {
  const tvSymbol = symbol.replace(/\//g, '');
  const interval = timeframe === '15m' ? '15' :
                   timeframe === '1h' ? '60' :
                   timeframe === '4h' ? '240' : 'D';
  return `https://www.tradingview.com/chart/?symbol=BINANCE:${tvSymbol}&interval=${interval}`;
}

function generateSignalDescription(signal) {
  const parts = [
    `📊 *${signal.symbol}* - ${signal.side} Signal`,
    ``,
    `🎯 *Entry:* $${signal.entry_price}`,
  ];
  
  if (signal.stop_loss) {
    parts.push(`🛑 *Stop Loss:* $${signal.stop_loss}`);
  }
  
  if (signal.take_profit) {
    const tpArray = Array.isArray(signal.take_profit) ? signal.take_profit : [signal.take_profit];
    parts.push(`✅ *Take Profit:* ${tpArray.map(tp => `$${tp}`).join(', ')}`);
  }
  
  parts.push(`📈 *Strategy:* ${signal.strategy}`);
  parts.push(`⏱️ *Timeframe:* ${signal.timeframe}`);
  parts.push(`🎲 *Confidence:* ${Math.round((signal.confidence || 0) * 100)}%`);
  parts.push(`📡 *Source:* ${signal.source}`);
  parts.push(`⏰ *Generated:* ${new Date(signal.generated_at).toLocaleString()}`);
  
  if (signal.valid_until) {
    const timeLeft = Math.max(0, Math.floor((new Date(signal.valid_until) - new Date()) / 60000));
    parts.push(`⌛ *Valid for:* ${timeLeft} minutes`);
  }
  
  if (signal.metadata?.explanation) {
    parts.push(`\n📝 *Analysis:* ${signal.metadata.explanation}`);
  }
  
  return parts.join('\n');
}

function getSignalSourceIcon(source) {
  const icons = {
    'binance_futures': '🔶',
    'bybit': '🔷',
    'okx': '⭕',
    'hyperliquid': '💧',
    'tradingview': '📊',
    'manual': '✋',
    'research_agent': '🔬',
    'default': '📡'
  };
  return icons[source] || icons.default;
}

function getStrategyDescription(strategy) {
  const descriptions = {
    'EMA_Cross': 'Trend-following strategy using EMA crossovers',
    'RSI_Bounce': 'Mean reversion strategy using RSI oversold/overbought levels',
    'Momentum_EMA20': 'Momentum strategy using price action around EMA20',
    'EMA_Cross_15m': 'EMA Cross strategy optimized for 15-minute timeframe',
    'Volume_Breakout': 'Breakout strategy using volume confirmation',
    'MACD_Divergence': 'Trend reversal strategy using MACD divergences',
    'Bollinger_Squeeze': 'Volatility breakout strategy using Bollinger Bands',
    'default': 'Technical analysis-based trading strategy'
  };
  return descriptions[strategy] || descriptions.default;
}
