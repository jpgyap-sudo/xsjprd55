// ============================================================
// Data Source Health Tracker
// Updates the data_source_health table in Supabase.
// ============================================================

import { supabase } from './supabase.js';
import { logger } from './logger.js';

/**
 * Upsert health status for a data source.
 */
export async function updateSourceHealth({
  sourceName,
  dataType,
  apiStatus = 'online',
  crawlerStatus = 'not_needed',
  fallbackUsed = false,
  error = null,
}) {
  try {
    const { error: upsertErr } = await supabase
      .from('data_source_health')
      .upsert({
        source_name: sourceName,
        source_type: 'exchange',
        data_type: dataType,
        api_status: apiStatus,
        crawler_status: crawlerStatus,
        fallback_used: fallbackUsed,
        last_success_at: apiStatus === 'online' ? new Date().toISOString() : undefined,
        last_error_at: error ? new Date().toISOString() : undefined,
        last_error_message: error || undefined,
        accuracy_impact: computeAccuracyImpact(apiStatus, crawlerStatus),
        recommended_fix: error ? 'Check API key, subscription, or network connectivity.' : undefined,
      }, { onConflict: 'source_name,data_type' });

    if (upsertErr) throw upsertErr;
  } catch (err) {
    logger.error(`[DATA-HEALTH] Failed to update ${sourceName}: ${err.message}`);
  }
}

function computeAccuracyImpact(apiStatus, crawlerStatus) {
  if (apiStatus === 'online') return 'low';
  if (crawlerStatus === 'online') return 'medium';
  return 'high';
}

/**
 * Get overall system health summary.
 */
export async function getSystemHealth() {
  try {
    const { data, error } = await supabase
      .from('data_source_health')
      .select('*')
      .order('last_error_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  } catch (err) {
    logger.error(`[DATA-HEALTH] getSystemHealth error: ${err.message}`);
    return [];
  }
}
