// ============================================================
// Supabase Client — xsjprd55 isolated project
// Graceful fallback to no-op client when env vars are missing.
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
        auth: { autoRefreshToken: false, persistSession: false }
      })
    : createNoOpClient();

export function isSupabaseNoOp() {
  return !(SUPABASE_URL && SERVICE_KEY);
}

export async function checkSupabaseHealth() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  }
  try {
    const { error } = await supabase.from('signals').select('id').limit(1);
    if (error) throw error;
    return { ok: true, latency_ms: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
