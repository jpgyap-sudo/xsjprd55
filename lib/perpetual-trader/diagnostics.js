import { supabase, isSupabaseNoOp } from '../supabase.js';
import { fetchPublicPrice } from '../market-price.js';
import { checkExit } from './risk.js';

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
  {
    name: 'perp_trade_history',
    columns: 'id,trade_id,symbol,side,entry_price,exit_price,exit_at,pnl_usd',
    critical: false,
  },
  {
    name: 'perp_daily_summary',
    columns: 'id,account_id,date,trades,wins,losses,pnl_usd',
    critical: false,
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
      .select('id,symbol,side,status,created_at,signal_id,entry_price,stop_loss,take_profit', { count: 'exact' })
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

async function getWorkerSnapshot(openTrades = []) {
  const maxAgeHours = Number(process.env.PERPETUAL_MAX_TRADE_AGE_HOURS || 72);
  const nowMs = Date.now();
  const { data: systemLogs, error } = await supabase
    .from('perpetual_trader_logs')
    .select('message, details, created_at')
    .eq('category', 'system')
    .order('created_at', { ascending: false })
    .limit(100);

  const latestCycle = (systemLogs || []).find((log) => log.details?.kind === 'cycle' || log.message === 'worker_cycle') || null;
  const lastCycleAt = latestCycle?.created_at || null;
  const lastCycleAgeMinutes = lastCycleAt ? Math.round((nowMs - new Date(lastCycleAt).getTime()) / 60000) : null;
  const staleTrades = openTrades.filter((trade) => {
    const ageHours = (nowMs - new Date(trade.created_at).getTime()) / 3600000;
    return ageHours > maxAgeHours;
  });

  const breachedTrades = [];
  for (const trade of openTrades.slice(0, 10)) {
    try {
      const { price, source } = await fetchPublicPrice(trade.symbol);
      const exit = checkExit({
        side: trade.side,
        entryPrice: trade.entry_price,
        currentPrice: price,
        stopLoss: trade.stop_loss,
        takeProfit: trade.take_profit,
      });
      if (exit.shouldExit) {
        breachedTrades.push({
          id: trade.id,
          symbol: trade.symbol,
          side: trade.side,
          currentPrice: price,
          source,
          reason: exit.reason,
        });
      }
    } catch {
      // Price fetch degradation is surfaced in the API layer.
    }
  }

  return {
    ok: !error,
    error: normalizeError(error),
    lastCycleAt,
    lastCycleAgeMinutes,
    latestCycleDetails: latestCycle?.details || null,
    maxAgeHours,
    staleTradeCount: staleTrades.length,
    staleTrades,
    breachedTradeCount: breachedTrades.length,
    breachedTrades,
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
    const worker = await getWorkerSnapshot(trades.openTrades.rows);
    trades.worker = worker;

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

    if (!worker.lastCycleAt) {
      issues.push({
        severity: 'warning',
        category: 'worker',
        message: 'No perpetual trader worker heartbeat was found.',
      });
    } else if (worker.lastCycleAgeMinutes > 5) {
      issues.push({
        severity: 'warning',
        category: 'worker',
        message: `Perpetual trader worker heartbeat is stale (${worker.lastCycleAgeMinutes} minutes old).`,
      });
    }

    if (worker.staleTradeCount > 0) {
      issues.push({
        severity: 'critical',
        category: 'stale_trades',
        message: `${worker.staleTradeCount} open perpetual trade(s) exceed the ${worker.maxAgeHours}h maximum age.`,
      });
    }

    if (worker.breachedTradeCount > 0) {
      issues.push({
        severity: 'critical',
        category: 'breached_trades',
        message: `${worker.breachedTradeCount} open perpetual trade(s) already crossed stop-loss or take-profit levels.`,
      });
    }
  }

  const blockingCategories = new Set(['env', 'missing_schema', 'missing_column', 'permission', 'account']);
  const hasBlockingIssue = issues.some((issue) => issue.severity === 'critical' && blockingCategories.has(issue.category));
  const status = hasBlockingIssue
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
