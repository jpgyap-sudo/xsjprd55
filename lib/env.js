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
}
