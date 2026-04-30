// ============================================================
// Centralized Configuration — safe defaults, typed env parsing
// VPS/Express deployment (DigitalOcean). No Vercel.
// ============================================================

import './env.js';

function boolEnv(val, fallback = false) {
  if (val === undefined || val === null) return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(val).toLowerCase());
}

function numEnv(val, fallback = 0) {
  const n = Number(val);
  return Number.isNaN(n) ? fallback : n;
}

export const config = {
  // ── Deployment ────────────────────────────────────────────
  NODE_ENV: process.env.NODE_ENV || 'development',
  DEPLOYMENT_TARGET: process.env.DEPLOYMENT_TARGET || 'vps',
  PORT: numEnv(process.env.PORT, 3000),
  HOST: process.env.HOST || '0.0.0.0',
  APP_URL: process.env.APP_URL || '',

  // ── Supabase ──────────────────────────────────────────────
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',

  // ── Telegram ──────────────────────────────────────────────
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_GROUP_CHAT_ID: process.env.TELEGRAM_GROUP_CHAT_ID || '',

  // ── AI Provider ───────────────────────────────────────────
  AI_PROVIDER: process.env.AI_PROVIDER || 'kimi',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  KIMI_API_KEY: process.env.KIMI_API_KEY || '',
  KIMI_MODEL: process.env.KIMI_MODEL || 'kimi-k2-6',
  KIMI_BASE_URL: process.env.KIMI_BASE_URL || 'https://api.moonshot.ai/v1',
  KIMI_MAX_TOKENS: numEnv(process.env.KIMI_MAX_TOKENS, 4096),
  ANTHROPIC_MAX_TOKENS: numEnv(process.env.ANTHROPIC_MAX_TOKENS, 4096),

  // ── Exchange ──────────────────────────────────────────────
  BINANCE_API_KEY: process.env.BINANCE_API_KEY || '',
  BINANCE_API_SECRET: process.env.BINANCE_API_SECRET || '',
  BYBIT_API_KEY: process.env.BYBIT_API_KEY || '',
  BYBIT_API_SECRET: process.env.BYBIT_API_SECRET || '',

  // ── Trading ───────────────────────────────────────────────
  TRADING_MODE: process.env.TRADING_MODE || 'paper',
  DEFAULT_PAIRS: (process.env.DEFAULT_PAIRS || [
    'BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','XRP/USDT',
    'DOGE/USDT','ADA/USDT','AVAX/USDT','LINK/USDT','LTC/USDT',
    'DOT/USDT','UNI/USDT','AAVE/USDT','SUI/USDT','SEI/USDT',
    'INJ/USDT','RNDR/USDT','ARB/USDT','OP/USDT','STRK/USDT',
    'TIA/USDT','FET/USDT','WLD/USDT','PYTH/USDT','JUP/USDT',
    'JTO/USDT','BONK/USDT','PEPE/USDT','WIF/USDT','SHIB/USDT',
    'FLOKI/USDT','ENA/USDT','W/USDT','TAO/USDT','ARKM/USDT',
    'MEME/USDT','BEAM/USDT','RUNE/USDT','NEAR/USDT','APT/USDT',
    'TRX/USDT','ETC/USDT','XLM/USDT','FIL/USDT','ALGO/USDT',
    'ATOM/USDT','IMX/USDT','GRT/USDT','STX/USDT','FLOW/USDT',
    'SAND/USDT','MANA/USDT','AXS/USDT','CHZ/USDT','CRV/USDT',
    'DYDX/USDT','GMX/USDT','SNX/USDT','COMP/USDT','MKR/USDT',
    'YFI/USDT','BAL/USDT','1INCH/USDT','ZRX/USDT','LDO/USDT',
    'PENDLE/USDT','Eigen/USDT','ZRO/USDT','LISTA/USDT','NOT/USDT'
  ].join(',')).split(','),
  TIMEFRAMES: (process.env.TIMEFRAMES || '15m,1h,4h').split(','),
  SCAN_EXCHANGES: (process.env.SCAN_EXCHANGES || 'binance,bybit,okx,hyperliquid').split(','),
  PRICE_SOURCE_ORDER: process.env.PRICE_SOURCE_ORDER || 'hyperliquid,binance,bybit,okx',

  // ── Risk ──────────────────────────────────────────────────
  MAX_POSITION_SIZE_USD: numEnv(process.env.MAX_POSITION_SIZE_USD, 100),
  DAILY_LOSS_LIMIT_USD: numEnv(process.env.DAILY_LOSS_LIMIT_USD, 50),
  SIGNAL_COOLDOWN_MINUTES: numEnv(process.env.SIGNAL_COOLDOWN_MINUTES, 15),

  // ── LunarCrush ────────────────────────────────────────────
  LUNARCRUSH_API_KEY: process.env.LUNARCRUSH_API_KEY || '',

  // ── Cron schedules (VPS workers / cron-job.org) ──────────
  CRON_SIGNALS: process.env.CRON_SIGNALS || '*/15 * * * *',
  CRON_MARKET: process.env.CRON_MARKET || '0 * * * *',
  CRON_WEEKLY: process.env.CRON_WEEKLY || '0 4 * * 0',

  // ── Logging ───────────────────────────────────────────────
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_TO_FILE: boolEnv(process.env.LOG_TO_FILE, false),
  LOG_DIR: process.env.LOG_DIR || './logs',

  // ── Feature flags ─────────────────────────────────────────
  ENABLE_NEWS: boolEnv(process.env.ENABLE_NEWS, true),
  ENABLE_SOCIAL: boolEnv(process.env.ENABLE_SOCIAL, true),
  ENABLE_WEBSOCKET: boolEnv(process.env.ENABLE_WEBSOCKET, false),
  ENABLE_OI_WORKER: boolEnv(process.env.ENABLE_OI_WORKER, true),
  ENABLE_LIQUIDATION_WORKER: boolEnv(process.env.ENABLE_LIQUIDATION_WORKER, true),
  ENABLE_HEALTH_WORKER: boolEnv(process.env.ENABLE_HEALTH_WORKER, true),
  ENABLE_NOTIFICATION_WORKER: boolEnv(process.env.ENABLE_NOTIFICATION_WORKER, true),
  ENABLE_FALLBACK_CRAWLER: boolEnv(process.env.ENABLE_FALLBACK_CRAWLER, true),
  ENABLE_CONTINUOUS_BACKTESTER: boolEnv(process.env.ENABLE_CONTINUOUS_BACKTESTER, true),
  ENABLE_MOCK_TRADING_WORKER: boolEnv(process.env.ENABLE_MOCK_TRADING_WORKER, true),
  ENABLE_RESEARCH_AGENT_WORKER: boolEnv(process.env.ENABLE_RESEARCH_AGENT_WORKER, true),
  ENABLE_APP_IMPROVEMENT_WORKER: boolEnv(process.env.ENABLE_APP_IMPROVEMENT_WORKER, true),
  ENABLE_CAPABILITY_CONSOLIDATOR: boolEnv(process.env.ENABLE_CAPABILITY_CONSOLIDATOR, true),
  ENABLE_LEARNING_WORKER: boolEnv(process.env.ENABLE_LEARNING_WORKER, true),
  ENABLE_DIAGNOSTIC_WORKER: boolEnv(process.env.ENABLE_DIAGNOSTIC_WORKER, true),
  ENABLE_SOCIAL_CRAWLER_WORKER: boolEnv(process.env.ENABLE_SOCIAL_CRAWLER_WORKER, true),
  ENABLE_WALLET_TRACKER_WORKER: boolEnv(process.env.ENABLE_WALLET_TRACKER_WORKER, true),
  WALLET_TRACKER_INTERVAL_MS: numEnv(process.env.WALLET_TRACKER_INTERVAL_MS, 300000),

  // ── Neural Social Intelligence ────────────────────────────
  ENABLE_SOCIAL_NEURAL_WORKER: boolEnv(process.env.ENABLE_SOCIAL_NEURAL_WORKER, true),
  NEURAL_NLP_PROVIDER: process.env.NEURAL_NLP_PROVIDER || 'heuristic',
  SOCIAL_WORKER_INTERVAL_SECONDS: numEnv(process.env.SOCIAL_WORKER_INTERVAL_SECONDS, 300),
  SOCIAL_MAX_ITEMS_PER_SOURCE: numEnv(process.env.SOCIAL_MAX_ITEMS_PER_SOURCE, 25),
  SOCIAL_DEFAULT_SYMBOLS: process.env.SOCIAL_DEFAULT_SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT',

  // ── Learning Loop ─────────────────────────────────────────
  CRON_LEARNING: process.env.CRON_LEARNING || '0 */6 * * *',

  // ── Backtesting / Mock Trading ────────────────────────────
  MOCK_STARTING_BALANCE: numEnv(process.env.MOCK_STARTING_BALANCE, 1000),
  MOCK_MAX_LEVERAGE: numEnv(process.env.MOCK_MAX_LEVERAGE, 3),
  MOCK_RISK_PER_TRADE_PCT: numEnv(process.env.MOCK_RISK_PER_TRADE_PCT, 1),

  // ── WebSocket (VPS only) ──────────────────────────────────
  WS_PORT: numEnv(process.env.WS_PORT, 8080),

  // ── Admin alerts ──────────────────────────────────────────
  TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID || '',
};
