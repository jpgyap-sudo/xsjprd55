#!/usr/bin/env node
// ============================================================
// TLL Backfill Script — Resolve pending signals + ingest mock trades
// Run once after TLL deployment to seed the learning layer.
// Usage: node scripts/tll-backfill.mjs
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ─────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MAX_RESOLVE = parseInt(process.env.TLL_MAX_RESOLVE || '500', 10);
const BATCH_SIZE = 50;

// ── Helpers ────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getCurrentPrice(symbol) {
  try {
    // Try market-price module first
    const { getPrice } = await import('../lib/market-price.js');
    const price = await getPrice(symbol);
    if (price) return price;
  } catch (_) { /* fall through */ }

  // Fallback: last known entry from brain_signal_memory
  const { data } = await supabase
    .from('brain_signal_memory')
    .select('entry_price')
    .eq('symbol', symbol)
    .not('entry_price', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(1);
  return data?.[0]?.entry_price || null;
}

// ── Step 1: Resolve pending brain signals ──────────────────
async function resolvePendingSignals() {
  console.log('\n📡 Step 1: Resolving pending brain signals...');

  const { data: signals, error } = await supabase
    .from('brain_signal_memory')
    .select('*')
    .is('resolved_at', null)
    .order('generated_at', { ascending: false })
    .limit(MAX_RESOLVE);

  if (error) {
    console.error('❌ Fetch error:', error.message);
    return 0;
  }

  if (!signals?.length) {
    console.log('   No pending signals to resolve');
    return 0;
  }

  console.log(`   Found ${signals.length} pending signals`);
  let resolved = 0;

  for (let i = 0; i < signals.length; i += BATCH_SIZE) {
    const batch = signals.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (signal) => {
      try {
        const currentPrice = await getCurrentPrice(signal.symbol);
        if (!currentPrice || !signal.entry_price) {
          await supabase
            .from('brain_signal_memory')
            .update({
              resolved_at: new Date().toISOString(),
              resolved_pnl: 0,
              metadata: {
                ...(signal.metadata || {}),
                resolution: 'backfill_unresolved_no_price',
              },
            })
            .eq('id', signal.id);
          return;
        }

        const entry = Number(signal.entry_price);
        const current = Number(currentPrice);
        let pnl = 0;

        if (signal.side === 'LONG') {
          pnl = (current - entry) / entry;
        } else if (signal.side === 'SHORT') {
          pnl = (entry - current) / entry;
        }

        pnl = Math.max(-0.5, Math.min(0.5, pnl));

        await supabase
          .from('brain_signal_memory')
          .update({
            resolved_at: new Date().toISOString(),
            resolved_pnl: pnl,
            metadata: {
              ...(signal.metadata || {}),
              resolution: 'backfill',
              current_price_at_resolution: current,
              outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
            },
          })
          .eq('id', signal.id);
      } catch (e) {
        console.error(`   ⚠ Failed signal ${signal.id}: ${e.message}`);
      }
    });

    await Promise.all(promises);
    resolved += batch.length;
    console.log(`   Progress: ${resolved}/${signals.length}`);
    await sleep(500); // Rate limit
  }

  console.log(`   ✅ Resolved ${resolved} signals`);
  return resolved;
}

// ── Step 2: Ingest closed mock trades into brain_signal_memory ──
async function ingestMockTrades() {
  console.log('\n📊 Step 2: Ingesting closed mock trades into TLL...');

  // Get closed mock trades that haven't been ingested yet
  const { data: trades, error } = await supabase
    .from('mock_trades')
    .select('*')
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(MAX_RESOLVE);

  if (error) {
    console.error('❌ Fetch mock trades error:', error.message);
    return 0;
  }

  if (!trades?.length) {
    console.log('   No closed mock trades found');
    return 0;
  }

  console.log(`   Found ${trades.length} closed mock trades`);

  // Check which ones are already in brain_signal_memory
  const tradeIds = trades.map(t => t.id);
  const { data: existing } = await supabase
    .from('brain_signal_memory')
    .select('metadata->>mock_trade_id')
    .in('metadata->>mock_trade_id', tradeIds.map(String));

  const existingIds = new Set((existing || []).map(r => r.mock_trade_id));
  const newTrades = trades.filter(t => !existingIds.has(String(t.id)));

  if (!newTrades.length) {
    console.log('   All mock trades already ingested');
    return 0;
  }

  console.log(`   ${newTrades.length} new trades to ingest`);

  let ingested = 0;
  for (let i = 0; i < newTrades.length; i += BATCH_SIZE) {
    const batch = newTrades.slice(i, i + BATCH_SIZE);
    const records = batch.map(trade => ({
      symbol: trade.symbol,
      side: trade.side || 'LONG',
      entry_price: trade.entry_price,
      resolved_at: trade.closed_at || new Date().toISOString(),
      resolved_pnl: trade.pnl_pct || 0,
      generated_at: trade.created_at || trade.opened_at || new Date().toISOString(),
      source: 'mock_trade_backfill',
      strategy: trade.strategy || 'unknown',
      timeframe: trade.timeframe || '15m',
      confidence: trade.confidence || 0.5,
      mode: 'paper',
      metadata: {
        mock_trade_id: trade.id,
        pnl_usd: trade.pnl_usd || 0,
        exit_price: trade.exit_price,
        exit_reason: trade.exit_reason,
        outcome: (trade.pnl_pct || 0) > 0 ? 'win' : (trade.pnl_pct || 0) < 0 ? 'loss' : 'breakeven',
        account_id: trade.account_id,
        resolution: 'backfill_mock_trade',
      },
    }));

    const { error: insertErr } = await supabase
      .from('brain_signal_memory')
      .insert(records);

    if (insertErr) {
      console.error(`   ⚠ Batch insert error: ${insertErr.message}`);
    } else {
      ingested += batch.length;
    }

    console.log(`   Progress: ${ingested}/${newTrades.length}`);
    await sleep(500);
  }

  console.log(`   ✅ Ingested ${ingested} mock trades`);
  return ingested;
}

// ── Step 3: Trigger TLL cycle ──────────────────────────────
async function triggerTLLCycle() {
  console.log('\n🧠 Step 3: Triggering TLL learning cycle...');

  try {
    const { runLearningLayer } = await import('../lib/learning-layer/index.js');
    const result = await runLearningLayer({ source: 'backfill_script' });
    console.log('   ✅ TLL cycle complete');
    console.log(`      Patterns: ${result.patterns || 0}`);
    console.log(`      Skills: ${result.skills || 0}`);
    console.log(`      Healing: ${result.healing || 0}`);
    console.log(`      Regime: ${result.regime || 'unknown'}`);
    return result;
  } catch (e) {
    console.error(`   ⚠ TLL cycle error: ${e.message}`);
    console.log('   (This is non-critical — TLL worker will run on schedule)');
    return null;
  }
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  console.log('============================================');
  console.log('🧠 TLL Backfill Script');
  console.log('============================================');
  console.log(`Max resolve: ${MAX_RESOLVE}`);
  console.log(`Supabase: ${SUPABASE_URL}`);

  const startTime = Date.now();

  const resolved = await resolvePendingSignals();
  const ingested = await ingestMockTrades();
  const tllResult = await triggerTLLCycle();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n============================================');
  console.log('✅ Backfill Complete');
  console.log(`   Signals resolved: ${resolved}`);
  console.log(`   Mock trades ingested: ${ingested}`);
  console.log(`   TLL cycle: ${tllResult ? 'completed' : 'skipped'}`);
  console.log(`   Duration: ${elapsed}s`);
  console.log('============================================');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
