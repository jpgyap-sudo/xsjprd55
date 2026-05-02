// ============================================================
// App Improvement Advisor Worker
// Generates suggestions based on backtest performance & infra.
// Runs every 60 minutes on VPS.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { generateSuggestions, saveSuggestions } from '../lib/advisor/app-improvement-advisor.js';
import { isMainModule } from '../lib/entrypoint.js';

const INTERVAL_MS = 60 * 60 * 1000;

export async function runAppImprovementWorker() {
  if (!config.ENABLE_APP_IMPROVEMENT_WORKER) {
    logger.debug('[ADVISOR-WORKER] Disabled by config');
    return;
  }

  logger.info('[ADVISOR-WORKER] Tick');

  try {
    // Gather feature performance from backtest results
    const { data: perf } = await supabase
      .from('backtest_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    const featurePerformance = [];
    if (perf?.length) {
      const avgWinRate = perf.reduce((s, r) => s + (r.win_rate || 0), 0) / perf.length;
      featurePerformance.push({ feature: 'backtest_overall', winRateLift: avgWinRate - 50 });
    }

    // Mock infra metrics (replace with real metrics if available)
    const infra = { workerCrashes24h: 0, cpuPct: 30, queueDelayMinutes: 0 };

    // Data quality mock (could come from data_source_health)
    const { data: health } = await supabase
      .from('data_source_health')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    const dataQuality = {};
    for (const h of health || []) {
      dataQuality[h.data_type || h.source_name] = h.api_status === 'online' ? 80 : 40;
    }

    const suggestions = generateSuggestions({ featurePerformance, infra, dataQuality });
    await saveSuggestions(suggestions);

    logger.info(`[ADVISOR-WORKER] Generated ${suggestions.length} suggestions`);
  } catch (err) {
    logger.error(`[ADVISOR-WORKER] ${err.message}`);
  }
}

if (isMainModule(import.meta.url)) {
  logger.info('[ADVISOR-WORKER] Starting loop...');
  await runAppImprovementWorker();
  setInterval(runAppImprovementWorker, INTERVAL_MS);
}
