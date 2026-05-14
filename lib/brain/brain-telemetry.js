// ============================================================
// Brain Telemetry — Event logging for the Trading Central Brain
// Logs events to brain_events table in Supabase.
// ============================================================

import { createClient } from '@supabase/supabase-js';

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export async function logBrainEvent(event, payload = {}) {
  const client = supabase();
  if (!client) return { ok: false, error: 'Supabase not configured' };
  const { error } = await client.from('brain_events').insert({
    event,
    payload,
    created_at: new Date().toISOString()
  });
  if (error) console.error('[brain-telemetry] log error:', error.message);
  return { ok: !error, error: error?.message };
}
