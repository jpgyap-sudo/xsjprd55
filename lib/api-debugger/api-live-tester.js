// ============================================================
// API Live Tester
// Tests Kimi, Claude, and internal endpoints with safe payloads
// ============================================================

import { safeKeyStatus, classifyHttpError } from './api-error-classifier.js';
import { config } from '../config.js';

function timeoutSignal(ms = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(id) };
}

async function safeFetch(url, options = {}, timeoutMs = 20000) {
  const t = timeoutSignal(timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: t.signal });
    const text = await res.text();
    t.clear();
    return {
      ok: res.ok,
      status: res.status,
      text,
      durationMs: Date.now() - start
    };
  } catch (err) {
    t.clear();
    return {
      ok: false,
      status: 0,
      text: '',
      error: err,
      durationMs: Date.now() - start
    };
  }
}

export async function testKimiApi() {
  const apiKey = config.KIMI_API_KEY;
  const baseUrl = config.KIMI_BASE_URL || 'https://api.moonshot.cn/v1';
  const model = config.KIMI_MODEL || 'kimi-latest';
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const requestSafe = {
    endpoint,
    model,
    api_key: safeKeyStatus(apiKey),
    body_shape: {
      model,
      messages_count: 1,
      max_tokens: 10,
      stream: false
    }
  };

  if (!apiKey) {
    return {
      provider: 'kimi',
      endpoint,
      method: 'POST',
      status: 'down',
      http_code: 0,
      response_time_ms: 0,
      error_category: 'AUTH_INVALID_KEY',
      error_message: 'KIMI_API_KEY is missing in config',
      request_safe: requestSafe,
      response_safe: null,
      severity: 'critical'
    };
  }

  const body = {
    model,
    messages: [{ role: 'user', content: 'Say "pong"' }],
    max_tokens: 10,
    stream: false
  };

  const result = await safeFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  }, 20000);

  if (result.ok) {
    let parsed = null;
    try { parsed = JSON.parse(result.text); } catch { /* ignore */ }
    return {
      provider: 'kimi',
      endpoint,
      method: 'POST',
      status: 'healthy',
      http_code: result.status,
      response_time_ms: result.durationMs,
      error_category: null,
      error_message: null,
      request_safe: requestSafe,
      response_safe: {
        has_choices: !!parsed?.choices,
        first_choice_role: parsed?.choices?.[0]?.message?.role || null,
        content_preview: (parsed?.choices?.[0]?.message?.content || '').slice(0, 80)
      },
      severity: 'info'
    };
  }

  const classified = classifyHttpError({
    provider: 'kimi',
    httpCode: result.status,
    bodyText: result.text,
    error: result.error
  });

  return {
    provider: 'kimi',
    endpoint,
    method: 'POST',
    status: result.status === 0 ? 'timeout' : 'down',
    http_code: result.status || 0,
    response_time_ms: result.durationMs,
    error_category: classified.category,
    error_message: result.error?.message || result.text?.slice(0, 500) || 'Unknown error',
    request_safe: requestSafe,
    response_safe: { raw_preview: result.text?.slice(0, 200) },
    severity: classified.severity
  };
}

export async function testClaudeApi() {
  const apiKey = config.ANTHROPIC_API_KEY;
  const model = config.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
  const endpoint = 'https://api.anthropic.com/v1/messages';

  const requestSafe = {
    endpoint,
    model,
    api_key: safeKeyStatus(apiKey),
    body_shape: {
      model,
      max_tokens: 10,
      messages_count: 1
    }
  };

  if (!apiKey) {
    return {
      provider: 'claude',
      endpoint,
      method: 'POST',
      status: 'down',
      http_code: 0,
      response_time_ms: 0,
      error_category: 'AUTH_INVALID_KEY',
      error_message: 'ANTHROPIC_API_KEY is missing in config',
      request_safe: requestSafe,
      response_safe: null,
      severity: 'critical'
    };
  }

  const body = {
    model,
    max_tokens: 10,
    messages: [{ role: 'user', content: 'Say "pong"' }]
  };

  const result = await safeFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  }, 20000);

  if (result.ok) {
    let parsed = null;
    try { parsed = JSON.parse(result.text); } catch { /* ignore */ }
    return {
      provider: 'claude',
      endpoint,
      method: 'POST',
      status: 'healthy',
      http_code: result.status,
      response_time_ms: result.durationMs,
      error_category: null,
      error_message: null,
      request_safe: requestSafe,
      response_safe: {
        has_content: !!parsed?.content,
        content_type: parsed?.content?.[0]?.type || null,
        text_preview: (parsed?.content?.[0]?.text || '').slice(0, 80)
      },
      severity: 'info'
    };
  }

  const classified = classifyHttpError({
    provider: 'claude',
    httpCode: result.status,
    bodyText: result.text,
    error: result.error
  });

  return {
    provider: 'claude',
    endpoint,
    method: 'POST',
    status: result.status === 0 ? 'timeout' : 'down',
    http_code: result.status || 0,
    response_time_ms: result.durationMs,
    error_category: classified.category,
    error_message: result.error?.message || result.text?.slice(0, 500) || 'Unknown error',
    request_safe: requestSafe,
    response_safe: { raw_preview: result.text?.slice(0, 200) },
    severity: classified.severity
  };
}

export async function testInternalEndpoints() {
  const host = process.env.APP_HOST || `http://localhost:${process.env.PORT || 3000}`;
  const endpoints = [
    { path: '/api/health', method: 'GET' },
    { path: '/api/diagnostics', method: 'GET' },
    { path: '/api/ask', method: 'POST' }
  ];

  const results = [];
  for (const ep of endpoints) {
    const url = `${host}${ep.path}`;
    const opts = ep.method === 'POST'
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: 'ping', secret: process.env.CRON_SECRET || 'dev-secret' })
        }
      : { method: 'GET' };

    const result = await safeFetch(url, opts, 15000);
    const classified = result.ok
      ? null
      : classifyHttpError({ provider: 'internal', httpCode: result.status, bodyText: result.text, error: result.error });

    results.push({
      provider: 'internal',
      endpoint: url,
      method: ep.method,
      status: result.ok ? 'healthy' : result.status === 0 ? 'timeout' : 'down',
      http_code: result.status || 0,
      response_time_ms: result.durationMs,
      error_category: classified?.category || null,
      error_message: result.error?.message || (!result.ok ? result.text?.slice(0, 300) : null) || null,
      request_safe: { path: ep.path, method: ep.method },
      response_safe: result.ok ? { preview: result.text?.slice(0, 200) } : { raw_preview: result.text?.slice(0, 200) },
      severity: result.ok ? 'info' : (classified?.severity || 'medium')
    });
  }
  return results;
}

export async function runAllApiLiveTests() {
  const [kimi, claude, internal] = await Promise.allSettled([
    testKimiApi(),
    testClaudeApi(),
    testInternalEndpoints()
  ]);

  const out = [];
  if (kimi.status === 'fulfilled') out.push(kimi.value);
  else out.push({ provider: 'kimi', status: 'error', error_message: kimi.reason?.message || 'Promise rejected', severity: 'critical' });

  if (claude.status === 'fulfilled') out.push(claude.value);
  else out.push({ provider: 'claude', status: 'error', error_message: claude.reason?.message || 'Promise rejected', severity: 'critical' });

  if (internal.status === 'fulfilled') out.push(...internal.value);
  else out.push({ provider: 'internal', status: 'error', error_message: internal.reason?.message || 'Promise rejected', severity: 'high' });

  return out;
}
