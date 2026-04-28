// ============================================================
// Event Impact Scorer — Quantify news impact for signal engine
// Produces a 0-1 event score from sentiment, confidence, source
// quality, impact level, and urgency.
// ============================================================

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

const IMPACT_WEIGHT = {
  low: 0.25,
  medium: 0.50,
  high: 0.78,
  critical: 0.95
};

const URGENCY_WEIGHT = {
  normal: 0.35,
  fast: 0.70,
  breaking: 0.95
};

export function scoreEventImpact(event) {
  const sentimentStrength = Math.abs(Number(event.sentiment_score || 0));
  const confidence = Number(event.confidence || 0.5);
  const sourceQuality = Number(event.source_quality || 0.5);
  const impact = IMPACT_WEIGHT[event.impact_level] ?? 0.5;
  const urgency = URGENCY_WEIGHT[event.urgency] ?? 0.35;

  const score =
    sentimentStrength * 0.30 +
    confidence * 0.25 +
    sourceQuality * 0.20 +
    impact * 0.15 +
    urgency * 0.10;

  return Number(clamp(score, 0, 1).toFixed(3));
}

export function buildAgentPayload(event, post) {
  const eventScore = scoreEventImpact(event);
  return {
    symbol: event.symbol,
    symbols: event.symbols || [],
    event_type: event.event_type,
    sentiment_score: event.sentiment_score,
    confidence: event.confidence,
    impact_level: event.impact_level,
    urgency: event.urgency,
    suggested_bias: event.suggested_bias,
    event_score: eventScore,
    source_quality: event.source_quality,
    time_decay_minutes: event.time_decay_minutes,
    summary: event.summary,
    source: post?.source,
    source_account: post?.source_account,
    url: post?.url,
    post_id: post?.id,
    created_at: new Date().toISOString()
  };
}
