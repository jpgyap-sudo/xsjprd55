// ============================================================
// Data Health Worker
// Checks all configured sources and updates health status.
// Runs every 60 seconds.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { createExchange } from '../lib/trading.js';
import { updateSourceHealth } from '../lib/data-health.js';
import { dedupSendIdea } from '../lib/agent-improvement-bus.js';
import { isMainModule } from '../lib/entrypoint.js';

const SOURCES = [
  { name: 'Binance', type: 'exchange' },
  { name: 'Bybit', type: 'exchange' },
  { name: 'OKX', type: 'exchange' },
  { name: 'Hyperliquid', type: 'exchange' },
  { name: 'CoinGlass', type: 'aggregator' },
];
const INTERVAL_MS = 60 * 1000;

async function pingExchange(name) {
  try {
    const ex = createExchange(name.toLowerCase());
    await ex.loadMarkets();
    return { ok: true, latency_ms: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function runDataHealthWorker() {
  if (!config.ENABLE_HEALTH_WORKER) {
    logger.debug('[HEALTH-WORKER] Disabled by config');
    return;
  }

  const results = [];
  for (const source of SOURCES) {
    try {
      let status = { ok: false, error: 'Unknown' };
      if (source.type === 'exchange') {
        status = await pingExchange(source.name);
      }
      // Aggregators like CoinGlass — placeholder ping
      if (source.name === 'CoinGlass') {
        status = { ok: true }; // Replace with real ping when API available
      }

      await updateSourceHealth({
        sourceName: source.name,
        dataType: 'market',
        apiStatus: status.ok ? 'online' : 'error',
        crawlerStatus: 'not_needed',
        fallbackUsed: false,
        error: status.error || null,
      });

      results.push({ name: source.name, status: status.ok ? 'online' : 'error' });
      logger.info(`[HEALTH-WORKER] ${source.name}: ${status.ok ? 'online' : 'error'}`);
    } catch (err) {
      results.push({ name: source.name, status: 'error' });
      logger.error(`[HEALTH-WORKER] ${source.name} check error: ${err.message}`);
    }
  }

  // Cross-agent improvement: flag unreliable data sources
  const failing = results.filter(r => r.status !== 'online');
  if (failing.length >= 2) {
    await dedupSendIdea({
      sourceBot: 'Trading Signal Bot',
      ideaType: 'Data Source Improvement',
      featureAffected: 'Exchange API Health',
      observation: `${failing.length} data sources are offline: ${failing.map(f => f.name).join(', ')}.`,
      recommendation: 'Increase crawler fallback coverage and add redundant exchange APIs. Evaluate alternative data providers.',
      expectedBenefit: 'Maintain signal quality even when primary APIs are down.',
      priority: failing.some(f => f.name === 'hyperliquid') ? 'Critical' : 'High',
      confidence: 'High',
      status: 'New',
    });
  }
}

if (isMainModule(import.meta.url)) {
  logger.info('[HEALTH-WORKER] Starting loop...');
  await runDataHealthWorker();
  setInterval(runDataHealthWorker, INTERVAL_MS);
}
