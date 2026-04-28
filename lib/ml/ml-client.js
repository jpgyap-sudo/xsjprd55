// ============================================================
// ML Service Client — xsjprd55
// Bridge to Python ML service (FastAPI on port 8010)
// Phase 1: Random Forest + XGBoost
// Phase 3: RL decision agent
// ============================================================

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8010';

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
    // Graceful fallback when ML service has no trained model or is down
    return { signal: 'NO_MODEL', confidence: 0.5, reason: e.message };
  }
}

export async function getRlDecision(marketFeatures, portfolioState) {
  return callMl('/rl/decide', {
    market_features: marketFeatures,
    portfolio_state: portfolioState,
  });
}

export async function trainMlPhase1(csvPath, target = 'target_up') {
  return callMl('/train/phase1', { csv_path: csvPath, target });
}
