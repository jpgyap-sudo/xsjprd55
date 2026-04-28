// ============================================================
// ML Service Health & Model Status
// GET /api/ml-health
// ============================================================

import { getMlHealth } from '../lib/ml/ml-client.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const health = await getMlHealth();
    return res.status(200).json(health);
  } catch (err) {
    return res.status(503).json({
      ok: false,
      service: 'xsjprd55-ml-service',
      connected: false,
      error: err.message,
    });
  }
}
