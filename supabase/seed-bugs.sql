-- ============================================================
-- Bug Reports Seed — Auto-generated from mock trader debug session
-- 2026-04-29
-- ============================================================

insert into bugs_to_fix (source_agent, title, description, severity, status, file_path, affected_area, recommendation, metadata)
values
  (
    'signal_analyst',
    'Missing signal scan cron in vercel.json',
    'The vercel.json cron schedule only includes news ingest, news signal, and learning loop. There is no cron job to trigger /api/signals, which means the signals table never gets populated on Vercel deployments. Without signals, all downstream mock trading, execution, and Telegram alerts are dead.',
    'critical',
    'new',
    'vercel.json',
    'Signal Generation Pipeline',
    'Add a /api/signals cron entry to vercel.json with schedule "*/15 * * * *" to run every 15 minutes.',
    '{"discovered_during":"mock_trader_debug","impact":"complete_signal_pipeline_failure"}'
  ),
  (
    'signal_analyst',
    'VPS missing signal generator worker',
    'The PM2 ecosystem.config.cjs does not include a signal-generator-worker. The existing workers (execution-worker, mock-trading-worker) poll the signals table, but nothing creates signals on the VPS. The server.js only serves API routes; no background process triggers signal scans.',
    'critical',
    'new',
    'ecosystem.config.cjs',
    'Signal Generation Pipeline',
    'Add a signal-generator-worker to ecosystem.config.cjs that calls POST /api/signals every 15 minutes.',
    '{"discovered_during":"mock_trader_debug","impact":"complete_signal_pipeline_failure"}'
  ),
  (
    'signal_analyst',
    'Side case mismatch: signals.side is UPPERCASE but mock_trades expects lowercase',
    'The signals table stores side as "LONG"/"SHORT" (uppercase). The mock trading worker passes signal.side directly to openMockTrade(), which compares against "long"/"short" (lowercase). This causes stop_loss and take_profit calculations to always take the SHORT branch, even for LONG signals. The execution engine handles this correctly with toLowerCase(), but the mock trading path does not.',
    'high',
    'new',
    'workers/mock-trading-worker.js',
    'Mock Trading Engine',
    'Normalize signal.side to lowercase in the mock-trading-worker before passing to openMockTrade(). Also harden mock-account-engine.js to normalize side internally.',
    '{"discovered_during":"mock_trader_debug","impact":"incorrect_sl_tp_calculation"}'
  ),
  (
    'signal_analyst',
    'mock_trades FK pointed to signal_logs instead of signals',
    'The mock_trades.signal_id foreign key originally referenced signal_logs(id) instead of signals(id). The execution engine and mock trading workers insert signal_id from the signals table, causing every trade insert to fail silently due to FK violation.',
    'critical',
    'fixed',
    'supabase/trading_schema.sql',
    'Database Schema',
    'Already fixed: changed FK from signal_logs(id) to signals(id). Deploy the updated schema to production.',
    '{"discovered_during":"mock_trader_debug","impact":"all_trade_inserts_blocked","fix_commit":"schema_fix_2026_04_29"}'
  ),
  (
    'risk_reviewer',
    'Execution engine filters may be too strict for paper mode',
    'The execution engine v3 requires: R/R >= 1.5, ML confidence >= 0.45, RL agent approval, TV confluence alignment, and daily loss < 5%. In paper mode with no ML model loaded, most signals are likely rejected. This is a safety feature but may explain why even with signals present, no trades open.',
    'medium',
    'new',
    'lib/mock-trading/execution-engine.js',
    'Execution Engine',
    'Add a PAPER_MODE_BYPASS_EVALUATION env flag for testing, or lower MIN_RR_RATIO in paper mode. Log every rejected signal with its reason for debugging.',
    '{"discovered_during":"mock_trader_debug","impact":"low_trade_frequency_in_paper"}'
  ),
  (
    'signal_analyst',
    'No active signals in database',
    'The signals table appears empty (or has no recent active signals). Without signals being generated and saved, the entire downstream pipeline (mock trading, execution, Telegram, dashboard) has no data to display.',
    'critical',
    'new',
    'api/signals.js',
    'Signal Generation Pipeline',
    'After deploying the cron fix and worker fix, manually trigger /api/signals once to verify signal generation works. Check Supabase for data.',
    '{"discovered_during":"mock_trader_debug","impact":"no_downstream_data"}'
  );
