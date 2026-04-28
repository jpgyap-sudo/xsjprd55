// ============================================================
// Signal Generator — /api/signal
// GET  : cron-triggered auto-scan
// POST : manual trigger with optional overrides
// Now integrates Neural Social Intelligence boost.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { fetchOHLCV } from '../lib/exchange.js';
import { runAllStrategiesWithIntel } from '../lib/signal-engine.js';
import { validateSignal, checkRiskGates, logAudit } from '../lib/risk.js';
import { sendTelegram, formatSignalMessage, signalKeyboard } from '../lib/telegram.js';
import { extractPattern } from '../lib/pattern-learner.js';

const DEFAULT_PAIRS = ['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','XRP/USDT'];
const TIMEFRAMES = ['15m','1h','4h'];
const DEFAULT_EXCHANGE = (process.env.DEFAULT_EXCHANGE || 'binance').trim();

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
      return res.status(200).json({
        ok: true,
        signals: activeSignals || [],
        count: (activeSignals || []).length,
        ts: new Date().toISOString()
      });
    } catch (err) {
      console.error('Signal fetch error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ── POST : manual scan (also used by cron with x-cron-secret) ──
  const cronSecret = process.env.CRON_SECRET;
  const provided = req.headers['x-cron-secret'];
  if (cronSecret && provided !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized cron request' });
  }

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
