// ============================================================
// Social Sentiment API
// GET /api/social-sentiment — latest aggregated sentiment
// GET /api/social-sentiment/trends — recent market trends
// ============================================================

import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  const { pathname } = req;

  try {
    if (pathname === '/api/social-sentiment' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('social_sentiment')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return res.status(200).json({ success: true, count: data.length, data });
    }

    if (pathname === '/api/social-sentiment/trends' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('market_trends')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return res.status(200).json({ success: true, count: data.length, data });
    }

    return res.status(404).json({ success: false, error: 'Not found' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
