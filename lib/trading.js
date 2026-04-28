// ============================================================
// Shared trading utilities — signal validation, formatting,
// exchange helpers, and safety gates.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import ccxt from 'ccxt';
import { config } from './config.js';
import { logger } from './logger.js';

// ── Signal Schema Validation ────────────────────────────────
export const REQUIRED_SIGNAL_FIELDS = ['symbol', 'side', 'entry_price', 'generated_at'];

export function validateSignal(raw) {
  const errors = [];
  for (const f of REQUIRED_SIGNAL_FIELDS) {
    if (raw[f] === undefined || raw[f] === null || raw[f] === '') {
      errors.push(`Missing required field: ${f}`);
    }
  }

  if (raw.side && !['LONG','SHORT','CLOSE'].includes(raw.side)) {
    errors.push(`Invalid side: ${raw.side}`);
  }

  if (raw.confidence !== undefined && (raw.confidence < 0 || raw.confidence > 1)) {
    errors.push('confidence must be between 0 and 1');
  }

  const priceFields = ['entry_price','stop_loss','take_profit'];
  for (const pf of priceFields) {
    const val = raw[pf];
    if (val !== undefined && val !== null) {
      if (Array.isArray(val)) {
        if (val.some(v => typeof v !== 'number' || Number.isNaN(v))) {
          errors.push(`${pf} contains invalid numbers`);
        }
      } else if (typeof val !== 'number' || Number.isNaN(val)) {
        errors.push(`${pf} must be a number`);
      }
    }
  }

  // Stale data gate (>5 min for intraday signals)
  const ts = raw.generated_at || raw.timestamp;
  if (ts) {
    const ageMs = Date.now() - new Date(ts).getTime();
    if (ageMs > 5 * 60 * 1000) {
      errors.push('Signal data is stale (>5 min old)');
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

// ── Build canonical signal object ───────────────────────────
export function buildSignal(opts) {
  const now = new Date().toISOString();
  const ttlMinutes = opts.ttl_minutes || 60;
  return {
    id: opts.id || uuidv4(),
    symbol: opts.symbol,
    side: opts.side,
    entry_price: opts.entry_price ?? opts.price ?? null,
    stop_loss: opts.stop_loss ?? null,
    take_profit: Array.isArray(opts.take_profit) ? opts.take_profit : (opts.take_profit ? [opts.take_profit] : []),
    confidence: opts.confidence ?? 0.5,
    strategy: opts.strategy || 'Unknown',
    timeframe: opts.timeframe || '1h',
    generated_at: opts.generated_at || now,
    valid_until: opts.valid_until || new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
    source: opts.source || 'unknown',
    mode: opts.mode || config.TRADING_MODE || 'paper',
    status: 'active',
    metadata: opts.metadata || {}
  };
}

// ── Telegram message formatter ──────────────────────────────
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

// ── Exchange helper (read-only by default) ──────────────────
export function createExchange(exchangeId = 'binance', opts = {}) {
  const ExchangeClass = ccxt[exchangeId];
  if (!ExchangeClass) throw new Error(`Unsupported exchange: ${exchangeId}`);

  const cfg = {
    enableRateLimit: true,
    ...opts
  };

  // Inject API keys only if provided (read-only recommended)
  const keyEnv = `${exchangeId.toUpperCase()}_API_KEY`;
  const secretEnv = `${exchangeId.toUpperCase()}_API_SECRET`;
  if (config[keyEnv] && config[secretEnv]) {
    cfg.apiKey = config[keyEnv];
    cfg.secret = config[secretEnv];
  }

  const ex = new ExchangeClass(cfg);
  logger.info(`[EXCHANGE] Created ${exchangeId} client (rate-limit enabled)`);
  return ex;
}

// ── Risk gates ──────────────────────────────────────────────
export async function checkRiskGates(user, proposedTrade, supabaseClient) {
  const issues = [];

  // Max position size
  const maxSize = user?.max_position_size ?? config.MAX_POSITION_SIZE_USD;
  const notional = (proposedTrade.quantity || 0) * (proposedTrade.entry_price || 0);
  if (notional > maxSize) {
    issues.push(`Position size $${notional.toFixed(2)} exceeds limit $${maxSize}`);
  }

  // Daily loss limit
  const dailyLimit = user?.daily_loss_limit ?? config.DAILY_LOSS_LIMIT_USD;
  const today = new Date().toISOString().slice(0, 10);
  if (supabaseClient) {
    const { data: todaysTrades } = await supabaseClient
      .from('trades')
      .select('pnl')
      .gte('opened_at', today)
      .eq('mode', proposedTrade.mode || 'paper');
    const dailyPnl = (todaysTrades || []).reduce((sum, t) => sum + (t.pnl || 0), 0);
    if (dailyPnl < -dailyLimit) {
      issues.push(`Daily loss limit $${dailyLimit} exceeded (current PnL: $${dailyPnl.toFixed(2)})`);
    }
  }

  // Cooldown
  const cooldownMins = user?.cooldown_minutes ?? config.SIGNAL_COOLDOWN_MINUTES;
  if (supabaseClient) {
    const cooldownAgo = new Date(Date.now() - cooldownMins * 60 * 1000).toISOString();
    const { data: recent } = await supabaseClient
      .from('signals')
      .select('generated_at')
      .eq('symbol', proposedTrade.symbol)
      .gte('generated_at', cooldownAgo)
      .order('generated_at', { ascending: false })
      .limit(1);
    if (recent?.length) {
      issues.push(`Cooldown active: last signal for ${proposedTrade.symbol} at ${recent[0].generated_at}`);
    }
  }

  // Auto-trading gate
  if (proposedTrade.mode === 'live' && !user?.auto_trade_enabled) {
    issues.push('Live auto-trading not enabled for this user');
  }

  if (issues.length) {
    logger.warn(`[RISK] Gate blocked: ${issues.join('; ')}`);
  }

  return { ok: issues.length === 0, issues };
}

// ── Audit helper ────────────────────────────────────────────
export async function logAudit(supabaseClient, eventType, details = {}) {
  if (!supabaseClient) return;
  try {
    await supabaseClient.from('audit_log').insert({
      event_type: eventType,
      symbol: details.symbol || null,
      user_id: details.user_id || null,
      details
    });
    logger.info(`[AUDIT] ${eventType} | ${details.symbol || '-'} | ${details.user_id || '-'}`);
  } catch (err) {
    logger.error(`[AUDIT] Failed to log ${eventType}: ${err.message}`);
  }
}
