// ============================================================
// Diagnostic Agent — Continuous API & Data Feed Monitor
// Runs as a background worker (PM2) on the VPS.
// Checks all APIs, data feeds, and alerts admin on failure.
// ============================================================

import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { sendTelegramMessage } from '../lib/telegram.js';

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between same alert

let lastAlertTimes = {};

// ── API Health Checks ────────────────────────────────────

async function checkApi(url, options = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok, latency: Date.now() - start, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message, latency: Date.now() - start };
  }
}

async function checkSupabase() {
  try {
    const start = Date.now();
    const { error } = await supabase.from('signals').select('id').limit(1);
    return { ok: !error, latency: Date.now() - start, error: error?.message };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkBinance() {
  return checkApi('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT');
}

async function checkBybit() {
  return checkApi('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT');
}

async function checkOkx() {
  return checkApi('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP');
}

async function checkHyperliquid() {
  return checkApi('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'meta' }),
  });
}

async function checkCoinGecko() {
  return checkApi('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
}

async function checkKimi() {
  if (!config.KIMI_API_KEY) return { ok: false, configured: false };
  const start = Date.now();
  try {
    const res = await fetch(`${config.KIMI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.KIMI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.KIMI_MODEL || 'kimi-k2-6',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok, latency: Date.now() - start, configured: true };
  } catch (e) {
    return { ok: false, error: e.message, latency: Date.now() - start, configured: true };
  }
}

async function checkAnthropic() {
  if (!config.ANTHROPIC_API_KEY) return { ok: false, configured: false };
  const start = Date.now();
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok, latency: Date.now() - start, configured: true };
  } catch (e) {
    return { ok: false, error: e.message, latency: Date.now() - start, configured: true };
  }
}

async function checkTelegram() {
  if (!config.TELEGRAM_BOT_TOKEN) return { ok: false, configured: false };
  return checkApi(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getMe`);
}

async function checkLunarCrush() {
  if (!config.LUNARCRUSH_API_KEY) return { ok: false, configured: false };
  return checkApi(`https://lunarcrush.com/api4/public/coins/list?key=${config.LUNARCRUSH_API_KEY}`);
}

// ── Data Feed Quality Checks ─────────────────────────────

async function checkDataFeeds() {
  const checks = {};
  const now = Date.now();

  // News freshness
  try {
    const { data } = await supabase
      .from('news_events')
      .select('ingested_at')
      .order('ingested_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const age = data?.ingested_at ? (now - new Date(data.ingested_at).getTime()) / 60000 : null;
    checks.news = { ok: age != null && age < 120, ageMin: age != null ? Math.round(age) : null, label: 'News' };
  } catch (e) {
    checks.news = { ok: false, error: e.message, label: 'News' };
  }

  // Signal freshness
  try {
    const { data } = await supabase
      .from('signals')
      .select('generated_at')
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const age = data?.generated_at ? (now - new Date(data.generated_at).getTime()) / 60000 : null;
    checks.signals = { ok: age != null && age < 60, ageMin: age != null ? Math.round(age) : null, label: 'Signals' };
  } catch (e) {
    checks.signals = { ok: false, error: e.message, label: 'Signals' };
  }

  // Market data freshness
  try {
    const { data } = await supabase
      .from('market_data')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const age = data?.updated_at ? (now - new Date(data.updated_at).getTime()) / 60000 : null;
    checks.marketData = { ok: age != null && age < 30, ageMin: age != null ? Math.round(age) : null, label: 'Market Data' };
  } catch (e) {
    checks.marketData = { ok: false, error: e.message, label: 'Market Data' };
  }

  // Mock trades
  try {
    const { count } = await supabase.from('mock_trades').select('*', { count: 'exact', head: true });
    checks.mockTrades = { ok: true, count: count || 0, label: 'Mock Trades' };
  } catch (e) {
    checks.mockTrades = { ok: false, error: e.message, label: 'Mock Trades' };
  }

  // Backtest results
  try {
    const { count } = await supabase.from('backtest_results').select('*', { count: 'exact', head: true });
    checks.backtests = { ok: true, count: count || 0, label: 'Backtests' };
  } catch (e) {
    checks.backtests = { ok: false, error: e.message, label: 'Backtests' };
  }

  return checks;
}

// ── Alert Logic ──────────────────────────────────────────

function shouldAlert(key) {
  const last = lastAlertTimes[key] || 0;
  if (Date.now() - last < ALERT_COOLDOWN_MS) return false;
  lastAlertTimes[key] = Date.now();
  return true;
}

async function sendAdminAlert(message) {
  const chatId = config.TELEGRAM_ADMIN_CHAT_ID || config.TELEGRAM_GROUP_CHAT_ID;
  if (!chatId) {
    logger.warn('[DIAG-AGENT] No admin chat ID configured for alerts');
    return;
  }
  try {
    await sendTelegramMessage(chatId, `🚨 *Diagnostic Alert*\n${message}`, { parse_mode: 'Markdown' });
    logger.info(`[DIAG-AGENT] Alert sent: ${message.slice(0, 80)}`);
  } catch (e) {
    logger.error(`[DIAG-AGENT] Failed to send alert: ${e.message}`);
  }
}

// ── Main Run ─────────────────────────────────────────────

async function runDiagnostics() {
  logger.info('[DIAG-AGENT] Starting diagnostic cycle…');

  const [
    supabaseStatus,
    binanceStatus,
    bybitStatus,
    okxStatus,
    hyperliquidStatus,
    coinGeckoStatus,
    kimiStatus,
    anthropicStatus,
    telegramStatus,
    lunarCrushStatus,
    dataFeeds,
  ] = await Promise.all([
    checkSupabase(),
    checkBinance(),
    checkBybit(),
    checkOkx(),
    checkHyperliquid(),
    checkCoinGecko(),
    checkKimi(),
    checkAnthropic(),
    checkTelegram(),
    checkLunarCrush(),
    checkDataFeeds(),
  ]);

  const apiResults = {
    supabase: supabaseStatus,
    binance: binanceStatus,
    bybit: bybitStatus,
    okx: okxStatus,
    hyperliquid: hyperliquidStatus,
    coingecko: coinGeckoStatus,
    kimi: kimiStatus,
    anthropic: anthropicStatus,
    telegram: telegramStatus,
    lunarcrush: lunarCrushStatus,
  };

  // Log summary
  const failedApis = Object.entries(apiResults).filter(([_, v]) => !v.ok);
  const staleFeeds = Object.entries(dataFeeds).filter(([_, v]) => !v.ok);

  logger.info(`[DIAG-AGENT] APIs: ${Object.keys(apiResults).length - failedApis.length}/${Object.keys(apiResults).length} OK | Data feeds: ${Object.keys(dataFeeds).length - staleFeeds.length}/${Object.keys(dataFeeds).length} OK`);

  // Send alerts for critical failures
  for (const [name, status] of failedApis) {
    const key = `api-${name}`;
    if (shouldAlert(key)) {
      const reason = status.configured === false ? 'Not configured' : status.error || `HTTP ${status.status}`;
      await sendAdminAlert(`❌ *${name.toUpperCase()}* API is down\nReason: ${reason}\nLatency: ${status.latency || 'N/A'}ms`);
    }
  }

  for (const [name, feed] of staleFeeds) {
    const key = `feed-${name}`;
    if (shouldAlert(key)) {
      const reason = feed.error || `Stale (${feed.ageMin}m old)`;
      await sendAdminAlert(`⚠️ *${feed.label}* data feed issue\nReason: ${reason}`);
    }
  }

  // Store diagnostic snapshot in Supabase (if table exists)
  try {
    await supabase.from('diagnostic_snapshots').insert({
      apis: apiResults,
      data_feeds: dataFeeds,
      failed_count: failedApis.length,
      stale_count: staleFeeds.length,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    // Table may not exist yet — ignore
  }
}

// ── Startup ──────────────────────────────────────────────

logger.info('[DIAG-AGENT] Diagnostic agent started (interval: 5min)');
runDiagnostics();
setInterval(runDiagnostics, INTERVAL_MS);
