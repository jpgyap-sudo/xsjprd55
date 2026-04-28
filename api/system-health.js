// ============================================================
// System Health API
// GET /api/system-health
// Returns data source health, recent errors, and accuracy impact.
// ============================================================

import { getSystemHealth } from '../lib/data-health.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sources = await getSystemHealth();

    // Count notifications by level
    const { data: notifications } = await supabase
      .from('system_notifications')
      .select('level, is_read')
      .order('created_at', { ascending: false })
      .limit(50);

    const unreadCritical = (notifications || []).filter(n => n.level === 'critical' && !n.is_read).length;
    const unreadWarning = (notifications || []).filter(n => n.level === 'warning' && !n.is_read).length;

    const summary = {
      total_sources: sources.length,
      online: sources.filter(s => s.api_status === 'online').length,
      api_errors: sources.filter(s => s.api_status === 'error').length,
      crawler_fallback: sources.filter(s => s.crawler_status === 'online').length,
      unread_critical: unreadCritical,
      unread_warning: unreadWarning,
    };

    logger.info('[SYSTEM-HEALTH] Health check served');
    return res.status(200).json({
      summary,
      sources: sources.map(s => ({
        source: s.source_name,
        type: s.source_type,
        data_type: s.data_type,
        api_status: s.api_status,
        crawler_status: s.crawler_status,
        fallback_used: s.fallback_used,
        last_success: s.last_success_at,
        last_error: s.last_error_at,
        last_error_message: s.last_error_message,
        accuracy_impact: s.accuracy_impact,
        recommended_fix: s.recommended_fix,
      })),
      notifications: (notifications || []).slice(0, 10),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`[SYSTEM-HEALTH] error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
