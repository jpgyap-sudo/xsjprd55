// ============================================================
// TradingView Webhook Endpoint — /api/webhook/tradingview
// Receives alert POSTs from TradingView and converts them to signals.
// Requires x-webhook-secret header for authentication.
// ============================================================

import { randomUUID } from 'crypto';
import { supabase } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { validateSignal, checkRiskGates } from '../../lib/risk.js';
import { sendTelegram, formatSignalMessage, signalKeyboard } from '../../lib/telegram.js';
import { extractPattern } from '../../lib/pattern-learner.js';
import { config } from '../../lib/config.js';

const WEBHOOK_SECRET = process.env.TRADINGVIEW_WEBHOOK_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  const provided = req.headers['x-webhook-secret'];
  if (WEBHOOK_SECRET && provided !== WEBHOOK_SECRET) {
    logger.warn('[TV-WEBHOOK] Rejected — invalid secret');
    return res.status(401).json({ error: 'Unauthorized — set x-webhook-secret header' });
  }

  const body = req.body || {};

  // TradingView alert messages come in various shapes.
  // Support both raw TradingView alert JSON and our custom format.
  const symbol = (body.symbol || body.ticker || body.pair || '').toUpperCase().replace('/', '');
  const sideRaw = (body.side || body.action || body.strategy || '').toUpperCase();
  const side = ['LONG', 'SHORT', 'BUY', 'SELL'].includes(sideRaw)
    ? (sideRaw === 'BUY' ? 'LONG' : sideRaw === 'SELL' ? 'SHORT' : sideRaw)
    : null;

  const entryPrice = Number(body.entry_price || body.price || body.close || 0);
  const stopLoss = Number(body.stop_loss || body.sl || 0);
  const takeProfit = Number(body.take_profit || body.tp || 0);
  const confidence = Math.min(Number(body.confidence || 0.7), 1);
  const timeframe = (body.timeframe || body.interval || '15m').toLowerCase();
  const strategy = body.strategy_name || body.strategy || 'TradingView_Alert';
  const mode = (body.mode || process.env.TRADING_MODE || 'paper').trim();

  if (!symbol || !side) {
    return res.status(400).json({
      error: 'Missing required fields: symbol and side (or action)',
      received: body,
    });
  }

  try {
    const signal = {
      id: randomUUID(),
      symbol,
      side,
      entry_price: entryPrice || null,
      stop_loss: stopLoss || null,
      take_profit: takeProfit ? [takeProfit] : null,
      confidence,
      strategy,
      timeframe,
      source: 'tradingview_webhook',
      mode,
      status: 'active',
      generated_at: new Date().toISOString(),
      valid_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      metadata: { webhookPayload: body },
    };

    // Risk validation
    const validation = validateSignal(signal);
    if (!validation.valid) {
      logger.warn(`[TV-WEBHOOK] Signal rejected by validation: ${validation.reason}`);
      return res.status(422).json({ ok: false, error: validation.reason, signal });
    }

    const riskCheck = await checkRiskGates(signal);
    if (!riskCheck.passed) {
      logger.warn(`[TV-WEBHOOK] Signal blocked by risk gate: ${riskCheck.reason}`);
      return res.status(422).json({ ok: false, error: riskCheck.reason, signal });
    }

    // Store in Supabase
    const { error: dbErr } = await supabase.from('signals').insert({
      id: signal.id,
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
      status: signal.status,
      metadata: signal.metadata,
    });
    if (dbErr) throw dbErr;

    // Extract pattern for ML learning
    try {
      await extractPattern(signal);
    } catch (e) {
      logger.warn('[TV-WEBHOOK] extractPattern failed:', e.message);
    }

    // Broadcast to Telegram
    try {
      const msg = formatSignalMessage(signal);
      const kb = signalKeyboard(signal);
      await sendTelegram(msg, { reply_markup: kb });
    } catch (e) {
      logger.warn('[TV-WEBHOOK] Telegram send failed:', e.message);
    }

    logger.info(`[TV-WEBHOOK] Signal stored & broadcast: ${symbol} ${side} @ ${entryPrice}`);
    return res.status(200).json({ ok: true, signalId: signal.id, symbol, side });
  } catch (err) {
    logger.error('[TV-WEBHOOK] Error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
