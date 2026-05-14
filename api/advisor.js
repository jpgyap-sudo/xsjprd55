import { runAdvisor } from '../lib/advisor/runAdvisor.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const { symbol, timeframe, horizon, intent, user_id, raw_prompt } = req.body || {};
    const result = await runAdvisor({
      symbol,
      timeframe,
      horizon,
      intent,
      user_id,
      raw_prompt,
      source: 'api'
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
}
