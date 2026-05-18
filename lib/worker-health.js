import { supabase } from './supabase.js';
import { logger } from './logger.js';

export async function recordWorkerHeartbeat(workerName, {
  status = 'ok',
  durationMs = null,
  details = {},
  error = null,
} = {}) {
  try {
    const now = new Date().toISOString();
    const payload = {
      worker_name: workerName,
      status,
      last_cycle_at: now,
      last_success_at: status === 'ok' ? now : null,
      last_error_at: status === 'error' ? now : null,
      last_error_message: error ? String(error) : null,
      duration_ms: durationMs,
      details,
      updated_at: now,
    };

    const { error: upsertError } = await supabase
      .from('worker_heartbeats')
      .upsert(payload, { onConflict: 'worker_name' });

    if (upsertError) throw upsertError;
    return { ok: true };
  } catch (err) {
    logger.debug?.(`[worker-health] heartbeat skipped for ${workerName}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
