import { supabase, isSupabaseNoOp } from '../supabase.js';

export const PERPETUAL_REQUIRED_TABLES = [
  {
    name: 'signals',
    columns: 'id,symbol,side,confidence,generated_at,valid_until,status,mode,metadata',
    critical: true,
  },
  {
    name: 'signal_memory',
    columns: 'id,signal_id,symbol,side,strategy,timeframe,outcome,generated_at',
    critical: true,
  },
  {
    name: 'perpetual_mock_accounts',
    columns: 'id,name,current_balance,available_balance,equity,margin_used,trading_enabled,trading_paused_reason',
    critical: true,
  },
  {
    name: 'perpetual_mock_trades',
    columns: 'id,account_id,signal_id,symbol,side,status,entry_price,position_size_usd,margin_used,leverage,created_at',
    critical: true,
  },
  {
    name: 'perpetual_trader_logs',
    columns: 'id,account_id,trade_id,level,category,message,created_at',
    critical: true,
  },
];

function normalizeError(error) {
  if (!error) return null;
  return {
    code: error.code || null,
    message: error.message || String(error),
    details: error.details || null,
    hint: error.hint || null,
  };
}

function classifyTableError(error) {
  const msg = String(error?.message || '').toLowerCase();
  if (error?.code === '42P01' || msg.includes('does not exist')) return 'missing_schema';
  if (error?.code === '42703' || msg.includes('column')) return 'missing_column';
  if (error?.code === '42501' || msg.includes('permission')) return 'permission';
  return 'query_error';
}

async function probeTable(table) {
  const { count, error } = await supabase
    .from(table.name)
    .select(table.columns, { count: 'exact', head: true });

  if (error) {
    return {
      table: table.name,
      ok: false,
      critical: table.critical,
      category: classifyTableError(error),
      error: normalizeError(error),
      count: null,
    };
  }

  return {
    table: table.name,
    ok: true,
    critical: table.critical,
    category: null,
    error: null,
    count: count || 0,
  };
}

async function getActiveSignalSnapshot() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const { data, error, count } = await supabase
    .from('signals')
    .select('id,symbol,side,confidence,generated_at,valid_until,status,mode', { count: 'exact' })
    .eq('status', 'active')
    .gte('generated_at', since)
    .or(`valid_until.is.null,valid_until.gte.${now}`)
    .order('generated_at', { ascending: false })
    .limit(10);

  if (error) {
    return { ok: false, count: 0, rows: [], error: normalizeError(error) };
  }

  return { ok: true, count: count || 0, rows: data || [], error: null };
}

async function getTradeSnapshot() {
  const [open, closed, account, logs] = await Promise.all([
    supabase
      .from('perpetual_mock_trades')
      .select('id,symbol,side,status,created_at,signal_id', { count: 'exact' })
      .eq('status', 'open')
      .limit(10),
    supabase
      .from('perpetual_mock_trades')
      .select('id,symbol,side,status,exit_at,pnl_usd', { count: 'exact' })
      .eq('status', 'closed')
      .order('exit_at', { ascending: false })
      .limit(5),
    supabase
      .from('perpetual_mock_accounts')
      .select('id,name,current_balance,available_balance,equity,margin_used,trading_enabled,trading_paused_reason,trades_today,daily_pnl_today')
      .limit(1)
      .maybeSingle(),
    supabase
      .from('perpetual_trader_logs')
      .select('level,category,message,created_at')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return {
    account: {
      ok: !account.error,
      row: account.data || null,
      error: normalizeError(account.error),
    },
    openTrades: {
      ok: !open.error,
      count: open.count || 0,
      rows: open.data || [],
      error: normalizeError(open.error),
    },
    closedTrades: {
      ok: !closed.error,
      count: closed.count || 0,
      rows: closed.data || [],
      error: normalizeError(closed.error),
    },
    logs: {
      ok: !logs.error,
      rows: logs.data || [],
      error: normalizeError(logs.error),
    },
  };
}

export async function getPerpetualTraderDiagnostics() {
  const generatedAt = new Date().toISOString();

  if (isSupabaseNoOp()) {
    return {
      ok: false,
      generatedAt,
      supabaseNoOp: true,
      status: 'blocked',
      issues: [
        {
          severity: 'critical',
          category: 'env',
          message: 'Supabase is in no-op mode. Set real SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY values.',
        },
      ],
      tables: [],
      activeSignals: { ok: false, count: 0, rows: [], error: 'supabase_noop' },
      trades: null,
      nextActions: [
        'Set real Supabase credentials in .env or VPS PM2 environment.',
        'Run supabase/perpetual-trader-schema.sql on the target Supabase project.',
        'Restart the API and perpetual-trader-worker.',
      ],
    };
  }

  const tables = [];
  for (const table of PERPETUAL_REQUIRED_TABLES) {
    tables.push(await probeTable(table));
  }

  const issues = tables
    .filter((table) => !table.ok)
    .map((table) => ({
      severity: table.critical ? 'critical' : 'warning',
      category: table.category,
      table: table.table,
      message: table.error?.message || `${table.table} check failed`,
    }));

  let activeSignals = { ok: false, count: 0, rows: [], error: 'schema_unavailable' };
  let trades = null;
  if (!issues.some((issue) => issue.severity === 'critical')) {
    activeSignals = await getActiveSignalSnapshot();
    trades = await getTradeSnapshot();

    if (activeSignals.ok && activeSignals.count === 0) {
      issues.push({
        severity: 'warning',
        category: 'signals',
        message: 'No active unexpired signals were found in the last 24 hours.',
      });
    }

    if (trades?.account?.ok && !trades.account.row) {
      issues.push({
        severity: 'critical',
        category: 'account',
        message: 'No perpetual mock account exists. Run the perpetual trader schema seed.',
      });
    } else if (trades?.account?.row && !trades.account.row.trading_enabled) {
      issues.push({
        severity: 'warning',
        category: 'risk',
        message: `Trading is paused: ${trades.account.row.trading_paused_reason || 'unknown reason'}`,
      });
    }
  }

  const status = issues.some((issue) => issue.severity === 'critical')
    ? 'blocked'
    : issues.length
      ? 'degraded'
      : 'healthy';

  return {
    ok: status !== 'blocked',
    generatedAt,
    supabaseNoOp: false,
    status,
    issues,
    tables,
    activeSignals,
    trades,
    nextActions: status === 'healthy'
      ? []
      : [
          'Run npm run verify:perpetual on the VPS.',
          'Check PM2 logs for perpetual-trader-worker.',
          'Run supabase/perpetual-trader-schema.sql if any perpetual tables are missing.',
        ],
  };
}
