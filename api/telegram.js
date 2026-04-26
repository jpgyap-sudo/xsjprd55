// ============================================================
// Telegram Webhook Handler — /api/telegram
// Commands: /signal, /market, /status, /scan, /close, /test, /help, /ai
// AI Chat: any non-command text is routed to Claude
// Callbacks: sig_confirm, sig_dismiss, trade_close
// ============================================================

import { supabase } from '../lib/supabase.js';
import { validateSignal, checkRiskGates, logAudit } from '../lib/risk.js';
import { buildSignal } from '../lib/signal-engine.js';
import { sendTelegram, editMessage, answerCallback, formatSignalMessage, signalKeyboard } from '../lib/telegram.js';
import { askAI } from '../lib/ai.js';

const GROUP_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const ADMIN_ID = process.env.TELEGRAM_ADMIN_USER_ID;

// In-memory chat history per user (Vercel stateless — TTL 10 min)
const userHistory = new Map();
const HISTORY_TTL_MS = 10 * 60 * 1000;

function getHistory(userId) {
  const entry = userHistory.get(userId);
  if (!entry) return [];
  if (Date.now() - entry.ts > HISTORY_TTL_MS) {
    userHistory.delete(userId);
    return [];
  }
  return entry.messages;
}

function pushHistory(userId, role, content) {
  const entry = userHistory.get(userId) || { ts: Date.now(), messages: [] };
  entry.messages.push({ role, content });
  if (entry.messages.length > 12) entry.messages = entry.messages.slice(-12);
  entry.ts = Date.now();
  userHistory.set(userId, entry);
}

async function cmdAsk(args, chatId, userId, senderName) {
  const question = args.join(' ').trim();
  if (!question) {
    return sendTelegram(chatId, '💬 *AI Advisor*\nAsk me anything about crypto markets, shorts, longs, or liquidations.\n\nExample: `/ask What is a good short today?`');
  }
  const history = getHistory(userId);
  const result = await askAI({ question, chatHistory: history });
  if (!result.ok) {
    return sendTelegram(chatId, `❌ AI error: ${result.error}`);
  }
  pushHistory(userId, 'user', question);
  pushHistory(userId, 'assistant', result.answer);
  // Telegram message limit is 4096 chars
  const chunks = result.answer.match(/[\s\S]{1,4000}/g) || [result.answer];
  for (const chunk of chunks) {
    await sendTelegram(chatId, chunk);
  }
}

async function cmdSignal(args, chatId, userId, senderName) {
  if (args.length < 3) {
    return sendTelegram(chatId,
      `⚠️ Usage:\n/signal SYMBOL SIDE ENTRY [SL:price] [TP:price1,price2]\n` +
      `Example: /signal BTCUSDT LONG 65000 SL:64000 TP:67000,69000`
    );
  }

  const symbol = args[0].toUpperCase();
  const side   = args[1].toUpperCase();
  const entry  = parseFloat(args[2]);
  const slArg  = args.find(a => a.toUpperCase().startsWith('SL:'));
  const tpArg  = args.find(a => a.toUpperCase().startsWith('TP:'));
  const sl     = slArg ? parseFloat(slArg.slice(3)) : null;
  const tp     = tpArg ? tpArg.slice(3).split(',').map(Number) : [];

  const raw = buildSignal({
    symbol, side, entry_price: entry, stop_loss: sl, take_profit: tp,
    confidence: 0.8, strategy: 'Manual', timeframe: 'manual',
    source: 'telegram_manual', mode: process.env.TRADING_MODE || 'paper'
  });

  const v = validateSignal(raw);
  if (!v.ok) {
    return sendTelegram(chatId, `❌ Invalid signal:\n${v.errors.join('\n')}`);
  }

  const rg = await checkRiskGates(null, raw, supabase);
  if (!rg.ok) {
    return sendTelegram(chatId, `🚫 Risk gate blocked:\n${rg.issues.join('\n')}`);
  }

  const { data: saved, error: saveErr } = await supabase.from('signals').insert(raw).select().single();
  if (saveErr || !saved) return sendTelegram(chatId, '❌ Failed to save signal');

  await sendTelegram(chatId, formatSignalMessage(saved), { reply_markup: signalKeyboard(saved.id) });
  await logAudit(supabase, 'signal_sent', { signal_id: saved.id, symbol, side, user_id: userId, source: 'manual' });
}

async function cmdMarket(args, chatId) {
  const symbol = (args[0] || 'BTCUSDT').toUpperCase();
  const { data: rows } = await supabase
    .from('market_data')
    .select('*')
    .eq('symbol', symbol)
    .eq('timeframe', '1h')
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();

  if (!rows) {
    return sendTelegram(chatId, `📭 No cached data for ${symbol}. Run /scan or wait for next cron.`);
  }

  const c = rows;
  const change = ((c.close - c.open) / c.open * 100).toFixed(2);
  const emoji = change >= 0 ? '🟢' : '🔴';
  const msg =
    `${emoji} *${symbol}* — ${c.timeframe}\n` +
    `\`O:\` ${c.open}  \`H:\` ${c.high}  \`L:\` ${c.low}  \`C:\` ${c.close}\n` +
    `📊 Change: ${change}% | Vol: ${Math.round(c.volume || 0)}\n` +
    `🕐 ${new Date(c.timestamp).toISOString()}`;
  sendTelegram(chatId, msg);
}

async function cmdStatus(chatId) {
  const { data: activeSignals } = await supabase
    .from('signals')
    .select('*')
    .eq('status', 'active')
    .order('generated_at', { ascending: false });

  const { data: openTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('status', 'open')
    .order('opened_at', { ascending: false });

  let msg = `📊 *Bot Status*\n\n`;
  msg += `*Active Signals:* ${activeSignals?.length || 0}\n`;
  msg += `*Open Trades:*   ${openTrades?.length || 0}\n\n`;

  if (activeSignals?.length) {
    msg += `*Signals:*\n`;
    for (const s of activeSignals.slice(0, 5)) {
      msg += `• ${s.side} ${s.symbol} @ ${s.entry_price} (${s.strategy})\n`;
    }
  }
  if (openTrades?.length) {
    msg += `\n*Trades:*\n`;
    for (const t of openTrades.slice(0, 5)) {
      msg += `• ${t.side} ${t.symbol} @ ${t.entry_price} [${t.mode}]\n`;
    }
  }
  sendTelegram(chatId, msg);
}

async function cmdScan(chatId) {
  await sendTelegram(chatId, '🔍 Triggering signal scan...');
  try {
    const base = process.env.VERCEL_PRODUCTION_URL || '';
    const res = await fetch(`${base}/api/signal`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    sendTelegram(chatId, `🔔 Scan done. Signals: ${data.signals?.length || 0} | Errors: ${data.errors?.length || 0}`);
  } catch (e) {
    sendTelegram(chatId, `❌ Scan failed: ${e.message}`);
  }
}

async function cmdClose(args, chatId) {
  const symbol = (args[0] || '').toUpperCase();
  if (!symbol) return sendTelegram(chatId, 'Usage: /close SYMBOL');

  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('symbol', symbol)
    .eq('status', 'open');

  if (!trades?.length) return sendTelegram(chatId, `No open trades for ${symbol}`);

  for (const t of trades) {
    await supabase.from('trades').update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_reason: 'manual'
    }).eq('id', t.id);
  }
  sendTelegram(chatId, `✅ Closed ${trades.length} trade(s) for ${symbol}`);
}

async function cmdTest(chatId) {
  const checks = [];
  checks.push(`SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅' : '❌'}`);
  checks.push(`TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '✅' : '❌'}`);
  checks.push(`TRADING_MODE: ${process.env.TRADING_MODE || 'paper (default)'}`);

  let dbOk = false;
  try {
    const { data } = await supabase.from('signals').select('id').limit(1);
    dbOk = true;
  } catch (e) { /* ignore */ }
  checks.push(`Supabase connection: ${dbOk ? '✅' : '❌'}`);

  sendTelegram(chatId, `🩺 *Health Check*\n\n${checks.join('\n')}`);
}

async function cmdHelp(chatId) {
  const msg =
    `*Available Commands*\n\n` +
    `🤖 *AI Advisor*\n` +
    `/ask QUESTION — Ask the AI anything (e.g. "/ask good short today?")\n` +
    `Or just type any message without a "/" — the AI will reply!\n\n` +
    `📡 *Trading*\n` +
    `/signal SYMBOL SIDE ENTRY [SL:price] [TP:price1,price2] — Manual signal\n` +
    `/market [SYMBOL] — Cached market data\n` +
    `/status — Active signals & trades\n` +
    `/scan — Trigger signal scan now\n` +
    `/close SYMBOL — Close open trades\n` +
    `/test — Bot health check\n` +
    `/help — This message`;
  sendTelegram(chatId, msg);
}

// ── Main handler ────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const body = req.body;
  const callback = body?.callback_query;

  // ── Inline callbacks ──────────────────────────────────────
  if (callback) {
    const data    = callback.data || '';
    const chatId  = callback.message?.chat?.id?.toString();
    const msgId   = callback.message?.message_id;
    const cbId    = callback.id;

    if (data.startsWith('sig_confirm_')) {
      const signalId = data.replace('sig_confirm_', '');
      const { data: sig } = await supabase.from('signals').select('*').eq('id', signalId).single();
      if (!sig) {
        await answerCallback(cbId, 'Signal not found');
        return res.status(200).send('OK');
      }
      await supabase.from('signals').update({ status: 'confirmed' }).eq('id', signalId);
      await editMessage(chatId, msgId, formatSignalMessage({ ...sig, status: 'confirmed' }) + '\n\n✅ *Confirmed*');
      await answerCallback(cbId, 'Signal confirmed');
      await logAudit(supabase, 'signal_confirmed', { signal_id: signalId });
      return res.status(200).send('OK');
    }

    if (data.startsWith('sig_dismiss_')) {
      const signalId = data.replace('sig_dismiss_', '');
      const { data: sig } = await supabase.from('signals').select('*').eq('id', signalId).single();
      if (!sig) {
        await answerCallback(cbId, 'Signal not found');
        return res.status(200).send('OK');
      }
      await supabase.from('signals').update({ status: 'dismissed' }).eq('id', signalId);
      await editMessage(chatId, msgId, formatSignalMessage({ ...sig, status: 'dismissed' }) + '\n\n❌ *Dismissed*');
      await answerCallback(cbId, 'Signal dismissed');
      await logAudit(supabase, 'signal_dismissed', { signal_id: signalId });
      return res.status(200).send('OK');
    }

    await answerCallback(cbId, 'Unknown action');
    return res.status(200).send('OK');
  }

  // ── Command messages ──────────────────────────────────────
  const msg      = body.message || {};
  const text     = (msg.text || '').trim();
  const chatId   = msg.chat?.id?.toString();
  const userId   = msg.from?.id?.toString();
  const sender   = msg.from?.username || msg.from?.first_name || 'Unknown';

  // AI chat mode: any non-command text goes to Claude
  if (!text.startsWith('/')) {
    try {
      await cmdAsk(text.split(/\s+/), chatId, userId, sender);
    } catch (e) {
      console.error('Telegram AI error:', e);
      if (chatId) sendTelegram(chatId, `❌ AI error: ${e.message}`);
    }
    return res.status(200).send('OK');
  }

  const parts = text.split(/\s+/);
  const cmd   = parts[0].split('@')[0].toLowerCase();
  const args  = parts.slice(1);

  try {
    switch (cmd) {
      case '/signal': await cmdSignal(args, chatId, userId, sender); break;
      case '/market': await cmdMarket(args, chatId); break;
      case '/status': await cmdStatus(chatId); break;
      case '/scan':   await cmdScan(chatId); break;
      case '/close':  await cmdClose(args, chatId); break;
      case '/test':   await cmdTest(chatId); break;
      case '/help':   await cmdHelp(chatId); break;
      case '/start':  await cmdHelp(chatId); break;
      case '/ask':    await cmdAsk(args, chatId, userId, sender); break;
      default:
        if (chatId) sendTelegram(chatId, `Unknown command: ${cmd}\nTry /help`);
    }
  } catch (e) {
    console.error('Telegram command error:', e);
    if (chatId) sendTelegram(chatId, `❌ Error: ${e.message}`);
  }

  return res.status(200).send('OK');
}
