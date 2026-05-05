// ============================================================
// Perpetual Signal Trader — Core Engine
// Open, monitor, close perpetual paper trades.
// Uses public market APIs for prices (no API keys needed).
// ============================================================

import { supabase, isSupabaseNoOp } from '../supabase.js';
import { logger } from '../logger.js';
import { fetchPublicPriceValue } from '../market-price.js';
import {
  calculatePositionSize,
  selectLeverage,
  calculateStops,
  checkRiskGates,
  checkExit,
  calculatePerpPnl,
} from './risk.js';
import { storeSignalMemory, updateSignalOutcome } from '../signal-memory.js';
import { logTradeOpen, logTradeClose } from './trade-history.js';

// Public price fetch. Source order is configured by PRICE_SOURCE_ORDER.
const fetchMarketPrice = fetchPublicPriceValue;

// ── Get or create the perpetual account ────────────────
export async function getOrCreatePerpetualAccount() {
  if (isSupabaseNoOp()) {
    logger.error('[PerpTrader] Supabase is in NO-OP mode. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.');
    return null;
  }

  const { data: existing } = await supabase
    .from('perpetual_mock_accounts')
    .select('*')
    .eq('name', 'Perpetual Signal Trader')
    .limit(1)
    .maybeSingle();
  
  if (existing) return existing;
  
  const { data, error } = await supabase
    .from('perpetual_mock_accounts')
    .insert({
      name: 'Perpetual Signal Trader',
      starting_balance: 100000,
      current_balance: 100000,
      available_balance: 100000,
      peak_balance: 100000,
      equity: 100000,
      max_leverage: 10,
      default_leverage: 3,
      max_risk_per_trade: 0.01,
      max_exposure_pct: 0.25,
      max_open_trades: 5,
      min_confidence_threshold: 0.55,
      daily_max_loss_pct: 0.05,
      max_drawdown_stop_pct: 0.15,
      trading_enabled: true,
    })
    .select()
    .single();
  
  if (error) {
    // Duplicate — fetch again
    const { data: dup } = await supabase.from('perpetual_mock_accounts').select('*').eq('name', 'Perpetual Signal Trader').limit(1).maybeSingle();
    if (dup) return dup;
    throw error;
  }
  return data;
}

// ── Open a new perpetual trade from a signal ───────────
export async function openPerpetualTrade(signal) {
  const account = await getOrCreatePerpetualAccount();
  if (!account) {
    logger.error('[PerpTrader] Cannot open trade: no account available (Supabase NO-OP or schema missing)');
    return { ok: false, reason: 'No trading account available' };
  }
  
  // Fetch current price
  const entryPrice = await fetchMarketPrice(signal.symbol);
  if (!entryPrice) {
    await logTraderEvent(account.id, null, 'warn', 'signal_skip', `Could not fetch price for ${signal.symbol}`);
    return { ok: false, reason: 'Price unavailable' };
  }
  
  // Get open trades for risk checks
  const { data: openTrades } = await supabase
    .from('perpetual_mock_trades')
    .select('*')
    .eq('account_id', account.id)
    .eq('status', 'open');
  
  // Risk gates
  const riskCheck = await checkRiskGates(account, signal, openTrades || []);
  if (!riskCheck.ok) {
    await logTraderEvent(account.id, null, 'warn', 'signal_skip', `Risk gates blocked: ${riskCheck.issues.join('; ')}`, { signal_id: signal.id, issues: riskCheck.issues });
    return { ok: false, reason: riskCheck.issues.join('; ') };
  }
  
  // Select leverage based on confidence
  const leverage = selectLeverage({
    confidence: signal.confidence,
    maxLeverage: account.max_leverage,
    defaultLeverage: account.default_leverage,
  });
  if (leverage === 0) {
    await logTraderEvent(account.id, null, 'warn', 'signal_skip', `Confidence too low: ${Math.round((signal.confidence||0)*100)}%`, { signal_id: signal.id });
    return { ok: false, reason: 'Confidence below threshold' };
  }
  
  // Calculate stops
  const stops = calculateStops({
    entryPrice,
    side: signal.side,
    volatilityPct: 2,
    riskRewardMin: 1.5,
  });
  
  // Calculate position size
  const sizing = calculatePositionSize({
    equity: account.equity,
    entryPrice,
    stopLoss: stops.stopLoss,
    riskPct: account.max_risk_per_trade,
    leverage,
    maxPositionUsd: account.equity * account.max_exposure_pct,
  });
  
  if (!sizing.ok) {
    await logTraderEvent(account.id, null, 'warn', 'signal_skip', `Sizing failed: ${sizing.reason}`, { signal_id: signal.id });
    return { ok: false, reason: sizing.reason };
  }
  
  // Check available balance
  if (sizing.marginUsed > account.available_balance) {
    await logTraderEvent(account.id, null, 'warn', 'signal_skip', `Insufficient margin: need $${sizing.marginUsed.toFixed(2)}, have $${account.available_balance.toFixed(2)}`, { signal_id: signal.id });
    return { ok: false, reason: 'Insufficient margin' };
  }
  
  // Store signal memory
  const memResult = await storeSignalMemory(signal, signal.metadata?.market_ctx || {});
  const signalMemoryId = memResult.ok ? memResult.data?.id : null;
  
  // Build entry reason
  const entryReason = `Opened ${signal.side} ${signal.symbol} at $${entryPrice.toFixed(2)}. ` +
    `Strategy: ${signal.strategy} (${signal.timeframe}). ` +
    `Confidence: ${Math.round((signal.confidence||0)*100)}%. ` +
    `Leverage: ${leverage}x. ` +
    `Position: $${sizing.sizeUsd.toFixed(0)} (margin $${sizing.marginUsed.toFixed(2)}). ` +
    `Stop: $${stops.stopLoss.toFixed(2)}. Target: $${stops.takeProfit.toFixed(2)}. ` +
    `R:R = ${stops.riskReward}:1.`;
  
  // Insert trade
  const { data: trade, error: tradeErr } = await supabase
    .from('perpetual_mock_trades')
    .insert({
      account_id: account.id,
      signal_id: signal.id,
      signal_memory_id: signalMemoryId,
      symbol: signal.symbol,
      side: signal.side,
      entry_price: entryPrice,
      position_size_usd: sizing.sizeUsd,
      margin_used: sizing.marginUsed,
      leverage,
      stop_loss: stops.stopLoss,
      take_profit: stops.takeProfit,
      risk_reward: stops.riskReward,
      risk_pct: account.max_risk_per_trade,
      strategy: signal.strategy,
      confidence: signal.confidence,
      timeframe: signal.timeframe,
      entry_reason: entryReason,
      entry_features: signal.metadata || {},
      status: 'open',
    })
    .select()
    .single();
  
  if (tradeErr) {
    logger.error(`[PerpTrader] Trade insert failed: ${tradeErr.message}`);
    return { ok: false, reason: tradeErr.message };
  }
  
  // Update account balance
  const newAvailable = account.available_balance - sizing.marginUsed;
  const newMarginUsed = account.margin_used + sizing.marginUsed;
  await supabase.from('perpetual_mock_accounts').update({
    available_balance: newAvailable,
    margin_used: newMarginUsed,
    trades_today: account.trades_today + 1,
    updated_at: new Date().toISOString(),
  }).eq('id', account.id);
  
  await logTraderEvent(account.id, trade.id, 'info', 'entry', entryReason, { signal_id: signal.id, leverage, sizeUsd: sizing.sizeUsd });
  
  // Log to trade history
  await logTradeOpen(trade);
  
  logger.info(`[PerpTrader] Opened ${signal.side} ${signal.symbol} @ $${entryPrice.toFixed(2)} — leverage ${leverage}x, size $${sizing.sizeUsd.toFixed(0)}`);
  return { ok: true, trade, entryReason };
}

// ── Monitor open trades and close if SL/TP hit ────────
export async function monitorPerpetualTrades() {
  const account = await getOrCreatePerpetualAccount();
  if (!account) {
    logger.error('[PerpTrader] Cannot monitor trades: no account available');
    return { checked: 0, closed: 0 };
  }
  
  const { data: openTrades, error } = await supabase
    .from('perpetual_mock_trades')
    .select('*')
    .eq('account_id', account.id)
    .eq('status', 'open');

  if (error || !openTrades || openTrades.length === 0) return { checked: 0, closed: 0 };

  let closedCount = 0;
  for (const trade of openTrades) {
    const price = await fetchMarketPrice(trade.symbol);
    if (!price) {
      logger.warn(`[PerpTrader] Price unavailable for ${trade.symbol}, skipping monitor for this tick`);
      continue;
    }

    const exit = checkExit({
      side: trade.side,
      entryPrice: trade.entry_price,
      currentPrice: price,
      stopLoss: trade.stop_loss,
      takeProfit: trade.take_profit,
    });

    if (exit.shouldExit) {
      await closePerpetualTrade(trade, price, exit.reason, `Hit ${exit.reason.toUpperCase()} at $${price.toFixed(2)}`);
      closedCount++;
    }
  }

  // Re-fetch account after closes so unrealized PnL uses current balance
  const freshAccount = await getOrCreatePerpetualAccount();
  await updateUnrealizedPnl(freshAccount);
  
  return { checked: openTrades.length, closed: closedCount };
}

// ── Close a perpetual trade ────────────────────────────
export async function closePerpetualTrade(trade, exitPrice, reason, detail = '') {
  const pnl = calculatePerpPnl({
    side: trade.side,
    entryPrice: trade.entry_price,
    exitPrice,
    sizeUsd: trade.position_size_usd,
    leverage: trade.leverage,
  });
  
  const exitReasonDetail = detail || `Closed ${reason} at $${exitPrice.toFixed(2)}. PnL: $${pnl.pnlUsd.toFixed(2)} (${pnl.pnlPct.toFixed(2)}%)`;
  
  const { error } = await supabase.from('perpetual_mock_trades').update({
    status: 'closed',
    exit_price: exitPrice,
    exit_at: new Date().toISOString(),
    exit_reason: reason,
    pnl_usd: pnl.pnlUsd,
    pnl_pct: pnl.pnlPct,
    exit_reason_detail: exitReasonDetail,
    updated_at: new Date().toISOString(),
  }).eq('id', trade.id);
  
  if (error) {
    logger.error(`[PerpTrader] Close failed: ${error.message}`);
    return { ok: false, error: error.message };
  }
  
  // Update account
  const account = await getOrCreatePerpetualAccount();
  const newBalance = (account.current_balance || 0) + pnl.pnlUsd;
  const newRealized = (account.realized_pnl || 0) + pnl.pnlUsd;
  const newDailyPnl = (account.daily_pnl_today || 0) + pnl.pnlUsd;
  const newAvailable = (account.available_balance || 0) + (trade.margin_used || 0) + pnl.pnlUsd;
  const newMarginUsed = Math.max(0, (account.margin_used || 0) - (trade.margin_used || 0));
  const newPeak = Math.max(account.peak_balance || 0, newBalance);
  
  await supabase.from('perpetual_mock_accounts').update({
    current_balance: newBalance,
    available_balance: Math.max(0, newAvailable),
    margin_used: newMarginUsed,
    realized_pnl: newRealized,
    daily_pnl_today: newDailyPnl,
    peak_balance: newPeak,
    equity: newBalance,
    updated_at: new Date().toISOString(),
  }).eq('id', account.id);
  
  // Update signal memory outcome
  if (trade.signal_id) {
    await updateSignalOutcome(trade.signal_id, pnl.pnlUsd > 0 ? 'win' : 'loss', pnl.pnlUsd, exitReasonDetail);
  }
  
  // Check if daily loss limit hit
  const dailyLossLimit = account.starting_balance * account.daily_max_loss_pct;
  if (newDailyPnl <= -dailyLossLimit && account.trading_enabled) {
    await supabase.from('perpetual_mock_accounts').update({
      trading_enabled: false,
      trading_paused_reason: `Daily loss limit hit: $${Math.abs(newDailyPnl).toFixed(2)}`,
    }).eq('id', account.id);
    await logTraderEvent(account.id, trade.id, 'warn', 'risk', `Daily loss limit hit. Trading paused.`, { daily_pnl: newDailyPnl });
  }
  
  await logTraderEvent(account.id, trade.id, 'info', 'exit', exitReasonDetail, { pnl_usd: pnl.pnlUsd, pnl_pct: pnl.pnlPct });
  
  // Log to trade history with analysis
  const closedTrade = {
    ...trade,
    pnl_usd: pnl.pnlUsd,
    pnl_pct: pnl.pnlPct,
  };
  await logTradeClose(closedTrade, exitPrice, reason, exitReasonDetail);
  
  logger.info(`[PerpTrader] Closed ${trade.side} ${trade.symbol} @ $${exitPrice.toFixed(2)} — PnL $${pnl.pnlUsd.toFixed(2)} (${reason})`);
  return { ok: true, pnl };
}

// ── Update unrealized PnL ──────────────────────────────
async function updateUnrealizedPnl(account) {
  const { data: openTrades } = await supabase
    .from('perpetual_mock_trades')
    .select('*')
    .eq('account_id', account.id)
    .eq('status', 'open');
  
  if (!openTrades || openTrades.length === 0) {
    await supabase.from('perpetual_mock_accounts').update({ unrealized_pnl: 0 }).eq('id', account.id);
    return;
  }
  
  let totalUnrealized = 0;
  for (const trade of openTrades) {
    const price = await fetchMarketPrice(trade.symbol);
    if (!price) continue;
    const pnl = calculatePerpPnl({
      side: trade.side, entryPrice: trade.entry_price, exitPrice: price,
      sizeUsd: trade.position_size_usd, leverage: trade.leverage,
    });
    totalUnrealized += pnl.pnlUsd;
  }
  
  const newEquity = (account.current_balance || 0) + totalUnrealized;
  await supabase.from('perpetual_mock_accounts').update({
    unrealized_pnl: Math.round(totalUnrealized * 100) / 100,
    equity: Math.round(newEquity * 100) / 100,
    updated_at: new Date().toISOString(),
  }).eq('id', account.id);
}

// ── Reset daily stats at midnight ──────────────────────
export async function resetDailyStats() {
  const { error } = await supabase.from('perpetual_mock_accounts').update({
    daily_pnl_today: 0,
    trades_today: 0,
    trading_enabled: true,
    trading_paused_reason: null,
    updated_at: new Date().toISOString(),
  }).neq('id', '00000000-0000-0000-0000-000000000000');
  
  if (error) logger.error(`[PerpTrader] Reset daily stats failed: ${error.message}`);
}

// ── Log trader event ───────────────────────────────────
async function logTraderEvent(accountId, tradeId, level, category, message, details = {}) {
  try {
    await supabase.from('perpetual_trader_logs').insert({
      account_id: accountId,
      trade_id: tradeId,
      level,
      category,
      message,
      details,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    logger.warn(`[PerpTrader] Log event failed: ${e.message}`);
  }
}
