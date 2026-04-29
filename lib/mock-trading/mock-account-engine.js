// ============================================================
// Mock Account Engine
// Manages paper trading account balance and trade lifecycle.
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { calculatePositionSize } from './position-sizing.js';
import { recordOutcome } from '../pattern-learner.js';

const STARTING_BALANCE = Number(config.MOCK_STARTING_BALANCE || 1000);
const MAX_LEVERAGE = Number(config.MOCK_MAX_LEVERAGE || 3);
const RISK_PER_TRADE_PCT = Number(config.MOCK_RISK_PER_TRADE_PCT || 1);

export async function getOrCreateMockAccount() {
  const { data: existing } = await supabase.from('mock_accounts').select('*').limit(1).maybeSingle();
  if (existing) return existing;

  const { data, error } = await supabase.from('mock_accounts').insert({
    name: 'AI Mock Account',
    starting_balance: STARTING_BALANCE,
    current_balance: STARTING_BALANCE,
  }).select('*').single();
  if (error) throw error;
  return data;
}

export async function openMockTrade(signal, probability) {
  const account = await getOrCreateMockAccount();
  const leverage = Math.min(Number(signal.best_leverage || 2), MAX_LEVERAGE);
  const stopLossPct = Number(signal.stop_loss_pct || 1.2);
  const takeProfitPct = Number(signal.take_profit_pct || 2.5);
  const sizing = calculatePositionSize({
    balance: Number(account.current_balance),
    riskPerTradePct: RISK_PER_TRADE_PCT,
    stopLossPct,
    leverage,
  });

  const entry = Number(signal.price);
  const side = (signal.side || '').toLowerCase();
  const stopLoss = side === 'long' ? entry * (1 - stopLossPct / 100) : entry * (1 + stopLossPct / 100);
  const takeProfit = side === 'long' ? entry * (1 + takeProfitPct / 100) : entry * (1 - takeProfitPct / 100);

  const { data, error } = await supabase.from('mock_trades').insert({
    account_id: account.id,
    signal_id: signal.id,
    symbol: signal.symbol,
    side: signal.side,
    strategy_name: signal.strategy_name,
    entry_price: entry,
    leverage,
    position_size_usd: sizing.positionSizeUsd,
    margin_used: sizing.marginUsed,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    status: 'open',
    entry_reason: `Opened because probability was ${probability.finalProbability}% and passed risk checks.`,
    probability_at_entry: probability.finalProbability,
    score_breakdown: probability,
  }).select('*').single();
  if (error) throw error;
  logger.info(`[MOCK-TRADE] Opened ${signal.symbol} ${signal.side} @ $${entry} lev=${leverage}`);
  return data;
}

export async function closeMockTrade(tradeId, exitPrice, exitReason) {
  const { data: trade } = await supabase.from('mock_trades').select('*').eq('id', tradeId).single();
  if (!trade || trade.status !== 'open') return null;

  const side = trade.side;
  const entry = Number(trade.entry_price);
  const leverage = Number(trade.leverage);
  const positionSizeUsd = Number(trade.position_size_usd);

  const { calculatePnl } = await import('../backtest/pnl-calculator.js');
  const pnl = calculatePnl({ side, entryPrice: entry, exitPrice, leverage, positionSizeUsd });

  const { error } = await supabase.from('mock_trades').update({
    exit_price: exitPrice,
    pnl_pct: pnl.pnlPct,
    pnl_usd: pnl.pnlUsd,
    status: 'closed',
    exit_reason: exitReason,
    closed_at: new Date().toISOString(),
  }).eq('id', tradeId);
  if (error) throw error;

  // Update account balance
  const account = await getOrCreateMockAccount();
  const newBalance = Number(account.current_balance) + pnl.pnlUsd;
  await supabase.from('mock_accounts').update({
    current_balance: newBalance,
    realized_pnl: Number(account.realized_pnl || 0) + pnl.pnlUsd,
  }).eq('id', account.id);

  // Record outcome for pattern learning (non-blocking)
  try {
    if (trade.signal_id) {
      const duration = Math.round((Date.now() - new Date(trade.created_at).getTime()) / 60000);
      await recordOutcome(trade.signal_id, {
        pnl: pnl.pnlPct,
        reachedTp: exitReason === 'take_profit',
        reachedSl: exitReason === 'stop_loss',
        durationMinutes: duration
      });
    }
  } catch (e) {
    logger.warn('[MOCK-TRADE] recordOutcome failed:', e.message);
  }

  logger.info(`[MOCK-TRADE] Closed ${trade.symbol} ${exitReason} PnL=$${pnl.pnlUsd} Balance=$${newBalance.toFixed(2)}`);
  return { ...trade, exitPrice, pnl };
}
