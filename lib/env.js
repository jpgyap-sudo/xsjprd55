// ============================================================
// Environment bootstrap
// Loads .env for local/server use and .env.prod as a production/VPS fallback.
// Existing process env values always win.
// ============================================================

import dotenv from 'dotenv';

if (!process.env.XSJPRD55_ENV_LOADED) {
  dotenv.config({ path: '.env' });

  const isProductionLike =
    process.env.NODE_ENV === 'production' ||
    process.env.DEPLOYMENT_TARGET === 'vps';

  const hasSupabase =
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_ANON_KEY);

  if (isProductionLike && !hasSupabase) {
    dotenv.config({ path: '.env.prod' });
  }

  process.env.XSJPRD55_ENV_LOADED = '1';
}
