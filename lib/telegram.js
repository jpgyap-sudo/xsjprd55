// ============================================================
// Telegram Helpers — xsjprd55
// Send, edit, format messages and build inline keyboards.
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID  = process.env.TELEGRAM_GROUP_CHAT_ID;

if (!BOT_TOKEN) {
  console.warn('TELEGRAM_BOT_TOKEN not set — Telegram features will be disabled');
}

export async function sendTelegram(chatId, text, extra = {}) {
  if (!BOT_TOKEN) return;
  const target = chatId || GROUP_ID;
  if (!target) throw new Error('No chat_id provided and TELEGRAM_GROUP_CHAT_ID not set');

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: target, text, parse_mode: 'Markdown', ...extra })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram send failed: ${data.description}`);
  return data.result;
}

export async function editMessage(chatId, messageId, text, extra = {}) {
  if (!BOT_TOKEN) return;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown', ...extra })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram edit failed: ${data.description}`);
  return data.result;
}

export async function answerCallback(callbackId, text) {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text })
  });
}

export function formatSignalMessage(s) {
  const emojis = { LONG: '🟢', SHORT: '🔴', CLOSE: '⚪' };
  const modeEmoji = s.mode === 'live' ? '💰 LIVE' : '📰 PAPER';
  const tpLines = (s.take_profit || []).map((tp, i) => `   TP${i + 1}: ${tp}`).join('\n');

  let msg = `${emojis[s.side] || ''} *${s.side}* — ${s.symbol}\n`;
  msg += `_${s.strategy}_ | ${s.timeframe} | ${modeEmoji}\n\n`;
  if (s.entry_price) msg += `📍 Entry: ${s.entry_price}\n`;
  if (s.stop_loss)   msg += `🛑 Stop:  ${s.stop_loss}\n`;
  if (tpLines)       msg += `${tpLines}\n`;
  msg += `\n🎯 Confidence: ${Math.round((s.confidence || 0) * 100)}%\n`;
  msg += `⏳ Valid until: ${s.valid_until ? new Date(s.valid_until).toISOString() : 'N/A'}\n`;
  msg += `🆔 \`${s.id}\``;
  return msg;
}

export function signalKeyboard(signalId) {
  return {
    inline_keyboard: [[
      { text: '✅ Confirm', callback_data: `sig_confirm_${signalId}` },
      { text: '❌ Dismiss', callback_data: `sig_dismiss_${signalId}` }
    ]]
  };
}

export async function getBotInfo() {
  if (!BOT_TOKEN) return null;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
  const data = await res.json();
  return data.ok ? data.result : null;
}
