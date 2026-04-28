// ============================================================
// API Error Classifier
// Categorizes HTTP errors for Kimi, Claude, and internal APIs
// ============================================================

export function safeKeyStatus(value) {
  if (!value || typeof value !== 'string') return { safe: '***REDACTED***', length: 0 };
  return {
    safe: value.slice(0, 4) + '...' + value.slice(-4),
    length: value.length
  };
}

export function classifyHttpError({ provider, httpCode, bodyText = '', error }) {
  const text = (bodyText || '').toLowerCase();

  // Network-level failures
  if (!httpCode && error) {
    if (/etimedout|timeout|socket hang up/i.test(error.message)) {
      return { category: 'TIMEOUT', severity: 'high', fixHint: 'Increase timeout or check network connectivity' };
    }
    if (/enotfound|econnrefused|dns/i.test(error.message)) {
      return { category: 'NETWORK', severity: 'critical', fixHint: 'Verify DNS resolution and endpoint URL' };
    }
    if (/cert|ssl|tls/i.test(error.message)) {
      return { category: 'TLS', severity: 'critical', fixHint: 'Check system certificates and TLS version' };
    }
    return { category: 'NETWORK_UNKNOWN', severity: 'high', fixHint: 'Check network and retry' };
  }

  // HTTP status-based classification
  if (httpCode === 401) {
    return { category: 'AUTH_INVALID_KEY', severity: 'critical', fixHint: 'Verify API key is correct and not expired' };
  }
  if (httpCode === 403) {
    return { category: 'AUTH_FORBIDDEN', severity: 'critical', fixHint: 'Check API key permissions and rate limit status' };
  }
  if (httpCode === 429) {
    return { category: 'RATE_LIMIT', severity: 'high', fixHint: 'Implement exponential backoff; reduce request frequency' };
  }
  if (httpCode === 500) {
    return { category: 'SERVER_ERROR', severity: 'high', fixHint: 'Provider-side issue; retry with backoff' };
  }
  if (httpCode === 502) {
    return { category: 'BAD_GATEWAY', severity: 'high', fixHint: 'Provider gateway issue; retry shortly' };
  }
  if (httpCode === 503) {
    return { category: 'SERVICE_UNAVAILABLE', severity: 'high', fixHint: 'Provider service down; retry with longer backoff' };
  }
  if (httpCode >= 400 && httpCode < 500) {
    if (text.includes('context length') || text.includes('too long')) {
      return { category: 'CONTEXT_LENGTH', severity: 'medium', fixHint: 'Truncate messages or use a model with larger context window' };
    }
    if (text.includes('invalid model') || text.includes('model')) {
      return { category: 'INVALID_MODEL', severity: 'medium', fixHint: 'Verify model name is valid for this provider' };
    }
    if (text.includes('content_policy') || text.includes('moderation')) {
      return { category: 'CONTENT_POLICY', severity: 'medium', fixHint: 'Review input for policy violations' };
    }
    return { category: 'CLIENT_ERROR', severity: 'medium', fixHint: `Check request format. HTTP ${httpCode}` };
  }

  if (httpCode >= 500) {
    return { category: 'SERVER_ERROR', severity: 'high', fixHint: 'Provider-side error; retry with exponential backoff' };
  }

  return { category: 'UNKNOWN', severity: 'medium', fixHint: 'Review logs and provider status page' };
}
