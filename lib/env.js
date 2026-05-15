// ============================================================
// Environment bootstrap
// Loads .env for local/server use and .env.prod as a production/VPS fallback.
// Existing process env values always win.
// ============================================================

import dotenv from 'dotenv';

const isPlaceholder = (value) =>
  !value ||
  value.startsWith('your-') ||
  value.includes('your-project') ||
  value.includes('localhost');

function hasUsableSupabaseEnv() {
  return (
    !isPlaceholder(process.env.SUPABASE_URL) &&
    (!isPlaceholder(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
      !isPlaceholder(process.env.SUPABASE_SERVICE_KEY) ||
      !isPlaceholder(process.env.SUPABASE_ANON_KEY))
  );
}

// ── Critical env var validation ──────────────────────────────
// Logs warnings for missing critical variables at startup.
// Does NOT block execution — the app should degrade gracefully.
const CRITICAL_ENV_VARS = [
  { key: 'SUPABASE_URL', label: 'Supabase URL', required: true },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase Service Role Key', required: true },
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot Token', required: false },
  { key: 'CRON_SECRET', label: 'Cron Secret', required: false },
  { key: 'BINANCE_API_KEY', label: 'Binance API Key', required: false },
  { key: 'BINANCE_API_SECRET', label: 'Binance API Secret', required: false },
];

export function validateEnv() {
  const missing = [];
  const placeholders = [];

  for (const { key, label, required } of CRITICAL_ENV_VARS) {
    const value = process.env[key];
    if (!value) {
      missing.push(label);
    } else if (isPlaceholder(value)) {
      placeholders.push(label);
    }
  }

  if (missing.length > 0) {
    console.warn(`[env] Missing critical env vars: ${missing.join(', ')}`);
  }
  if (placeholders.length > 0) {
    console.warn(`[env] Placeholder values detected for: ${placeholders.join(', ')}`);
  }

  return { missing, placeholders, ok: missing.length === 0 };
}

if (!process.env.XSJPRD55_ENV_LOADED) {
  dotenv.config({ path: '.env' });

  const isProductionLike =
    process.env.NODE_ENV === 'production' ||
    process.env.DEPLOYMENT_TARGET === 'vps';

  if (isProductionLike && !hasUsableSupabaseEnv()) {
    const prodEnv = dotenv.config({ path: '.env.prod' }).parsed || {};
    for (const [key, value] of Object.entries(prodEnv)) {
      if (isPlaceholder(process.env[key])) {
        process.env[key] = value;
      }
    }
  }

  process.env.XSJPRD55_ENV_LOADED = '1';

  // Run validation after loading
  validateEnv();
}
