// ============================================================
// Aggressive Mock Trading Engine v3 — ML-Powered Perpetual Trader
// Trades public perpetual symbols. Self-adjusts leverage via ML.
// Learns from losses. Uses trailing stops. Integrates with RL service.
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { calculatePositionSize } from './position-sizing.js';
import { calculatePnl } from '../backtest/pnl-calculator.js';
import { fetchTvAnalysis } from '../tradingview-ta.js';
import { fetchHyperliquidPerpSymbols, fetchPublicPrice, getPriceSourceOrder } from '../market-price.js';
import { logTradeHistory } from './trade-history.js';

const STARTING_BALANCE = Number(config.MOCK_STARTING_BALANCE || 1_000_000);
const MAX_LEVERAGE = Number(config.MOCK_MAX_LEVERAGE || 20);
const MIN_LEVERAGE = 1;
const BASE_RISK_PCT = Number(config.MOCK_RISK_PER_TRADE_PCT || 2);
const MAX_RISK_PCT = 5;
const MAX_OPEN_TRADES = Number(config.MOCK_MAX_OPEN_TRADES || 50);
const TRAILING_STOP_PCT = 0.4;
const MAX_SYMBOL_EXPOSURE_PCT = 15;

// ── Leverage ML Model (simple Bayesian-like adjustment) ─────
/**
 * Get per-symbol leverage recommendation based on historical performance.
 * Leverage starts at 3x, increases up to 20x on winning streaks,
 * decreases to 1x on losing streaks.
 */
export async function getAdaptiveLeverage(symbol, strategy) {
  try {
    const { data: history } = await supabase
      .from('mock_trades')
      .select('pnl_usd, leverage')
      .eq('symbol', symbol)
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })
      .limit(20);

    if (!history || history.length < 5) {
      // Default for new symbols
      return { leverage: 3, reason: 'insufficient_history' };
    }

    const wins = history.filter((h) => (h.pnl_usd || 0) > 0);
    const winRate = wins.length / history.length;
    const avgPnl = history.reduce((s, h) => s + (h.pnl_usd || 0), 0) / history.length;
    const avgLeverage = history.reduce((s, h) => s + (h.leverage || 3), 0) / history.length;

    // Kelly-like leverage adjustment
    let leverage = avgLeverage;
    if (winRate > 0.65 && avgPnl > 0) leverage *= 1.3;
    else if (winRate > 0.55 && avgPnl > 0) leverage *= 1.15;
    else if (winRate < 0.4) leverage *= 0.6;
    else if (winRate < 0.5) leverage *= 0.8;

    // Clamp
    leverage = Math.max(MIN_LEVERAGE, Math.min(MAX_LEVERAGE, Math.round(leverage)));

    return { leverage, reason: `wr=${(winRate * 100).toFixed(0)}%, avgPnl=$${avgPnl.toFixed(0)}`, winRate };
  } catch (e) {
    logger.warn(`[AGGRESSIVE-ENGINE] Leverage calc failed for ${symbol}: ${e.message}`);
    return { leverage: 3, reason: 'error_fallback' };
  }
}

// ── Risk-adjusted position sizing ───────────────────────────
export async function calculateAggressiveSize({ balance, symbol, leverage, signalConfidence, volatilityPct = 2 }) {
  // Higher confidence + lower volatility = bigger size
  const confidenceMultiplier = 0.5 + (signalConfidence || 0.5);
  const volAdjustment = Math.max(0.3, 1 - (volatilityPct / 10));
  const riskPct = Math.min(MAX_RISK_PCT, BASE_RISK_PCT * confidenceMultiplier * volAdjustment);

  const sizing = calculatePositionSize({
    balance,
    riskPerTradePct: riskPct,
    stopLossPct: 0.8, // Tight stops for perpetuals
    leverage,
  });

  // Check symbol exposure cap
  const { data: openSymbol } = await supabase
    .from('mock_trades')
    .select('position_size_usd')
    .eq('symbol', symbol)
    .eq('status', 'open');
  const currentExposure = (openSymbol || []).reduce((s, t) => s + (t.position_size_usd || 0), 0);
  const maxExposure = balance * (MAX_SYMBOL_EXPOSURE_PCT / 100);
  const remaining = Math.max(0, maxExposure - currentExposure);

  if (sizing.positionSizeUsd > remaining) {
    sizing.positionSizeUsd = remaining;
    sizing.marginUsed = remaining / leverage;
    sizing.capped = true;
  }

  return { ...sizing, riskPct };
}

// ── Account management ──────────────────────────────────────
export async function getOrCreateAggressiveAccount() {
  const knownCols = '*';

  // 1. Try exact name match
  let { data: existing } = await supabase
    .from('mock_accounts')
    .select(knownCols)
    .eq('name', 'Aggressive AI Trader')
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

  if (existing) return existing;

  // 3. Insert with minimal columns first (safer when schema has optional columns)
  const insertData = {
    name: 'Aggressive AI Trader',
    starting_balance: STARTING_BALANCE,
    current_balance: STARTING_BALANCE,
  };
  
  // Try with optional columns if schema supports them
  try {
    const { error: insertError } = await supabase.from('mock_accounts').insert({
      ...insertData,
      peak_balance: STARTING_BALANCE,
      metadata: { version: 'v3_ml', created_at: new Date().toISOString() },
    });

    if (insertError) {
      // If peak_balance or metadata error, try without them
      if (insertError.message?.includes('peak_balance') || insertError.message?.includes('metadata')) {
        const { error: minimalError } = await supabase.from('mock_accounts').insert(insertData);
        if (!minimalError) {
          // Success with minimal insert, fetch the account
          const { data: fetched } = await supabase
            .from('mock_accounts')
            .select(knownCols)
            .eq('name', 'Aggressive AI Trader')
            .maybeSingle();
          if (fetched) return fetched;
        }
        if (minimalError && !minimalError.message?.includes('duplicate')) {
          logger.warn(`[AGGRESSIVE-ENGINE] Minimal insert error: ${minimalError.message}`);
        }
      } else if (insertError.message?.includes('duplicate') || insertError.code === '23505') {
        const { data: fetched } = await supabase
          .from('mock_accounts')
          .select(knownCols)
          .eq('name', 'Aggressive AI Trader')
          .maybeSingle();
        if (fetched) return fetched;
      } else {
        logger.warn(`[AGGRESSIVE-ENGINE] Insert account error: ${insertError.message}`);
      }
    }
  } catch (insertErr) {
    // Try minimal fallback
    try {
      const { error: minimalError } = await supabase.from('mock_accounts').insert(insertData);
      if (!minimalError) {
        const { data: fetched } = await supabase
          .from('mock_accounts')
          .select('id, name, starting_balance, current_balance, created_at')
          .eq('name', 'Aggressive AI Trader')
          .maybeSingle();
        if (fetched) return fetched;
      }
    } catch (e) {
      logger.warn(`[AGGRESSIVE-ENGINE] Fallback insert failed: ${e.message}`);
    }
  }

  // 4. Fetch what we just inserted (or existing)
  const { data: fetched } = await supabase
    .from('mock_accounts')
    .select(knownCols)
    .eq('name', 'Aggressive AI Trader')
    .maybeSingle();

  if (fetched) return fetched;

  // 5. Ultimate fallback: ephemeral in-memory account so worker doesn't crash
  logger.warn('[AGGRESSIVE-ENGINE] Could not persist account — using ephemeral in-memory account');
  return {
    id: 'ephemeral-aggressive-v3',
    name: 'Aggressive AI Trader',
    starting_balance: STARTING_BALANCE,
    current_balance: STARTING_BALANCE,
    peak_balance: STARTING_BALANCE,
    created_at: new Date().toISOString(),
  };
}

// ── Open trade with trailing stop ───────────────────────────
export async function openAggressiveTrade(signal, opts = {}) {
  const account = await getOrCreateAggressiveAccount();
  const balance = Number(account.current_balance);

  // Count open trades
  const { count: openCount } = await supabase
    .from('mock_trades')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'open');
  if (openCount >= MAX_OPEN_TRADES) {
    logger.info(`[AGGRESSIVE-ENGINE] Max open trades reached (${MAX_OPEN_TRADES})`);
    return null;
  }

  // Adaptive leverage
  const { leverage, reason: levReason } = await getAdaptiveLeverage(signal.symbol, signal.strategy);

  // Position sizing
  const sizing = await calculateAggressiveSize({
    balance,
    symbol: signal.symbol,
    leverage,
    signalConfidence: signal.confidence || 0.5,
    volatilityPct: signal.volatility_pct || 2,
  });

  if (sizing.positionSizeUsd <= 0) {
    logger.info(`[AGGRESSIVE-ENGINE] Zero size for ${signal.symbol} (exposure cap)`);
    return null;
  }

  const entry = Number(signal.price || signal.entry_price);
  const stopLossPct = 0.8;
  const takeProfitPct = 2.0;
  const stopLoss = signal.side === 'long'
    ? entry * (1 - stopLossPct / 100)
    : entry * (1 + stopLossPct / 100);
  const takeProfit = signal.side === 'long'
    ? entry * (1 + takeProfitPct / 100)
    : entry * (1 - takeProfitPct / 100);

  // Fetch TradingView TA for extra validation
  let tvSummary = null;
  try {
    tvSummary = await fetchTvAnalysis(signal.symbol, 'BINANCE', signal.timeframe || '15m');
  } catch (e) {
    logger.warn(`[AGGRESSIVE-ENGINE] TV fetch failed for ${signal.symbol}: ${e.message}`);
  }

  const { data, error } = await supabase.from('mock_trades').insert({
    account_id: account.id,
    signal_id: signal.id || null,
    symbol: signal.symbol,
    side: signal.side,
    strategy_name: signal.strategy || 'aggressive_ml',
    entry_price: entry,
    leverage,
    position_size_usd: sizing.positionSizeUsd,
    margin_used: sizing.marginUsed,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    trailing_stop_pct: TRAILING_STOP_PCT,
    highest_price: entry,
    lowest_price: entry,
    status: 'open',
    entry_reason: `Aggressive v3: lev=${leverage}x (${levReason}), size=$${sizing.positionSizeUsd.toFixed(0)}, risk=${sizing.riskPct.toFixed(2)}%, tv=${tvSummary?.overall || 'N/A'}`,
    probability_at_entry: signal.confidence || 0.5,
    score_breakdown: { ...opts, tvSummary, sizing, leverage: { value: leverage, reason: levReason } },
  }).select('*').single();

  if (error) throw error;
  try {
    await supabase
      .from('mock_trades')
      .update({ metadata: { tvSummary, leverageReason: levReason } })
      .eq('id', data.id);
  } catch (e) {
    logger.debug(`[AGGRESSIVE-ENGINE] Entry metadata skipped for ${signal.symbol}: ${e.message}`);
  }
  logger.info(`[AGGRESSIVE-ENGINE] OPEN ${signal.symbol} ${signal.side} @ $${entry} lev=${leverage}x size=$${sizing.positionSizeUsd.toFixed(0)}`);

  await logTradeHistory({
    tradeId: data.id,
    accountId: account.id,
    event: 'opened',
    symbol: signal.symbol,
    side: data.side,
    price: entry,
    leverage,
    positionSizeUsd: sizing.positionSizeUsd,
    metadata: { tvSummary, levReason, sizing }
  });

  return data;
}

// ── Monitor & close with trailing stop ──────────────────────
export async function monitorAndCloseAggressive() {
  const { data: openTrades } = await supabase
    .from('mock_trades')
    .select('*')
    .eq('status', 'open');

  if (!openTrades?.length) return [];

  const closed = [];

  for (const trade of openTrades) {
    try {
      const { price, source } = await fetchPublicPrice(trade.symbol);
      logger.debug(`[AGGRESSIVE-ENGINE] ${trade.symbol} price from ${source}: ${price}`);
      const sl = Number(trade.stop_loss);
      const tp = Number(trade.take_profit);
      const trailingPct = Number(trade.trailing_stop_pct || TRAILING_STOP_PCT);
      let highest = Number(trade.highest_price || trade.entry_price);
      let lowest = Number(trade.lowest_price || trade.entry_price);

      // Update trailing extremes
      if (price > highest) highest = price;
      if (price < lowest) lowest = price;

      const hitSl = trade.side === 'long' ? price <= sl : price >= sl;
      const hitTp = trade.side === 'long' ? price >= tp : price <= tp;

      // Trailing stop logic
      let trailingSl = sl;
      let hitTrailing = false;
      if (trade.side === 'long' && highest > trade.entry_price * 1.005) {
        trailingSl = Math.max(sl, highest * (1 - trailingPct / 100));
        hitTrailing = price <= trailingSl;
      } else if (trade.side === 'short' && lowest < trade.entry_price * 0.995) {
        trailingSl = Math.min(sl, lowest * (1 + trailingPct / 100));
        hitTrailing = price >= trailingSl;
      }

      let exitReason = null;
      if (hitSl) exitReason = 'stop_loss';
      else if (hitTp) exitReason = 'take_profit';
      else if (hitTrailing) exitReason = 'trailing_stop';

      if (exitReason) {
        const result = await closeAggressiveTrade(trade.id, price, exitReason, { highest, lowest, trailingSl });
        closed.push(result);
      } else {
        // Update extremes in DB
        await supabase.from('mock_trades').update({ highest_price: highest, lowest_price: lowest }).eq('id', trade.id);
      }
    } catch (e) {
      logger.warn(`[AGGRESSIVE-ENGINE] Monitor failed for ${trade.symbol}: ${e.message}`);
    }
  }

  return closed;
}

// ── Close trade + update account + learn from outcome ───────
export async function closeAggressiveTrade(tradeId, exitPrice, exitReason, meta = {}) {
  const { data: trade } = await supabase.from('mock_trades').select('*').eq('id', tradeId).single();
  if (!trade || trade.status !== 'open') return null;

  const pnl = calculatePnl({
    side: trade.side,
    entryPrice: Number(trade.entry_price),
    exitPrice,
    leverage: Number(trade.leverage),
    positionSizeUsd: Number(trade.position_size_usd),
    feePct: 0.06, // Perp fees
  });

  const { error } = await supabase.from('mock_trades').update({
    exit_price: exitPrice,
    pnl_pct: pnl.pnlPct,
    pnl_usd: pnl.pnlUsd,
    status: 'closed',
    exit_reason: exitReason,
    closed_at: new Date().toISOString(),
  }).eq('id', tradeId);
  if (error) throw error;

  try {
    await supabase
      .from('mock_trades')
      .update({ metadata: { ...(trade.metadata || {}), closeMeta: meta } })
      .eq('id', tradeId);
  } catch (e) {
    logger.debug(`[AGGRESSIVE-ENGINE] Close metadata skipped for ${trade.symbol}: ${e.message}`);
  }

  // Update account
  const account = await getOrCreateAggressiveAccount();
  const newBalance = Number(account.current_balance) + pnl.pnlUsd;
  const peak = Math.max(Number(account.peak_balance || newBalance), newBalance);
  await supabase.from('mock_accounts').update({
    current_balance: newBalance,
    peak_balance: peak,
    realized_pnl: Number(account.realized_pnl || 0) + pnl.pnlUsd,
  }).eq('id', account.id);

  // ── Loss-pattern learning ────────────────────────────────
  if (pnl.pnlUsd < 0) {
    try {
      await learnFromLoss(trade, pnl);
    } catch (e) {
      logger.warn('[AGGRESSIVE-ENGINE] learnFromLoss failed:', e.message);
    }
  }

  logger.info(`[AGGRESSIVE-ENGINE] CLOSE ${trade.symbol} ${exitReason} PnL=$${pnl.pnlUsd.toFixed(2)} Bal=$${newBalance.toFixed(2)}`);

  await logTradeHistory({
    tradeId: trade.id,
    accountId: account.id,
    event: 'closed',
    symbol: trade.symbol,
    side: trade.side,
    price: exitPrice,
    pnlUsd: pnl.pnlUsd,
    pnlPct: pnl.pnlPct,
    balanceAfter: newBalance,
    leverage: trade.leverage,
    positionSizeUsd: trade.position_size_usd,
    exitReason,
    metadata: meta,
  });

  return { ...trade, exitPrice, pnl, exitReason };
}

// ── Loss-pattern learning ───────────────────────────────────
async function learnFromLoss(trade, pnl) {
  const symbol = trade.symbol;
  const strategy = trade.strategy_name;
  const leverage = trade.leverage;

  // Insert into loss_patterns for ML analysis (best-effort; table may not exist yet)
  try {
    await supabase.from('loss_patterns').insert({
      symbol,
      strategy,
      leverage,
      side: trade.side,
      entry_price: trade.entry_price,
      exit_price: trade.exit_price,
      pnl_usd: pnl.pnlUsd,
      pnl_pct: pnl.pnlPct,
      exit_reason: trade.exit_reason,
      score_breakdown: trade.score_breakdown,
      metadata: trade.metadata,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    logger.debug(`[AGGRESSIVE-ENGINE] loss_patterns insert skipped (table may not exist): ${e.message}`);
  }

  // If 3+ losses on same symbol with leverage >= 10, reduce future leverage
  const { count: symbolLosses } = await supabase
    .from('mock_trades')
    .select('*', { count: 'exact', head: true })
    .eq('symbol', symbol)
    .eq('status', 'closed')
    .lt('pnl_usd', 0)
    .gte('leverage', 10)
    .gte('closed_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (symbolLosses >= 3) {
    logger.warn(`[AGGRESSIVE-ENGINE] ${symbol}: ${symbolLosses} high-leverage losses in 7d. Reducing max leverage.`);
    // Future trades will naturally pick lower leverage via getAdaptiveLeverage
  }

  // Cross-agent improvement idea
  const { dedupSendIdea } = await import('../agent-improvement-bus.js');
  await dedupSendIdea({
    sourceBot: 'Aggressive Mock Trader',
    ideaType: 'Strategy Optimization',
    featureAffected: 'Leverage & Risk Model',
    observation: `Lost $${Math.abs(pnl.pnlUsd).toFixed(0)} on ${symbol} ${trade.side} with ${leverage}x leverage. Exit: ${trade.exit_reason}.`,
    recommendation: `Consider reducing leverage for ${symbol} to <=5x. Review signal confidence threshold for this symbol.`,
    expectedBenefit: 'Reduce drawdown and improve risk-adjusted returns.',
    priority: 'Medium',
    confidence: 'Needs Backtest',
    status: 'New',
  });
}

// ── Fetch all Binance perpetuals for trading ────────────────
export async function getAllPerpetualSymbols() {
  if (getPriceSourceOrder().includes('hyperliquid')) {
    try {
      const symbols = await fetchHyperliquidPerpSymbols();
      logger.info(`[AGGRESSIVE-ENGINE] Loaded ${symbols.length} Hyperliquid perpetual symbols`);
      return symbols;
    } catch (e) {
      logger.warn(`[AGGRESSIVE-ENGINE] Hyperliquid symbol load failed: ${e.message}`);
    }
  }

  try {
    const { createExchange } = await import('../trading.js');
    const ex = createExchange('binance', { skipCredentials: true });
    const markets = await ex.loadMarkets();
    const perps = Object.values(markets)
      .filter((m) => m.type === 'swap' && m.quote === 'USDT' && m.active)
      .map((m) => m.symbol)
      .sort();
    return perps;
  } catch (e) {
    logger.warn(`[AGGRESSIVE-ENGINE] Binance symbol fallback failed: ${e.message}`);
    return config.DEFAULT_PAIRS.map((p) => p.replace('/', ''));
  }
}
