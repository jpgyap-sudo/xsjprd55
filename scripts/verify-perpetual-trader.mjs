#!/usr/bin/env node
// Read-only perpetual trader verification.
// Run on VPS/local: npm run verify:perpetual

import '../lib/env.js';
import { getPerpetualTraderDiagnostics } from '../lib/perpetual-trader/diagnostics.js';

function icon(ok) {
  return ok ? 'OK ' : 'ERR';
}

function printIssue(issue) {
  const severity = String(issue.severity || 'warning').toUpperCase();
  const category = issue.category || issue.table || 'system';
  console.log(`  [${severity}] ${category}: ${issue.message}`);
}

const diagnostics = await getPerpetualTraderDiagnostics();

console.log('PERPETUAL TRADER VERIFY');
console.log('='.repeat(60));
console.log(`Time: ${diagnostics.generatedAt}`);
console.log(`Status: ${diagnostics.status}`);
console.log(`Supabase no-op: ${diagnostics.supabaseNoOp ? 'yes' : 'no'}`);

console.log('\nTables');
if (!diagnostics.tables?.length) {
  console.log('  No table checks were run.');
} else {
  for (const table of diagnostics.tables) {
    const countText = table.count == null ? '' : ` rows=${table.count}`;
    const errorText = table.error?.message ? ` - ${table.error.message}` : '';
    console.log(`  ${icon(table.ok)} ${table.table}${countText}${errorText}`);
  }
}

console.log('\nSignals');
if (diagnostics.activeSignals?.ok) {
  console.log(`  Active unexpired signals in last 24h: ${diagnostics.activeSignals.count}`);
  for (const signal of diagnostics.activeSignals.rows.slice(0, 5)) {
    const conf = Math.round((signal.confidence || 0) * 100);
    console.log(`  - ${signal.symbol} ${signal.side} ${conf}% generated_at=${signal.generated_at}`);
  }
} else {
  console.log(`  ERR ${diagnostics.activeSignals?.error?.message || diagnostics.activeSignals?.error || 'unavailable'}`);
}

console.log('\nTrades');
if (diagnostics.trades) {
  const account = diagnostics.trades.account.row;
  if (account) {
    console.log(`  Account: ${account.name} equity=${account.equity} available=${account.available_balance} trading_enabled=${account.trading_enabled}`);
  } else {
    console.log(`  Account: ${diagnostics.trades.account.error?.message || 'not found'}`);
  }
  console.log(`  Open trades: ${diagnostics.trades.openTrades.count}`);
  console.log(`  Closed trades: ${diagnostics.trades.closedTrades.count}`);
  if (diagnostics.trades.logs.rows.length) {
    console.log('  Recent logs:');
    for (const log of diagnostics.trades.logs.rows.slice(0, 5)) {
      console.log(`  - ${log.created_at} [${log.level}/${log.category}] ${log.message}`);
    }
  }
} else {
  console.log('  Trade checks skipped.');
}

console.log('\nIssues');
if (diagnostics.issues.length) {
  diagnostics.issues.forEach(printIssue);
} else {
  console.log('  None');
}

if (diagnostics.nextActions.length) {
  console.log('\nNext actions');
  for (const action of diagnostics.nextActions) {
    console.log(`  - ${action}`);
  }
}

process.exit(diagnostics.status === 'blocked' ? 1 : 0);
