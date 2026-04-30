// ============================================================
// Signal Generator — cron-triggered or manual
// Scans configured pairs, runs strategies, saves signals.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { extractPattern } from '../lib/pattern-learner.js';
import { fetchOHLCV } from '../lib/exchange.js';
import {
  validateSignal, buildSignal, formatSignalMessage,
  checkRiskGates, logAudit
} from '../lib/trading.js';

const BOT_TOKEN = config.TELEGRAM_BOT_TOKEN;
const GROUP_ID  = config.TELEGRAM_GROUP_CHAT_ID;

// ── Strategy config ─────────────────────────────────────────
const DEFAULT_PAIRS = config.DEFAULT_PAIRS;
const TIMEFRAMES = config.TIMEFRAMES;

// ── Telegram helpers ────────────────────────────────────────
async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: GROUP_ID, text, parse_mode: 'Markdown' })
  });
  const data = await res.json();
  if (!data.ok) logger.warn(`[SIGNALS] Telegram sendMessage failed: ${data.description}`);
}

// ── Technical indicators (lightweight) ─────────────────────
function ema(data, period) {
  const k = 2 / (period + 1);
  let e = data[0];
  const out = [e];
  for (let i = 1; i < data.length; i++) {
    e = data[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

function rsi(closes, period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const rsis = [];
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsis.push(100 - (100 / (1 + rs)));
  }
  return rsis;
}

// ── Strategies ──────────────────────────────────────────────
function strategy_EMACross(pair, tf, ohlcv) {
  const closes = ohlcv.map(c => c[4]);
  if (closes.length < 55) return null;
  const ema9  = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const prev9  = ema9[ema9.length - 2];
  const prev21 = ema21[ema21.length - 2];
  const curr9  = ema9[ema9.length - 1];
  const curr21 = ema21[ema21.length - 1];

  let side = null;
  if (prev9 <= prev21 && curr9 > curr21) side = 'LONG';
  if (prev9 >= prev21 && curr9 < curr21) side = 'SHORT';
  if (!side) return null;

  const close = closes[closes.length - 1];
  const atr = Math.max(...closes.slice(-14)) - Math.min(...closes.slice(-14));
  const sl = side === 'LONG' ? close - atr * 0.8 : close + atr * 0.8;
  const tp1 = side === 'LONG' ? close + atr * 1.2 : close - atr * 1.2;
  const tp2 = side === 'LONG' ? close + atr * 2.0 : close - atr * 2.0;

  return buildSignal({
    symbol: pair.replace('/',''),
    side,
    entry_price: close,
    stop_loss: parseFloat(sl.toFixed(4)),
    take_profit: [parseFloat(tp1.toFixed(4)), parseFloat(tp2.toFixed(4))],
    confidence: 0.72,
    strategy: 'EMA_Cross',
    timeframe: tf,
    source: 'binance_futures',
    ttl_minutes: tf === '15m' ? 60 : tf === '1h' ? 240 : 960
  });
}

// ── Strategy 3: Simple momentum (fires more frequently) ───
function strategy_Momentum(pair, tf, ohlcv) {
  const closes = ohlcv.map(c => c[4]);
  if (closes.length < 30) return null;

  const ema20 = ema(closes, 20);
  const close = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  const ma = ema20[ema20.length - 1];
  const prevMa = ema20[ema20.length - 2];

  // Price above EMA20 and pulling back toward it = LONG
  // Price below EMA20 and bouncing up toward it = SHORT (fade)
  let side = null;
  if (prevClose > prevMa && close <= ma * 1.002 && close >= ma * 0.998) side = 'LONG';
  if (prevClose < prevMa && close >= ma * 0.998 && close <= ma * 1.002) side = 'SHORT';
  if (!side) return null;

  const atr = Math.max(...closes.slice(-14)) - Math.min(...closes.slice(-14));
  const sl = side === 'LONG' ? close - atr * 0.6 : close + atr * 0.6;
  const tp = side === 'LONG' ? close + atr * 1.0 : close - atr * 1.0;

  return buildSignal({
    symbol: pair.replace('/',''),
    side,
    entry_price: close,
    stop_loss: parseFloat(sl.toFixed(4)),
    take_profit: [parseFloat(tp.toFixed(4))],
    confidence: 0.60,
    strategy: 'Momentum_EMA20',
    timeframe: tf,
    source: 'binance_futures',
    ttl_minutes: tf === '15m' ? 60 : tf === '1h' ? 240 : 960
  });
}

function strategy_RSIBounce(pair, tf, ohlcv) {
  const closes = ohlcv.map(c => c[4]);
  if (closes.length < 20) return null;
  const rsis = rsi(closes, 14);
  if (rsis.length < 2) return null;
  const prev = rsis[rsis.length - 2];
  const curr = rsis[rsis.length - 1];

  let side = null;
  if (prev < 30 && curr > 30) side = 'LONG';
  if (prev > 70 && curr < 70) side = 'SHORT';
  if (!side) return null;

  const close = closes[closes.length - 1];
  const atr = Math.max(...closes.slice(-14)) - Math.min(...closes.slice(-14));
  const sl = side === 'LONG' ? close - atr : close + atr;
  const tp = side === 'LONG' ? close + atr * 1.5 : close - atr * 1.5;

  return buildSignal({
    symbol: pair.replace('/',''),
    side,
    entry_price: close,
    stop_loss: parseFloat(sl.toFixed(4)),
    take_profit: [parseFloat(tp.toFixed(4))],
    confidence: 0.65,
    strategy: 'RSI_Bounce',
    timeframe: tf,
    source: 'binance_futures',
    ttl_minutes: tf === '15m' ? 60 : tf === '1h' ? 240 : 960
  });
}

// ── Main handler ────────────────────────────────────────────
export default async function handler(req, res) {
  // Allow cron (GET) and manual trigger (POST)
  if (!['GET','POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isManual = req.method === 'POST';
  const pairs    = req.body?.pairs || DEFAULT_PAIRS;
  const tfs      = req.body?.timeframes || TIMEFRAMES;
  const mode     = req.body?.mode || process.env.TRADING_MODE || 'paper';

  const results = { scanned: 0, signals: [], errors: [] };
  let ohlcvFetchErrors = 0;

  try {
    for (const pair of pairs) {
      for (const tf of tfs) {
        results.scanned++;
        try {
          // Load 100 candles (with fallback if no API keys)
          let ohlcv;
          try {
            ohlcv = await fetchOHLCV('binance', pair, tf, 100);
          } catch (fetchErr) {
            ohlcvFetchErrors++;
            logger.warn(`[SIGNALS] OHLCV fetch failed for ${pair} ${tf}: ${fetchErr.message}`);
            // Continue to next pair/timeframe — don't let one bad pair kill the whole scan
            continue;
          }
          if (!ohlcv || ohlcv.length < 55) continue;

          // Cache market data
          const latest = ohlcv[ohlcv.length - 1];
          await supabase.from('market_data').upsert({
            symbol: pair.replace('/',''),
            exchange: 'binance',
            timeframe: tf,
            timestamp: new Date(latest[0]).toISOString(),
            open: latest[1], high: latest[2], low: latest[3],
            close: latest[4], volume: latest[5]
          }, { onConflict: 'symbol,exchange,timeframe,timestamp' });

          // Run strategies
          const strategies = [strategy_EMACross, strategy_RSIBounce, strategy_Momentum];
          for (const stratFn of strategies) {
            const rawSignal = stratFn(pair, tf, ohlcv);
            if (!rawSignal) continue;

            const v = validateSignal(rawSignal);
            if (!v.ok) {
              results.errors.push({ pair, tf, strategy: stratFn.name, errors: v.errors });
              continue;
            }

            rawSignal.mode = mode;

            // Risk gates (global)
            const rg = await checkRiskGates(null, rawSignal, supabase);
            if (!rg.ok) {
              results.errors.push({ pair, tf, strategy: stratFn.name, errors: rg.issues });
              continue;
            }

            // Check duplicate active signal for same symbol+side
            const { data: dup } = await supabase
              .from('signals')
              .select('id')
              .eq('symbol', rawSignal.symbol)
              .eq('side', rawSignal.side)
              .eq('status', 'active')
              .maybeSingle();
            if (dup) continue;

            // Save signal
            const { data: saved, error: saveErr } = await supabase
              .from('signals')
              .insert(rawSignal)
              .select()
              .single();
            if (saveErr) {
              results.errors.push({ pair, tf, error: saveErr.message });
              continue;
            }

            // Extract pattern for learning (non-blocking)
            try {
              const closes = ohlcv.map(c => c[4]);
              const close = closes[closes.length - 1];
              const marketCtx = {
                price: close,
                change24h: ((close - closes[closes.length - 25]) / closes[closes.length - 25]) * 100,
                volume24h: ohlcv.slice(-24).reduce((s, c) => s + c[5], 0),
                rsi: rsi(closes, 14).pop(),
                ema9: ema(closes, 9).pop(),
                ema21: ema(closes, 21).pop(),
                volSpike: ohlcv[ohlcv.length - 1][5] / (ohlcv.slice(-20, -1).reduce((s, c) => s + c[5], 0) / 19)
              };
              await extractPattern(saved, marketCtx, null, null, null);

              // Store signal memory for Research Agent + Perpetual Trader
              const { storeSignalMemory } = await import('../lib/signal-memory.js');
              await storeSignalMemory(saved, marketCtx);
            } catch (patternErr) {
              logger.warn('[SIGNALS] Pattern/memory extraction failed:', patternErr.message);
            }

            // Send Telegram
            const msg = formatSignalMessage(saved);
            const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: GROUP_ID,
                text: msg,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: '✅ Confirm Signal', callback_data: `sig_confirm_${saved.id}` },
                      { text: '❌ Dismiss',        callback_data: `sig_dismiss_${saved.id}` }
                    ]
                  ]
                }
              })
            });
            const tgJson = await tgRes.json();
            if (tgJson.ok && tgJson.result?.message_id) {
              await supabase.from('signals')
                .update({ telegram_msg_id: tgJson.result.message_id })
                .eq('id', saved.id);
            }

            await logAudit(supabase, 'signal_sent', {
              signal_id: saved.id,
              symbol: saved.symbol,
              side: saved.side,
              strategy: saved.strategy
            });

            results.signals.push({ id: saved.id, symbol: saved.symbol, side: saved.side, strategy: saved.strategy });
          }
        } catch (e) {
          results.errors.push({ pair, tf, error: e.message });
        }
      }
    }

    // Summary to Telegram on manual run
    if (isManual && results.signals.length) {
      await sendTelegram(`🔔 *Signal Scan Complete*\nScanned: ${results.scanned} combos\nSignals: ${results.signals.length}`);
    }

    logger.info(`[SIGNALS] Scan complete: ${results.signals.length} signals, ${results.errors.length} errors`);
    return res.status(200).json(results);
  } catch (e) {
    logger.error(`[SIGNALS] Scan failed: ${e.message}`);
    await logAudit(supabase, 'error', { message: e.message, stack: e.stack });
    return res.status(500).json({ error: e.message, scanned: results.scanned });
  }
}
