// ============================================================
// AI Crypto Trading Advisor — /api/ask
// POST { question, chatHistory? } → Claude-powered analysis
// Delegates to lib/ai.js for shared logic with Telegram bot
// ============================================================

import { askAI } from '../lib/ai.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { question, chatHistory = [] } = req.body || {};
  const result = await askAI({ question, chatHistory });

  if (!result.ok) {
    const isConfigError = result.error?.includes('API_KEY not configured');
    return res.status(isConfigError ? 503 : 500).json(result);
  }

  return res.status(200).json(result);
}
