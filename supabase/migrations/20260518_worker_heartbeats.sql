CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_name TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('ok', 'warning', 'error', 'unknown')),
  last_cycle_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,
  duration_ms INTEGER,
  details JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_last_cycle
  ON worker_heartbeats(last_cycle_at DESC);
