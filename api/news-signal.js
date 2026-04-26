// ============================================================
// News Signal Generator — /api/news-signal
// GET  : cron-triggered auto-scan (every 5 min via Vercel cron)
// POST : manual trigger with optional overrides
// Generates signals from news sentiment + market + technicals
// Saves to Supabase, broadcasts to Telegram
// ============================================================

import { supabase } from '../lib/supabase.js';
import { scanNewsSignals } from '../lib/news-signal.js';
import { validateSignal, checkRiskGates, logAudit } from '../lib/risk.js';
import { sendTelegram, signalKeyboard } from '../lib/telegram.js';
import { buildLiquidationOverview } from '../lib/liquidation.js';

const GROUP_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

function formatNewsSignalMessage(s) {
  const meta = s.metadata || {};
  const emojis = { LONG: '🟢', SHORT: '🔴' };
  const modeEmoji = s.mode === 'live' ? '💰 LIVE' : '📰 PAPER';
  const riskEmoji = meta.risk_level === 'HIGH' ? '⚠️' : meta.risk_level === 'MEDIUM' ? '⚡' : '✅';

  let msg = `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${emojis[s.side] || ''} *NEWS SIGNAL — ${s.symbol}*\n`;
  msg += `_News-Event_ | 1h | ${modeEmoji}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Top headline
  const headlines = meta.top_headlines || [];
  if (headlines.length > 0) {
    msg += `📰 *${headlines[0].source}*\n`;
    msg += `_${headlines[0].title}_\n\n`;
  }

  // Market context
  msg += `📊 *MARKET:* ${meta.price_change_24h > 0 ? '+' : ''}${meta.price_change_24h?.toFixed(2)}% (24h)\n`;
  if (meta.rsi) msg += `   RSI: ${meta.rsi.toFixed(0)} | `;
  if (meta.ema_bullish !== null) msg += `EMA: ${meta.ema_bullish ? '✅ Bullish' : '❌ Bearish'}\n`;
  if (meta.vol_spike) msg += `   Vol spike: ${meta.vol_spike.toFixed(1)}×\n`;
  msg += `\n`;

  // Signal details
  msg += `🎯 *WIN PROBABILITY: ${meta.win_probability}%*\n`;
  msg += `📈 *Confidence: ${Math.round(s.confidence * 100)}%*\n`;
  msg += `📐 *Risk Level: ${meta.risk_level}* ${riskEmoji}\n`;
  msg += `🔄 *Leverage: ${meta.leverage_suggested}x* suggested\n\n`;

  // Why this signal
  msg += `*Why:* `;
  if (meta.news_sentiment_score > 0.5) msg += `Strong bullish news momentum. `;
  else if (meta.news_sentiment_score < -0.5) msg += `Strong bearish news momentum. `;
  else if (meta.news_sentiment_score > 0) msg += `Mild positive sentiment. `;
  else msg += `Mild negative sentiment. `;

  if (meta.contradiction) {
    msg += `⚠️ Price action contradicts news — use caution.`;
  } else {
    msg += `Technical alignment confirmed.`;
  }
  msg += `\n\n`;

  // Entry/SL/TP
  msg += `📍 *Entry:* ~$${s.entry_price}\n`;
  msg += `🛑 *Stop:* $${s.stop_loss}\n`;
  if (s.take_profit?.length) {
    s.take_profit.forEach((tp, i) => {
      msg += `🎯 *Target ${i + 1}:* $${tp}\n`;
    });
  }
  msg += `\n`;

  // Scores
  msg += `*Scores:*\n`;
  msg += `   News: ${(meta.news_sentiment_score || 0).toFixed(2)}\n`;
  msg += `   Tech: ${(meta.technical_score || 0).toFixed(2)}\n`;
  msg += `   Momentum: ${(meta.price_momentum || 0).toFixed(2)}\n\n`;

  msg += `⏰ ${new Date(s.generated_at).toUTCString()}\n`;
  msg += `🆚 \`${s.id}\``;

  return msg;
}

// ── Cooldown tracker (in-memory, resets on cold start) ──────
const cooldowns = new Map(); // symbol -> timestamp
const COOLDOWN_MS = (parseInt(process.env.NEWS_SIGNAL_COOLDOWN_MINUTES || '15')) * 60 * 1000;

function isOnCooldown(symbol) {
  const last = cooldowns.get(symbol);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isManual = req.method === 'POST';

  // Cron protection: GET requests require x-cron-secret header
  if (!isManual) {
    const cronSecret = process.env.CRON_SECRET;
    const provided = req.headers['x-cron-secret'];
    if (cronSecret && provided !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized cron request' });
    }
  }
  const options = {
    maxAgeMinutes: req.body?.maxAgeMinutes || (isManual ? 120 : 60),
    minConfidence: req.body?.minConfidence || 0.60,
    symbolFilter: req.body?.symbol || null
  };

  const results = { scanned: 0, signals: [], skipped: [], errors: [], broadcasted: 0 };

  try {
    // Run the scan
    const scan = await scanNewsSignals(options);
    results.scanned = scan.scanned;
    results.errors = scan.errors;

    // Process each signal
    for (const raw of scan.signals || []) {
      // Cooldown check
      if (isOnCooldown(raw.symbol)) {
        results.skipped.push({ symbol: raw.symbol, reason: 'cooldown' });
        continue;
      }

      // Validate
      const v = validateSignal(raw);
      if (!v.ok) {
        results.errors.push({ symbol: raw.symbol, errors: v.errors });
        continue;
      }

      // Risk gates
      const rg = await checkRiskGates(null, raw, supabase);
      if (!rg.ok) {
        results.errors.push({ symbol: raw.symbol, errors: rg.issues });
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
      if (dup) {
        results.skipped.push({ symbol: raw.symbol, reason: 'duplicate active' });
        continue;
      }

      // Save
      const { data: saved, error: saveErr } = await supabase
        .from('signals')
        .insert(raw)
        .select()
        .single();

      if (saveErr) {
        results.errors.push({ symbol: raw.symbol, errors: [saveErr.message] });
        continue;
      }

      // Set cooldown
      cooldowns.set(raw.symbol, Date.now());

      // Broadcast to Telegram
      try {
        const msg = formatNewsSignalMessage(saved);
        await sendTelegram(GROUP_ID, msg, { reply_markup: signalKeyboard(saved.id) });
        await logAudit(supabase, 'news_signal_sent', {
          signal_id: saved.id,
          symbol: saved.symbol,
          side: saved.side,
          source: 'news_scan'
        });
        results.broadcasted++;
      } catch (tgErr) {
        console.error('Telegram news broadcast failed:', tgErr.message);
        results.errors.push({ symbol: raw.symbol, errors: [`Telegram: ${tgErr.message}`] });
      }

      results.signals.push({
        id: saved.id,
        symbol: saved.symbol,
        side: saved.side,
        confidence: saved.confidence,
        win_probability: raw.metadata?.win_probability
      });
    }

    return res.status(200).json({
      ok: true,
      scanned: results.scanned,
      signals: results.signals,
      skipped: results.skipped,
      broadcasted: results.broadcasted,
      errors: results.errors
    });

  } catch (err) {
    console.error('News signal fatal error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
