// Diagnostic endpoint — dynamically imports each lib to find which crashes
export default async function handler(req, res) {
  const results = {};

  try {
    const { supabase } = await import('../lib/supabase.js');
    results.supabase = 'loaded';
    const { data, error } = await supabase.from('signals').select('id').limit(1);
    results.supabase_query = error ? `query error: ${error.message}` : 'query ok';
  } catch (e) {
    results.supabase = `load error: ${e.message}`;
  }

  try {
    const { createExchange } = await import('../lib/exchange.js');
    results.exchange = 'loaded';
    try {
      const ex = createExchange('binance');
      await ex.loadMarkets();
      results.exchange_markets = 'ok';
    } catch (e2) {
      results.exchange_markets = `market error: ${e2.message}`;
    }
  } catch (e) {
    results.exchange = `load error: ${e.message}`;
  }

  try {
    const tg = await import('../lib/telegram.js');
    results.telegram = 'loaded';
    try {
      const info = await tg.getBotInfo();
      results.telegram_bot = info ? `ok (@${info.username})` : 'no bot info';
    } catch (e2) {
      results.telegram_bot = `bot error: ${e2.message}`;
    }
  } catch (e) {
    results.telegram = `load error: ${e.message}`;
  }

  try {
    const se = await import('../lib/signal-engine.js');
    results.signal_engine = 'loaded';
  } catch (e) {
    results.signal_engine = `load error: ${e.message}`;
  }

  try {
    const risk = await import('../lib/risk.js');
    results.risk = 'loaded';
  } catch (e) {
    results.risk = `load error: ${e.message}`;
  }

  results.env = {
    supabase_url: !!process.env.SUPABASE_URL,
    service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    telegram_token: !!process.env.TELEGRAM_BOT_TOKEN,
    node_env: process.env.NODE_ENV,
    vercel_env: process.env.VERCEL_ENV,
  };

  results.timestamp = new Date().toISOString();
  return res.status(200).json(results);
}
