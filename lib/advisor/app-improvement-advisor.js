// ============================================================
// App Improvement Advisor
// Generates actionable upgrade suggestions based on backtest
// performance, data quality, and infrastructure health.
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';

export function generateSuggestions({ featurePerformance = [], infra = {}, dataQuality = {} }) {
  const suggestions = [];

  const liquidationImpact = featurePerformance.find(x => x.feature === 'liquidation');
  if (liquidationImpact?.winRateLift >= 5 && (dataQuality.liquidation || 0) < 60) {
    suggestions.push({
      category: 'data_subscription',
      priority: 'high',
      title: 'Upgrade liquidation data source',
      reason: 'Liquidation features improved win rate, but crawler/screenshot quality is inconsistent.',
      expected_accuracy_impact: 'medium to high',
      estimated_cost: 'Depends on Coinglass or alternative provider plan',
      suggested_provider: 'Coinglass API or liquidation-data alternative',
    });
  }

  if ((dataQuality.social || 0) < 50) {
    suggestions.push({
      category: 'api_subscription',
      priority: 'medium',
      title: 'Improve social signal coverage',
      reason: 'Social score has low data quality. Meme and narrative trades need better X/Telegram coverage.',
      expected_accuracy_impact: 'medium for meme coins, low for BTC/ETH',
      estimated_cost: 'Depends on X API/social data provider',
      suggested_provider: 'X API, Telegram ingestion, or third-party sentiment provider',
    });
  }

  if ((infra.workerCrashes24h || 0) >= 3 || (infra.cpuPct || 0) > 80) {
    suggestions.push({
      category: 'server_upgrade',
      priority: 'high',
      title: 'Upgrade VPS resources',
      reason: 'Backtest workers are crashing or CPU is saturated.',
      expected_accuracy_impact: 'indirect: enables more symbols and deeper tests',
      estimated_cost: 'DigitalOcean 4GB/8GB droplet or higher',
      suggested_provider: 'DigitalOcean',
    });
  }

  if ((infra.queueDelayMinutes || 0) > 10) {
    suggestions.push({
      category: 'tech_stack',
      priority: 'medium',
      title: 'Add Redis + BullMQ job queue',
      reason: 'Backtest jobs are overlapping and delaying signal evaluation.',
      expected_accuracy_impact: 'indirect: cleaner scheduling and fewer missed signals',
      estimated_cost: 'Free/self-hosted Redis or managed Redis',
      suggested_provider: 'Redis/BullMQ',
    });
  }

  return suggestions;
}

export async function saveSuggestions(suggestions) {
  if (!suggestions?.length) return;
  const { error } = await supabase.from('app_improvement_suggestions').insert(
    suggestions.map(s => ({ ...s, status: 'pending' }))
  );
  if (error) logger.error(`[ADVISOR] Failed to save suggestions: ${error.message}`);
  else logger.info(`[ADVISOR] Saved ${suggestions.length} suggestions`);
}
