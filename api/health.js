// ============================================================
// Health Check — /api/health
// Returns env status, Supabase, exchange, and Telegram health.
// Also runs as a cron every 30 minutes for uptime monitoring.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { createExchange } from '../lib/exchange.js';
import { getBotInfo } from '../lib/telegram.js';

export default async function handler(req, res) {
  const checks = {
    env: {},
    supabase: false,
    exchange: {},
    telegram: false,
    timestamp: new Date().toISOString()
  };

  // Environment
  checks.env.supabase_url = !!process.env.SUPABASE_URL;
  checks.env.telegram_token = !!process.env.TELEGRAM_BOT_TOKEN;
  checks.env.trading_mode = process.env.TRADING_MODE || 'paper';

  // Supabase
  try {
    const { data, error } = await supabase.from('signals').select('id').limit(1);
    checks.supabase = !error;
  } catch (e) {
    checks.supabase = false;
    checks.supabase_error = e.message;
  }

  // Exchange
  const exchanges = ['binance', 'bybit', 'okx'];
  for (const ex of exchanges) {
    try {
      const exchange = createExchange(ex);
      await exchange.loadMarkets();
      checks.exchange[ex] = { ok: true };
    } catch (e) {
      checks.exchange[ex] = { ok: false, error: e.message };
    }
  }

  // Telegram
  try {
    const botInfo = await getBotInfo();
    checks.telegram = !!botInfo;
    checks.bot_username = botInfo?.username || null;
  } catch (e) {
    checks.telegram = false;
    checks.telegram_error = e.message;
  }

  const allOk = checks.supabase && checks.telegram && Object.values(checks.exchange).every(e => e.ok);
  return res.status(allOk ? 200 : 503).json(checks);
}
