// ============================================================
// Health Check — /api/health
// Returns comprehensive status of all external APIs and services.
// Used by the dashboard "API Status" tab for real-time monitoring.
// ============================================================

import { config } from '../lib/config.js';
import { supabase } from '../lib/supabase.js';
import { createExchange } from '../lib/exchange.js';
import { getBotInfo } from '../lib/telegram.js';

async function checkSupabase() {
  try {
    const { error } = await supabase.from('signals').select('id').limit(1);
    return { ok: !error, latency: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkExchange(name) {
  try {
    const exchange = createExchange(name);
    const start = Date.now();
    await exchange.loadMarkets();
    return { ok: true, latency: Date.now() - start };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkTelegram() {
  try {
    const start = Date.now();
    const botInfo = await getBotInfo();
    return { ok: !!botInfo, latency: Date.now() - start, username: botInfo?.username || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkKimi() {
  const apiKey = config.KIMI_API_KEY;
  if (!apiKey) return { ok: false, error: 'KIMI_API_KEY not configured', configured: false };
  try {
    const start = Date.now();
    const res = await fetch(`${config.KIMI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.KIMI_MODEL || 'kimi-latest',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1
      })
    });
    return { ok: res.ok, latency: Date.now() - start, configured: true };
  } catch (e) {
    return { ok: false, error: e.message, configured: true };
  }
}

async function checkAnthropic() {
  const apiKey = config.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY not configured', configured: false };
  try {
    const start = Date.now();
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    });
    return { ok: res.ok, latency: Date.now() - start, configured: true };
  } catch (e) {
    return { ok: false, error: e.message, configured: true };
  }
}

async function checkCoinGecko() {
  try {
    const start = Date.now();
    const res = await fetch('https://api.coingecko.com/api/v3/ping');
    return { ok: res.ok, latency: Date.now() - start };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkOkxFunding() {
  try {
    const start = Date.now();
    const res = await fetch('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP');
    return { ok: res.ok, latency: Date.now() - start };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkHyperliquid() {
  try {
    const start = Date.now();
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'meta' })
    });
    return { ok: res.ok, latency: Date.now() - start };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkLunarCrush() {
  const apiKey = config.LUNARCRUSH_API_KEY;
  if (!apiKey) return { ok: false, error: 'LUNARCRUSH_API_KEY not configured', configured: false };
  try {
    const start = Date.now();
    const res = await fetch(`https://lunarcrush.com/api3/coins?key=${apiKey}&limit=1`);
    return { ok: res.ok, latency: Date.now() - start, configured: true };
  } catch (e) {
    return { ok: false, error: e.message, configured: true };
  }
}

export default async function handler(req, res) {
  try {
    const [
      supabaseStatus,
      binanceStatus,
      bybitStatus,
      okxStatus,
      hyperliquidStatus,
      telegramStatus,
      kimiStatus,
      anthropicStatus,
      coinGeckoStatus,
      okxFundingStatus,
      lunarCrushStatus
    ] = await Promise.all([
      checkSupabase(),
      checkExchange('binance'),
      checkExchange('bybit'),
      checkExchange('okx'),
      checkHyperliquid(),
      checkTelegram(),
      checkKimi(),
      checkAnthropic(),
      checkCoinGecko(),
      checkOkxFunding(),
      checkLunarCrush()
    ]);

    const checks = {
      env: {
        ai_provider: config.AI_PROVIDER,
        trading_mode: config.TRADING_MODE,
        deployment_target: config.DEPLOYMENT_TARGET
      },
      services: {
        supabase: supabaseStatus,
        telegram: telegramStatus,
        coingecko: coinGeckoStatus,
        okx_funding: okxFundingStatus
      },
      exchanges: {
        binance: binanceStatus,
        bybit: bybitStatus,
        okx: okxStatus,
        hyperliquid: hyperliquidStatus
      },
      ai: {
        kimi: kimiStatus,
        anthropic: anthropicStatus
      },
      data_feeds: {
        lunarcrush: lunarCrushStatus
      },
      timestamp: new Date().toISOString()
    };

    const allOk = [
      supabaseStatus.ok,
      binanceStatus.ok,
      telegramStatus.ok,
      coinGeckoStatus.ok
    ].every(Boolean);

    return res.status(allOk ? 200 : 503).json({ ok: true, checks });
  } catch (e) {
    console.error('[health] Error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
