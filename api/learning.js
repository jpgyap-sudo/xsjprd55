// ============================================================
// Learning Loop API — Admin trigger and status endpoint
// ============================================================

import { runLearningLoop } from '../lib/learning-loop.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

/**
 * POST /api/learning/run — Trigger learning loop manually
 * GET  /api/learning/status — Get pending suggestions and last loop results
 */
export default async function handler(req, res) {
  const { method, query } = req;

  if (method === 'POST' && query.action === 'run') {
    try {
      const results = await runLearningLoop();
      return res.status(200).json({ ok: true, results });
    } catch (e) {
      logger.error('[API_LEARNING] POST /run failed:', e.message);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (method === 'GET') {
    try {
      const { data: pendingSuggestions } = await supabase
        .from('app_suggestions')
        .select('*')
        .eq('status', 'pending')
        .order('generated_at', { ascending: false })
        .limit(20);

      const { data: lastLoop } = await supabase
        .from('learning_feedback_log')
        .select('*')
        .eq('event_type', 'model_retrained')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      return res.status(200).json({
        ok: true,
        pending_suggestions_count: pendingSuggestions?.length || 0,
        pending_suggestions: pendingSuggestions || [],
        last_loop: lastLoop || null
      });
    } catch (e) {
      logger.error('[API_LEARNING] GET /status failed:', e.message);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
