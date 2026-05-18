// ============================================================
// ML Service Client — xsjprd55
// Bridge to Python ML service (FastAPI on port 8010)
// Phase 1: Random Forest + XGBoost
// Phase 3: RL decision agent
// v2: Ollama fallback when ML service is unavailable
// ============================================================

import { config } from '../config.js';
import { logger } from '../logger.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:5000';

async function callMl(path, body, method = 'POST') {
  const res = await fetch(`${ML_SERVICE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ML service error ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * Ollama fallback for ML signal prediction.
 * Uses local LLM to generate a signal estimate when the ML service is down.
 */
async function ollamaSignalFallback(features) {
  const baseUrl = config.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = config.OLLAMA_MODEL || 'phi3:mini';

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a trading signal predictor. Given market features, predict the direction. Return ONLY a JSON object:
{
  "signal": "LONG" | "SHORT" | "NEUTRAL" | "NO_MODEL",
  "confidence": <0-1>,
  "reason": "<brief explanation>"
}
Do NOT include any other text.`
          },
          {
            role: 'user',
            content: JSON.stringify(features)
          }
        ],
        options: { temperature: 0.1, max_tokens: 128 }
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = await response.json();
    const content = data.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      signal: parsed.signal || 'NO_MODEL',
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reason: parsed.reason || 'Ollama fallback prediction',
      source: 'ollama_fallback'
    };
  } catch (err) {
    logger.debug(`[ml-client] Ollama fallback failed: ${err.message}`);
    return null;
  }
}

/**
 * Ollama fallback for RL decision.
 * Uses local LLM to suggest a trading action when ML service is down.
 */
async function ollamaRlFallback(marketFeatures, portfolioState) {
  const baseUrl = config.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = config.OLLAMA_MODEL || 'phi3:mini';

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a reinforcement learning trading agent. Given market features and portfolio state, suggest an action. Return ONLY a JSON object:
{
  "action": "ENTER_LONG" | "ENTER_SHORT" | "EXIT" | "HOLD",
  "confidence": <0-1>,
  "reason": "<brief explanation>",
  "suggested_position_size": <0-1 as fraction of capital>
}
Do NOT include any other text.`
          },
          {
            role: 'user',
            content: JSON.stringify({ market_features: marketFeatures, portfolio_state: portfolioState })
          }
        ],
        options: { temperature: 0.1, max_tokens: 128 }
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = await response.json();
    const content = data.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      action: parsed.action || 'HOLD',
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reason: parsed.reason || 'Ollama fallback decision',
      suggested_position_size: Math.max(0, Math.min(1, Number(parsed.suggested_position_size) || 0)),
      source: 'ollama_fallback'
    };
  } catch (err) {
    logger.debug(`[ml-client] Ollama RL fallback failed: ${err.message}`);
    return null;
  }
}

export async function getMlHealth() {
  try {
    return await callMl('/health', null, 'GET');
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function getMlSignal(features) {
  try {
    return await callMl('/predict', { features });
  } catch (e) {
    // Try Ollama fallback before returning generic fallback
    logger.debug(`[ml-client] ML service unavailable, trying Ollama fallback: ${e.message}`);
    const ollamaResult = await ollamaSignalFallback(features);
    if (ollamaResult) {
      return ollamaResult;
    }

    // Graceful fallback when ML service has no trained model or is down
    return { signal: 'NO_MODEL', confidence: 0.5, reason: e.message, source: 'generic_fallback' };
  }
}

export async function getRlDecision(marketFeatures, portfolioState) {
  try {
    return await callMl('/rl/decide', {
      market_features: marketFeatures,
      portfolio_state: portfolioState,
    });
  } catch (e) {
    // Try Ollama fallback
    logger.debug(`[ml-client] RL service unavailable, trying Ollama fallback: ${e.message}`);
    const ollamaResult = await ollamaRlFallback(marketFeatures, portfolioState);
    if (ollamaResult) {
      return ollamaResult;
    }

    // Generic fallback
    return {
      action: 'HOLD',
      confidence: 0.5,
      reason: `ML service unavailable: ${e.message}`,
      suggested_position_size: 0,
      source: 'generic_fallback'
    };
  }
}

export async function trainMlPhase1(csvPath, target = 'target_up') {
  return callMl('/train/phase1', { csv_path: csvPath, target });
}
