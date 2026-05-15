// ============================================================
// Telegram Helpers — xsjprd55
// Send, edit, format messages and build inline keyboards.
// Includes per-chat token-bucket rate limiting.
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID  = process.env.TELEGRAM_GROUP_CHAT_ID;

if (!BOT_TOKEN) {
  console.warn('TELEGRAM_BOT_TOKEN not set — Telegram features will be disabled');
}

// ── Rate Limiter (token bucket per chat) ────────────────────
const RATE_LIMIT_TOKENS  = parseInt(process.env.TELEGRAM_RATE_LIMIT_TOKENS || '25', 10);
const RATE_LIMIT_WINDOW  = parseInt(process.env.TELEGRAM_RATE_LIMIT_WINDOW_MS || '60000', 10);
const buckets = new Map();

/**
 * Check if a message to chatId is allowed under the rate limit.
 * Returns { allowed, waitMs } — if !allowed, caller should delay by waitMs.
 */
function checkRateLimit(chatId) {
  const now = Date.now();
  let bucket = buckets.get(chatId);
  if (!bucket) {
    bucket = { tokens: RATE_LIMIT_TOKENS, lastRefill: now };
    buckets.set(chatId, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  const refill = Math.floor(elapsed / (RATE_LIMIT_WINDOW / RATE_LIMIT_TOKENS));
  if (refill > 0) {
    bucket.tokens = Math.min(RATE_LIMIT_TOKENS, bucket.tokens + refill);
    bucket.lastRefill = now;
  }

  if (bucket.tokens > 0) {
    bucket.tokens -= 1;
    return { allowed: true, waitMs: 0 };
  }

  // Calculate time until next token
  const msPerToken = RATE_LIMIT_WINDOW / RATE_LIMIT_TOKENS;
  const waitMs = Math.ceil(msPerToken - (now - bucket.lastRefill) % msPerToken);
  return { allowed: false, waitMs };
}

/**
 * Send a Telegram message with built-in rate limiting.
 * If rate limited, automatically queues and retries after the required delay.
 */
export async function sendTelegram(chatId, text, extra = {}) {
  if (!BOT_TOKEN) return;
  const target = chatId || GROUP_ID;
  if (!target) throw new Error('No chat_id provided and TELEGRAM_GROUP_CHAT_ID not set');

  const { allowed, waitMs } = checkRateLimit(target);
  if (!allowed) {
    // Queue and retry after wait
    await new Promise(resolve => setTimeout(resolve, waitMs));
    // Re-check after waiting
    const retry = checkRateLimit(target);
    if (!retry.allowed) {
      console.warn(`[TELEGRAM] Rate limited for ${target}, dropping message (too many queued)`);
      return;
    }
  }

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
  if (!s || typeof s !== 'object') {
    return '⚠️ *Invalid signal data*';
  }
  const emojis = { LONG: '🟢', SHORT: '🔴', CLOSE: '⚪' };
  const modeEmoji = s.mode === 'live' ? '💰 LIVE' : '📰 PAPER';
  const tpLines = (s.take_profit || []).map((tp, i) => `   TP${i + 1}: ${tp}`).join('\n');

  // Calculate R/R ratio
  let rrRatio = null;
  if (s.entry_price && s.stop_loss && s.take_profit?.length) {
    const slDist = Math.abs(s.entry_price - s.stop_loss);
    const tpDist = Math.abs(s.take_profit[0] - s.entry_price);
    if (slDist > 0) rrRatio = (tpDist / slDist).toFixed(2);
  }

  let msg = `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${emojis[s.side] || ''} *${s.side || 'UNKNOWN'} SIGNAL* — ${s.symbol || 'UNKNOWN'}\n`;
  msg += `_${s.strategy || 'unknown'}_ | ${s.timeframe || '-'} | ${modeEmoji}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (s.entry_price) msg += `📍 *Entry:* $${s.entry_price}\n`;
  if (s.stop_loss)   msg += `🛑 *Stop Loss:* $${s.stop_loss}\n`;
  if (tpLines)       msg += `${tpLines}\n`;
  if (rrRatio)       msg += `📐 *R/R Ratio:* ${rrRatio}\n`;
  msg += `\n🎯 *Confidence:* ${Math.round((s.confidence || 0) * 100)}%\n`;
  if (s.source)      msg += `📡 *Source:* ${s.source}\n`;
  msg += `⏳ *Valid until:* ${s.valid_until ? new Date(s.valid_until).toISOString() : 'N/A'}\n`;
  msg += `🆔 \`${s.id || 'N/A'}\``;
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
