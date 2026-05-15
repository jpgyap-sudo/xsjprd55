import { readFileSync } from 'fs';

const MANAGEMENT_TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN || 'sbp_placeholder_replace_me';
const PROJECT_REF = 'nqcgnwpfxnbtdrvtkwej';
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function runQuery(sql, label) {
  console.log(`\n--- ${label} ---`);
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MANAGEMENT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });

  const text = await response.text();
  
  if (response.ok) {
    console.log('OK:', text.substring(0, 200));
    return JSON.parse(text);
  } else {
    console.error('FAIL:', text.substring(0, 300));
    return null;
  }
}

async function main() {
  // Step 1: Create tables
  const tablesSQL = `
CREATE TABLE IF NOT EXISTS brain_signal_memory (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT DEFAULT '15m',
  side TEXT,
  entry_price NUMERIC,
  confidence NUMERIC DEFAULT 0,
  strategy TEXT DEFAULT 'brain_central',
  score JSONB,
  risk_verdict TEXT DEFAULT 'PENDING',
  explanation TEXT,
  mode TEXT DEFAULT 'paper',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_pnl NUMERIC,
  metadata JSONB
);
CREATE TABLE IF NOT EXISTS brain_events (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS brain_learning_reports (
  id BIGSERIAL PRIMARY KEY,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  total_signals_analyzed INTEGER DEFAULT 0,
  suggestions JSONB DEFAULT '[]',
  summary JSONB DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS brain_strategy_weights (
  id BIGSERIAL PRIMARY KEY,
  strategy TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT DEFAULT '15m',
  weight NUMERIC DEFAULT 0.5,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (strategy, symbol, timeframe)
);`;
  await runQuery(tablesSQL, 'Creating tables');

  // Step 2: Create indexes
  const indexesSQL = `
CREATE INDEX IF NOT EXISTS idx_brain_signal_memory_symbol ON brain_signal_memory (symbol);
CREATE INDEX IF NOT EXISTS idx_brain_signal_memory_generated_at ON brain_signal_memory (generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_signal_memory_side ON brain_signal_memory (side);
CREATE INDEX IF NOT EXISTS idx_brain_signal_memory_verdict ON brain_signal_memory (risk_verdict);
CREATE INDEX IF NOT EXISTS idx_brain_events_event ON brain_events (event);
CREATE INDEX IF NOT EXISTS idx_brain_events_created_at ON brain_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_learning_reports_generated_at ON brain_learning_reports (generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_strategy_weights_lookup ON brain_strategy_weights (strategy, symbol, timeframe);`;
  await runQuery(indexesSQL, 'Creating indexes');

  // Step 3: Enable RLS
  const rlsSQL = `
ALTER TABLE brain_signal_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_learning_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_strategy_weights ENABLE ROW LEVEL SECURITY;`;
  await runQuery(rlsSQL, 'Enabling RLS');

  // Step 4: Create policies (without IF NOT EXISTS - Management API doesn't support it)
  const policiesSQL = `
CREATE POLICY "service_role_all_brain_signal_memory"
  ON brain_signal_memory FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_brain_events"
  ON brain_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_brain_learning_reports"
  ON brain_learning_reports FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_brain_strategy_weights"
  ON brain_strategy_weights FOR ALL TO service_role USING (true) WITH CHECK (true);`;
  await runQuery(policiesSQL, 'Creating policies');

  // Verify
  console.log('\n--- Verification ---');
  const verify = await runQuery(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('brain_signal_memory', 'brain_events', 'brain_learning_reports', 'brain_strategy_weights')`,
    'Verifying tables'
  );
  
  if (Array.isArray(verify)) {
    for (const row of verify) {
      console.log(`  ✓ ${row.table_name}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
