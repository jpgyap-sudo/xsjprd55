import { supabase } from '../lib/supabase.js';
import { getWorkerGroup } from '../lib/worker-catalog.js';

const DEFAULT_STALE_MINUTES = Number(process.env.WORKER_HEARTBEAT_STALE_MINUTES || 10);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const staleMinutes = Number(req.query?.stale_minutes || DEFAULT_STALE_MINUTES);
  const cutoff = Date.now() - staleMinutes * 60 * 1000;

  const { data, error } = await supabase
    .from('worker_heartbeats')
    .select('*')
    .order('worker_name', { ascending: true });

  if (error) {
    return res.status(200).json({
      ok: false,
      ready: false,
      staleMinutes,
      summary: { total: 0, healthy: 0, stale: 0, errors: 0 },
      workers: [],
      error: error.message,
      ts: new Date().toISOString(),
    });
  }

  const workers = (data || []).map((row) => {
    const lastCycleMs = row.last_cycle_at ? new Date(row.last_cycle_at).getTime() : 0;
    const stale = !lastCycleMs || lastCycleMs < cutoff;
    return {
      ...row,
      group: getWorkerGroup(row.worker_name),
      stale,
      ageMinutes: lastCycleMs ? Math.round((Date.now() - lastCycleMs) / 60000) : null,
    };
  });

  return res.status(200).json({
    ok: true,
    ready: true,
    staleMinutes,
    summary: {
      total: workers.length,
      healthy: workers.filter((w) => !w.stale && w.status === 'ok').length,
      stale: workers.filter((w) => w.stale).length,
      errors: workers.filter((w) => w.status === 'error').length,
    },
    workers,
    ts: new Date().toISOString(),
  });
}
