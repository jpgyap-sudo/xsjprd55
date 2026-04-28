// ============================================================
// ML Prediction Endpoint
// POST /api/ml-predict
// Body: { features: { close, volume, rsi, ... } }
// ============================================================

import { getMlSignal } from '../lib/ml/ml-client.js';
import { mapSignalContextToMlFeatures, mapOhlcvToMlFeatures } from '../lib/ml/feature-mapper.js';

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let features;

    if (req.method === 'POST' && req.body?.features) {
      features = mapSignalContextToMlFeatures(req.body.features);
    } else if (req.method === 'POST' && req.body?.ohlcv) {
      features = mapOhlcvToMlFeatures(req.body.ohlcv);
    } else if (req.query?.symbol) {
      // Default dummy features for quick test
      features = mapSignalContextToMlFeatures({ close: 65000, volume: 1000, rsi: 55 });
    } else {
      return res.status(400).json({ error: 'Provide features or ohlcv in body' });
    }

    const result = await getMlSignal(features);
    return res.status(200).json({ ok: true, features, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
