// ============================================================
// Supabase Client — xsjprd55 isolated project
// Graceful fallback to no-op client when env vars are missing.
// Includes connection pooling via fetch override with timeout,
// retry logic, and health checks.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import './env.js';

const RAW_URL = process.env.SUPABASE_URL;
const RAW_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY;

const IS_PLACEHOLDER = (v) =>
  !v || v.startsWith('your-') || v.includes('your-project') || v.includes('localhost');

const SUPABASE_URL = IS_PLACEHOLDER(RAW_URL) ? '' : RAW_URL;
const SERVICE_KEY = IS_PLACEHOLDER(RAW_KEY) ? '' : RAW_KEY;

// ── Connection Pool Configuration ───────────────────────────
const SUPABASE_TIMEOUT_MS = parseInt(process.env.SUPABASE_TIMEOUT_MS || '15000', 10);
const SUPABASE_MAX_RETRIES = parseInt(process.env.SUPABASE_MAX_RETRIES || '3', 10);

/**
 * Fetch wrapper with timeout and retry for Supabase requests.
 * Prevents hanging connections when Supabase is slow or unreachable.
 */
async function fetchWithPool(url, opts = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);

  let lastError;
  for (let attempt = 1; attempt <= SUPABASE_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...opts,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      lastError = err;
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Supabase request timed out after ${SUPABASE_TIMEOUT_MS}ms`);
      }
      // Don't retry on 4xx errors
      if (err.status && err.status >= 400 && err.status < 500) {
        throw err;
      }
      if (attempt < SUPABASE_MAX_RETRIES) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

function createNoOpClient() {
  const noopQuery = {
    eq: () => noopQuery,
    neq: () => noopQuery,
    gt: () => noopQuery,
    gte: () => noopQuery,
    lt: () => noopQuery,
    lte: () => noopQuery,
    like: () => noopQuery,
    ilike: () => noopQuery,
    is: () => noopQuery,
    in: () => noopQuery,
    contains: () => noopQuery,
    containedBy: () => noopQuery,
    overlaps: () => noopQuery,
    textSearch: () => noopQuery,
    match: () => noopQuery,
    not: () => noopQuery,
    or: () => noopQuery,
    filter: () => noopQuery,
    order: () => noopQuery,
    limit: () => noopQuery,
    range: () => noopQuery,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };

  const noopSelect = {
    ...noopQuery,
    select: (..._cols) => noopQuery,
    insert: () => noopSelect,
    upsert: () => noopSelect,
    update: () => noopQuery,
    delete: () => noopQuery,
  };

  return {
    from: () => noopSelect,
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
  };
}

export const supabase =
  SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          fetch: fetchWithPool,
        },
      })
    : createNoOpClient();

export function isSupabaseNoOp() {
  return !(SUPABASE_URL && SERVICE_KEY);
}

export async function checkSupabaseHealth() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  }
  const start = Date.now();
  try {
    const { error } = await supabase.from('signals').select('id').limit(1);
    const latencyMs = Date.now() - start;
    if (error) throw error;
    return { ok: true, latency_ms: latencyMs };
  } catch (err) {
    return { ok: false, error: err.message, latency_ms: Date.now() - start };
  }
}
