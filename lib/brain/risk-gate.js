// ============================================================
// Risk Gate — Blocks signals that fail safety checks.
// Enforces stale data, confidence, health, news conflict,
// and live mode authorization gates.
// ============================================================

export async function runRiskGate({ context, strategy, mode }) {
  const gates = [];

  // Gate 1: Stale data check
  const freshness = context?.freshness || {};
  if (freshness.market_age_seconds > 300) {
    gates.push({ gate: 'stale_data', passed: false, reason: `Market data ${freshness.market_age_seconds}s old (>300s)` });
  } else {
    gates.push({ gate: 'stale_data', passed: true });
  }

  // Gate 2: Confidence threshold
  const confidence = strategy?.composite ?? 0;
  if (confidence < 0.4) {
    gates.push({ gate: 'low_confidence', passed: false, reason: `Confidence ${confidence} < 0.4` });
  } else {
    gates.push({ gate: 'low_confidence', passed: true });
  }

  // Gate 3: Health check
  const marketOk = context?.market?.ok !== false;
  gates.push({ gate: 'market_health', passed: marketOk, reason: marketOk ? undefined : 'Market data fetch failed' });

  // Gate 4: News conflict
  const newsSentiment = context?.news?.sentiment ?? 0;
  const strategySide = strategy?.side;
  if (strategySide === 'LONG' && newsSentiment < -0.5) {
    gates.push({ gate: 'news_conflict', passed: false, reason: `News sentiment ${newsSentiment} conflicts with LONG` });
  } else if (strategySide === 'SHORT' && newsSentiment > 0.5) {
    gates.push({ gate: 'news_conflict', passed: false, reason: `News sentiment ${newsSentiment} conflicts with SHORT` });
  } else {
    gates.push({ gate: 'news_conflict', passed: true });
  }

  // Gate 5: Live mode authorization
  if (mode === 'live' && process.env.BRAIN_LIVE_MODE !== 'true') {
    gates.push({ gate: 'live_mode', passed: false, reason: 'Live mode not authorized (set BRAIN_LIVE_MODE=true)' });
  } else {
    gates.push({ gate: 'live_mode', passed: true });
  }

  const allPassed = gates.every(g => g.passed);
  return {
    passed: allPassed,
    gates,
    verdict: allPassed ? 'APPROVED' : 'BLOCKED'
  };
}
