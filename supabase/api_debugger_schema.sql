-- ============================================================
-- Kimi + Claude API Debugger Schema
-- ============================================================

-- Main results table for API test outcomes
CREATE TABLE IF NOT EXISTS api_debugger_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('kimi', 'claude', 'internal')),
  endpoint TEXT NOT NULL,
  method TEXT DEFAULT 'POST',
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('healthy', 'degraded', 'down', 'timeout', 'error', 'unknown')),
  http_code INTEGER,
  response_time_ms INTEGER,
  error_category TEXT,
  error_message TEXT,
  request_safe JSONB,
  response_safe JSONB,
  neural_review JSONB,
  docs_reference JSONB,
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Docs cache for crawling official API docs
CREATE TABLE IF NOT EXISTS api_debugger_docs_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  doc_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  content_snippet TEXT,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Runs / audit trail
CREATE TABLE IF NOT EXISTS api_debugger_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  results_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'
);

-- Status history for audit
CREATE TABLE IF NOT EXISTS api_debugger_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id UUID REFERENCES api_debugger_results(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT,
  changed_by TEXT DEFAULT 'system',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_api_debug_results_provider ON api_debugger_results(provider);
CREATE INDEX IF NOT EXISTS idx_api_debug_results_status ON api_debugger_results(status);
CREATE INDEX IF NOT EXISTS idx_api_debug_results_severity ON api_debugger_results(severity);
CREATE INDEX IF NOT EXISTS idx_api_debug_results_created ON api_debugger_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_debug_docs_provider ON api_debugger_docs_cache(provider);
CREATE INDEX IF NOT EXISTS idx_api_debug_runs_status ON api_debugger_runs(status);
CREATE INDEX IF NOT EXISTS idx_api_debug_history_result ON api_debugger_status_history(result_id);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_api_debugger_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_api_debugger_updated_at ON api_debugger_results;
CREATE TRIGGER trg_api_debugger_updated_at
  BEFORE UPDATE ON api_debugger_results
  FOR EACH ROW
  EXECUTE FUNCTION update_api_debugger_updated_at();

-- Trigger to log status changes
CREATE OR REPLACE FUNCTION log_api_debugger_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO api_debugger_status_history (result_id, old_status, new_status, notes)
    VALUES (NEW.id, OLD.status, NEW.status, COALESCE(NEW.error_message, ''));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_api_debugger_status_change ON api_debugger_results;
CREATE TRIGGER trg_api_debugger_status_change
  AFTER UPDATE ON api_debugger_results
  FOR EACH ROW
  EXECUTE FUNCTION log_api_debugger_status_change();
