// ============================================================
// Execution Engine v3 — Signal Optimizer, Not Signal Prover
// Goal: Take incoming signals and execute them with optimal
// risk/reward, adaptive leverage, and tight cutloss discipline.
// Learns per-symbol which execution configs maximize R/R.
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { calculatePnl } from '../backtest/pnl-calculator.js';
import { fetchTvAnalysis } from '../tradingview-ta.js';
import { getMlSignal } from '../ml/ml-client.js';
import { getRlDecision } from '../ml/ml-client.js';
import { buildFeatures, vectorize } from '../ml/features.js';
import { fetchPublicPrice } from '../market-price.js';

const STARTING_BALANCE = Number(config.MOCK_STARTING_BALANCE || 1_000_000);
const ABSOLUTE_MAX_LEVERAGE = 20;
const ABSOLUTE_MIN_LEVERAGE = 1;
const BASE_RISK_PER_TRADE_PCT = 2;
const MAX_RISK_PER_TRADE_PCT = 8;
const MAX_OPEN_TRADES = 50;
const MAX_SYMBOL_EXPOSURE_PCT = 12;
const DEFAULT_TRAILING_PCT = 0.35;
const MIN_RR_RATIO = Number(config.MOCK_MIN_RR_RATIO || 1.0);
const DAILY_LOSS_CUTOFF_PCT = 5;

// ── Execution Profile: per-symbol learned parameters ────────
export async function getExecutionProfile(symbol) {
  const { data: profile } = await supabase
    .from('execution_profiles')
    .select('*')
    .eq('symbol', symbol)
    .maybeSingle();

  if (profile) return profile;

  // Default conservative profile for new symbols
  return {
    symbol,
    base_leverage: 3,
    optimal_sl_pct: 0.6,
    optimal_tp_pct: 1.8,
    avg_fill_slippage_bps: 5,
    win_rate: 0.5,
    avg_rr: 1.5,
    best_timeframe: '15m',
    regime: 'unknown',
    confidence: 0.5,
  };
}

export async function updateExecutionProfile(symbol, tradeResult) {
  const profile = await getExecutionProfile(symbol);
  const oldTrades = profile.total_trades || 0;
  const newTrades = oldTrades + 1;

  // Bayesian update of win rate
  const wasWin = tradeResult.pnlUsd > 0;
  const newWinRate = ((profile.win_rate || 0.5) * oldTrades + (wasWin ? 1 : 0)) / newTrades;

  // Update R/R tracking
  const oldRR = profile.avg_rr || 1.5;
  const thisRR = Math.abs(tradeResult.tpDistance || 1.8) / Math.abs(tradeResult.slDistance || 0.6);
  const newRR = (oldRR * oldTrades + thisRR) / newTrades;

  // Adjust leverage: reduce on loss streaks, increase on win streaks
  let newLeverage = profile.base_leverage || 3;
  const recentLosses = (await supabase
    .from('mock_trades')
    .select('pnl_usd')
    .eq('symbol', symbol)
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(5)).data || [];

  const lossStreak = recentLosses.filter((t) => (t.pnl_usd || 0) < 0).length;
  if (lossStreak >= 3) newLeverage = Math.max(1, newLeverage * 0.7);
  else if (lossStreak === 0 && newWinRate > 0.55) newLeverage = Math.min(ABSOLUTE_MAX_LEVERAGE, newLeverage * 1.1);

  await supabase.from('execution_profiles').upsert({
    symbol,
    base_leverage: Math.round(newLeverage),
    win_rate: Number(newWinRate.toFixed(3)),
    avg_rr: Number(newRR.toFixed(2)),
    total_trades: newTrades,
    total_pnl: (profile.total_pnl || 0) + tradeResult.pnlUsd,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'symbol' });
}

// ── Account ─────────────────────────────────────────────────
export async function getOrCreateExecutionAccount() {
  const knownCols = '*';
  try {
    // 1. Try v3 account first
    let { data: existing } = await supabase
      .from('mock_accounts')
      .select(knownCols)
      .eq('name', 'Execution Optimizer v3')
      .limit(1)
      .maybeSingle();

    // 2. Fall back to any account
    if (!existing) {
      const { data: anyAccount } = await supabase
        .from('mock_accounts')
        .select(knownCols)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      existing = anyAccount;
    }

    if (existing) {
      logger.debug('[EXEC] Using existing account:', existing.id, existing.name);
      return existing;
    }

    // 3. Insert with RETURNING (bypasses RLS read blocks via PostgreSQL RETURNING clause)
    const accountData = {
      name: 'Execution Optimizer v3',
      starting_balance: STARTING_BALANCE,
      current_balance: STARTING_BALANCE,
      peak_balance: STARTING_BALANCE,
      metadata: { version: 'v3', auto_created: true, created_at: new Date().toISOString() }
    };
    
    logger.info('[EXEC] Creating new execution account...');
    const { data: inserted, error: insertError } = await supabase
      .from('mock_accounts')
      .insert(accountData)
      .select(knownCols)
      .single();

    if (inserted) {
      logger.info('[EXEC] Created execution account:', inserted.id);
      return inserted;
    }

    // 4. If insert errored with duplicate, fetch existing
    if (insertError) {
      logger.warn('[EXEC] Insert account error:', insertError.message, insertError.code);
      if (insertError.code === '23505' || insertError.message?.includes('duplicate')) {
        const { data: fetched } = await supabase
          .from('mock_accounts')
          .select(knownCols)
          .eq('name', 'Execution Optimizer v3')
          .maybeSingle();
        if (fetched) {
          logger.info('[EXEC] Fetched existing account after duplicate:', fetched.id);
          return fetched;
        }
      }
    }
    
    // 5. Try inserting with a unique name to avoid conflicts
    const uniqueName = `Execution Optimizer v3 ${Date.now()}`;
    logger.info('[EXEC] Trying with unique name:', uniqueName);
    const { data: insertedUnique, error: uniqueError } = await supabase
      .from('mock_accounts')
      .insert({
        name: uniqueName,
        starting_balance: STARTING_BALANCE,
        current_balance: STARTING_BALANCE,
        peak_balance: STARTING_BALANCE,
        metadata: { version: 'v3', auto_created: true, fallback: true }
      })
      .select(knownCols)
      .single();
      
    if (insertedUnique) {
      logger.info('[EXEC] Created unique execution account:', insertedUnique.id);
      return insertedUnique;
    }
    
    if (uniqueError) {
      logger.error('[EXEC] Unique insert also failed:', uniqueError.message);
    }
  } catch (err) {
    logger.error('[EXEC] getOrCreateExecutionAccount unexpected error:', err.message, err.stack);
  }

  // 6. CRITICAL: Return null to signal failure - worker should NOT trade without a valid account
  logger.error('[EXEC] CRITICAL: Could not create or fetch execution account. Trading DISABLED.');
  logger.error('[EXEC] Run this SQL in Supabase to fix: INSERT INTO mock_accounts (name, starting_balance, current_balance, peak_balance) VALUES (\'Execution Optimizer v3\', 1000000, 1000000, 1000000);');
  return null;
}

// ── Evaluate signal for execution worthiness ────────────────
export async function evaluateSignalForExecution(signal) {
  const profile = await getExecutionProfile(signal.symbol);

  // 1. Risk/Reward check
  const slDistance = Math.abs(signal.entry_price - (signal.stop_loss || signal.entry_price * 0.994));
  const tpDistance = Math.abs((signal.take_profit?.[0] || signal.entry_price * 1.012) - signal.entry_price);
  const rrRatio = tpDistance / Math.max(slDistance, signal.entry_price * 0.002);

  // In paper mode, be more permissive with R/R to allow learning from marginal signals
  const effectiveMinRr = (signal.mode === 'paper' || !signal.mode) ? Math.max(0.8, MIN_RR_RATIO) : MIN_RR_RATIO;
  if (rrRatio < effectiveMinRr) {
    return { execute: false, reason: `R/R ${rrRatio.toFixed(2)} < min ${effectiveMinRr}` };
  }

  // 2. ML model validation (if available)
  let mlBoost = 0;
  try {
    const features = buildFeatures({
      ruleProbability: signal.confidence || 0.5,
      fundingRate: signal.metadata?.funding_rate || 0,
      openInterestChangePct: signal.metadata?.oi_change || 0,
      liquidationImbalance: signal.metadata?.liq_imbalance || 0,
      volumeChangePct: signal.metadata?.volume_change || 0,
      volatilityPct: signal.metadata?.volatility || 2,
      socialSentiment: signal.metadata?.social_sentiment || 0,
      newsSentiment: signal.metadata?.news_sentiment || 0,
      side: signal.side,
    });
    const mlResult = await getMlSignal(vectorize(features));
    if (mlResult.confidence && mlResult.signal !== 'NO_MODEL') {
      const mlProb = mlResult.confidence;
      // In paper mode, never reject on low ML confidence — just skip the boost
      const isPaper = signal.mode === 'paper' || !signal.mode;
      const mlThreshold = isPaper ? 0.0 : 0.45;
      if (!isPaper && mlProb < mlThreshold) {
        return { execute: false, reason: `ML confidence ${mlProb.toFixed(2)} too low (threshold ${mlThreshold})` };
      }
      mlBoost = (mlProb - 0.5) * 0.3; // +/- 15% boost
    }
  } catch (e) {
    logger.debug(`[EXEC] ML check skipped for ${signal.symbol}: ${e.message}`);
  }

  // 3. RL portfolio state check
  try {
    const account = await getOrCreateExecutionAccount();
    const openCount = (await supabase.from('mock_trades').select('id', { count: 'exact', head: true }).eq('status', 'open')).count || 0;
    const todayPnl = await getTodayPnl(account.id);
    const rlResult = await getRlDecision(
      { symbol: signal.symbol, side: signal.side, confidence: signal.confidence, rr_ratio: rrRatio },
      { balance: account.current_balance, open_positions: openCount, today_pnl: todayPnl, max_drawdown_pct: await getMaxDrawdownPct(account) }
    );
    if (rlResult.decision?.action === 'skip') {
      return { execute: false, reason: `RL agent recommends skip: ${rlResult.decision.reason}` };
    }
  } catch (e) {
    logger.debug(`[EXEC] RL check skipped: ${e.message}`);
  }

  // 4. TV TA confluence (optional boost)
  let tvConfluence = 'neutral';
  try {
    const tv = await fetchTvAnalysis(signal.symbol, 'BINANCE', signal.timeframe || '15m');
    tvConfluence = tv?.overall || 'neutral';
    const aligned = (signal.side === 'LONG' && tvConfluence === 'BUY') || (signal.side === 'SHORT' && tvConfluence === 'SELL');
    // In paper mode, never reject on TV misalignment — just skip the confluence bonus
    const isPaper = signal.mode === 'paper' || !signal.mode;
    const tvThreshold = isPaper ? 0.0 : 0.75;
    if (!isPaper && !aligned && signal.confidence < tvThreshold) {
      return { execute: false, reason: `TV TA (${tvConfluence}) misaligned with signal ${signal.side}` };
    }
  } catch (e) {
    // TV optional
  }

  // 5. Daily loss cutoff
  const account = await getOrCreateExecutionAccount();
  const todayLoss = Math.abs(await getTodayPnl(account.id));
  const dailyLossPct = (todayLoss / account.current_balance) * 100;
  if (dailyLossPct > DAILY_LOSS_CUTOFF_PCT) {
    return { execute: false, reason: `Daily loss limit hit: ${dailyLossPct.toFixed(1)}% > ${DAILY_LOSS_CUTOFF_PCT}%` };
  }

  // 6. Confidence composite
  const compositeConfidence = Math.min(1, (signal.confidence || 0.5) + mlBoost + (tvConfluence === (signal.side === 'LONG' ? 'BUY' : 'SELL') ? 0.1 : 0));

  return {
    execute: true,
    rrRatio,
    compositeConfidence,
    profile,
    mlBoost,
    tvConfluence,
  };
}

// ── Open execution ──────────────────────────────────────────
export async function openExecution(signal, evaluation) {
  const account = await getOrCreateExecutionAccount();
  const balance = Number(account.current_balance);

  // Count open trades
  const { count: openCount } = await supabase
    .from('mock_trades')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');
  if (openCount >= MAX_OPEN_TRADES) {
    return { error: `Max open trades (${MAX_OPEN_TRADES}) reached` };
  }

  const profile = evaluation.profile;
  const leverage = Math.min(ABSOLUTE_MAX_LEVERAGE, Math.max(ABSOLUTE_MIN_LEVERAGE, profile.base_leverage || 3));

  // Kelly-adjusted position sizing
  const winRate = Math.max(0.3, Math.min(0.8, profile.win_rate || 0.5));
  const avgRR = Math.max(1.0, profile.avg_rr || 1.5);
  const kellyFraction = (winRate * avgRR - (1 - winRate)) / avgRR; // Kelly %
  const kellyPct = Math.max(0.01, Math.min(MAX_RISK_PER_TRADE_PCT / 100, kellyFraction * 0.25)); // Quarter Kelly
  const riskPct = kellyPct * 100 * (evaluation.compositeConfidence || 0.5);

  const slPct = profile.optimal_sl_pct || 0.6;
  const tpPct = profile.optimal_tp_pct || 1.8;
  const entry = Number(signal.entry_price);

  const positionSizeUsd = (balance * (riskPct / 100) / (slPct / 100)) * leverage;
  const marginUsed = positionSizeUsd / leverage;

  // Symbol exposure cap
  const { data: openSymbol } = await supabase
    .from('mock_trades')
    .select('position_size_usd')
    .eq('symbol', signal.symbol)
    .eq('status', 'open');
  const currentExposure = (openSymbol || []).reduce((s, t) => s + (t.position_size_usd || 0), 0);
  const maxExposure = balance * (MAX_SYMBOL_EXPOSURE_PCT / 100);
  const actualSize = Math.min(positionSizeUsd, Math.max(0, maxExposure - currentExposure));

  if (actualSize <= 0) {
    return { error: 'Symbol exposure cap reached' };
  }

  const stopLoss = signal.side === 'LONG' || signal.side === 'long'
    ? entry * (1 - slPct / 100)
    : entry * (1 + slPct / 100);
  const takeProfit = signal.side === 'LONG' || signal.side === 'long'
    ? entry * (1 + tpPct / 100)
    : entry * (1 - tpPct / 100);

  const insertPayload = {
    account_id: account.id,
    signal_id: signal.id || null,
    symbol: signal.symbol,
    side: (signal.side || '').toLowerCase(),
    strategy_name: signal.strategy || 'execution_optimizer',
    entry_price: entry,
    leverage,
    position_size_usd: actualSize,
    margin_used: actualSize / leverage,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    status: 'open',
    entry_reason: `Exec v3: RR=${evaluation.rrRatio.toFixed(2)}, lev=${leverage}x, risk=${riskPct.toFixed(2)}%, kelly=${(kellyFraction * 100).toFixed(1)}%, conf=${(evaluation.compositeConfidence * 100).toFixed(0)}%, TV=${evaluation.tvConfluence || 'N/A'}`,
    probability_at_entry: evaluation.compositeConfidence,
    score_breakdown: { evaluation, profile, kellyFraction, riskPct, trailing_stop_pct: DEFAULT_TRAILING_PCT, highest_price: entry, lowest_price: entry, execution_version: 'v3' },
  };

  const { data, error } = await supabase.from('mock_trades').insert(insertPayload).select('*').single();

  if (error) {
    logger.warn(`[EXEC] INSERT FAILED: ${error.message}`);
    return { error: error.message };
  }
  logger.info(`[EXEC] OPEN ${signal.symbol} ${signal.side} @$${entry} lev=${leverage}x size=$${actualSize.toFixed(0)} RR=${evaluation.rrRatio.toFixed(2)}`);
  return { trade: data };
}

// ── Monitor with trailing stop + time decay ─────────────────
export async function monitorExecutions() {
  const { data: openTrades } = await supabase
    .from('mock_trades')
    .select('*')
    .eq('status', 'open');

  if (!openTrades?.length) return [];

  const closed = [];
  for (const trade of openTrades) {
    try {
      const { price, source } = await fetchPublicPrice(trade.symbol);
      logger.debug(`[EXEC] ${trade.symbol} price from ${source}: ${price}`);
      const sl = Number(trade.stop_loss);
      const tp = Number(trade.take_profit);
      const trailingPct = Number(trade.trailing_stop_pct || DEFAULT_TRAILING_PCT);
      let highest = Math.max(Number(trade.highest_price || trade.entry_price), price);
      let lowest = Math.min(Number(trade.lowest_price || trade.entry_price), price);

      // Breakeven move: once +0.5% in profit, move SL to breakeven
      const beThreshold = trade.side === 'long' ? 1.005 : 0.995;
      const bePrice = Number(trade.entry_price);
      let effectiveSL = sl;

      if (trade.side === 'long') {
        if (highest > bePrice * beThreshold) {
          effectiveSL = Math.max(sl, bePrice * 1.001); // Breakeven + small buffer
        }
        // Trailing: lock in profits
        if (highest > bePrice * 1.01) {
          const trail = highest * (1 - trailingPct / 100);
          effectiveSL = Math.max(effectiveSL, trail);
        }
      } else {
        if (lowest < bePrice * beThreshold) {
          effectiveSL = Math.min(sl, bePrice * 0.999);
        }
        if (lowest < bePrice * 0.99) {
          const trail = lowest * (1 + trailingPct / 100);
          effectiveSL = Math.min(effectiveSL, trail);
        }
      }

      const hitSL = trade.side === 'long' ? price <= effectiveSL : price >= effectiveSL;
      const hitTP = trade.side === 'long' ? price >= tp : price <= tp;

      // Time decay: close if open > 4h with < 0.2% profit
      const ageMinutes = (Date.now() - new Date(trade.created_at).getTime()) / 60000;
      const unrealized = trade.side === 'long'
        ? ((price - bePrice) / bePrice) * 100 * trade.leverage
        : ((bePrice - price) / bePrice) * 100 * trade.leverage;
      const hitTimeDecay = ageMinutes > 240 && unrealized < 0.2;

      let exitReason = null;
      if (hitSL) exitReason = effectiveSL > sl ? 'trailing_stop' : 'stop_loss';
      else if (hitTP) exitReason = 'take_profit';
      else if (hitTimeDecay) exitReason = 'time_decay';

      if (exitReason) {
        const result = await closeExecution(trade.id, price, exitReason, { highest, lowest, effectiveSL, unrealized, ageMinutes });
        closed.push(result);
      } else {
        await supabase.from('mock_trades').update({ highest_price: highest, lowest_price: lowest }).eq('id', trade.id);
      }
    } catch (e) {
      logger.warn(`[EXEC] Monitor failed for ${trade.symbol}: ${e.message}`);
    }
  }

  return closed;
}

// ── Close execution + learn ─────────────────────────────────
export async function closeExecution(tradeId, exitPrice, exitReason, meta = {}) {
  const { data: trade } = await supabase.from('mock_trades').select('*').eq('id', tradeId).single();
  if (!trade || trade.status !== 'open') return null;

  const pnl = calculatePnl({
    side: trade.side,
    entryPrice: Number(trade.entry_price),
    exitPrice,
    leverage: Number(trade.leverage),
    positionSizeUsd: Number(trade.position_size_usd),
    feePct: 0.06,
  });

  const { error: closeErr } = await supabase.from('mock_trades').update({
    exit_price: exitPrice,
    pnl_pct: pnl.pnlPct,
    pnl_usd: pnl.pnlUsd,
    status: 'closed',
    exit_reason: exitReason,
    closed_at: new Date().toISOString(),
  }).eq('id', tradeId);

  if (closeErr) {
    logger.error(`[EXEC] Close update failed for ${trade.symbol}: ${closeErr.message}`);
    return null;
  }

  try {
    await supabase
      .from('mock_trades')
      .update({ metadata: { ...(trade.metadata || {}), closeMeta: meta } })
      .eq('id', tradeId);
  } catch (e) {
    logger.debug(`[EXEC] Close metadata skipped for ${trade.symbol}: ${e.message}`);
  }

  const account = await getOrCreateExecutionAccount();
  const newBalance = Number(account.current_balance) + pnl.pnlUsd;
  const peak = Math.max(Number(account.peak_balance || newBalance), newBalance);
  await supabase.from('mock_accounts').update({
    current_balance: newBalance,
    peak_balance: peak,
    realized_pnl: Number(account.realized_pnl || 0) + pnl.pnlUsd,
  }).eq('id', account.id);

  // Learn from this execution
  await updateExecutionProfile(trade.symbol, {
    pnlUsd: pnl.pnlUsd,
    slDistance: Math.abs(trade.entry_price - trade.stop_loss),
    tpDistance: Math.abs(trade.take_profit - trade.entry_price),
    leverage: trade.leverage,
    exitReason,
  });

  logger.info(`[EXEC] CLOSE ${trade.symbol} ${exitReason} PnL=$${pnl.pnlUsd.toFixed(2)} Bal=$${newBalance.toFixed(2)}`);
  return { ...trade, exitPrice, pnl, exitReason };
}

// ── Helpers ─────────────────────────────────────────────────
async function getTodayPnl(accountId) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('mock_trades')
    .select('pnl_usd')
    .eq('account_id', accountId)
    .eq('status', 'closed')
    .gte('closed_at', `${today}T00:00:00Z`);
  return (data || []).reduce((s, t) => s + (t.pnl_usd || 0), 0);
}

async function getMaxDrawdownPct(account) {
  const { data } = await supabase
    .from('mock_trades')
    .select('pnl_usd, created_at')
    .eq('account_id', account.id)
    .eq('status', 'closed')
    .order('created_at', { ascending: true });

  let peak = 0;
  let running = 0;
  let maxDD = 0;
  for (const t of data || []) {
    running += t.pnl_usd || 0;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }
  return account.starting_balance > 0 ? (maxDD / account.starting_balance) * 100 : 0;
}
