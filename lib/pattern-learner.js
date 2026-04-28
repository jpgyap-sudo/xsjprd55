// ============================================================
// Pattern Learner — Extract & record signal features for ML analysis
// Hooks into signal generation pipeline to capture market context
// ============================================================

import { supabase } from './supabase.js';
import { buildMarketContext } from './ai.js';
import { buildLiquidationOverview } from './liquidation.js';
import { fetchAllNews } from './news-aggregator.js';
import { scoreNewsItems } from './news-sentiment.js';

/**
 * Extract a comprehensive feature pattern when a signal is generated.
 * Call this immediately after buildSignal() to snapshot market conditions.
 */
export async function extractPattern(signal, opts = {}) {
  const now = new Date().toISOString();

  // Gather market context
  let marketCtx = {};
  let liqCtx = {};
  let newsCtx = {};

  try {
    marketCtx = await buildMarketContext();
  } catch (e) {
    console.warn('[pattern-learner] market context failed:', e.message);
  }

  try {
    const liq = await buildLiquidationOverview();
    liqCtx = liq || {};
  } catch (e) {
    console.warn('[pattern-learner] liquidation context failed:', e.message);
  }

  try {
    const news = await fetchAllNews();
    const scored = scoreNewsItems(news || []);
    newsCtx = {
      sentiment_score: scored?.overall?.score ?? null,
      count_1h: scored?.overall?.count ?? 0,
      bullish: scored?.bullish?.length ?? 0,
      bearish: scored?.bearish?.length ?? 0,
    };
  } catch (e) {
    console.warn('[pattern-learner] news context failed:', e.message);
  }

  // Find symbol-specific market data
  const coin = marketCtx?.topCoins?.find(c =>
    c.symbol === signal.symbol || c.symbol === signal.symbol.replace('USDT','')
  );
  const global = marketCtx?.global || {};

  const pattern = {
    signal_id: signal.id,
    symbol: signal.symbol,
    side: signal.side,
    strategy: signal.strategy,
    timeframe: signal.timeframe,
    confidence: signal.confidence,
    source: signal.source,
    generated_at: signal.generated_at || now,

    // Market snapshot
    market_price: coin?.price ?? signal.entry_price ?? null,
    market_change_24h: coin?.change24h ?? null,
    market_volume_24h: coin?.volume24h ?? null,
    market_rsi_14: coin?.rsi ?? null,
    market_ema_9: coin?.ema9 ?? null,
    market_ema_21: coin?.ema21 ?? null,
    market_vol_spike: coin?.volSpike ?? null,

    // Liquidation snapshot
    liq_funding_annualized: liqCtx?.funding?.annualized ?? null,
    liq_open_interest_usd: liqCtx?.openInterestUSD ?? null,
    liq_risk_score: liqCtx?.riskScore ?? null,

    // News snapshot
    news_sentiment_score: newsCtx.sentiment_score,
    news_count_1h: newsCtx.count_1h,
    news_bullish_count: newsCtx.bullish,
    news_bearish_count: newsCtx.bearish,

    // Global snapshot
    global_btc_dominance: global?.btcDominance ?? null,
    global_fear_greed: global?.fearGreedIndex ?? null,
    global_total_mcap_usd: global?.totalMarketCap ?? null,

    // Outcome starts as pending
    outcome: 'pending',

    // Extensible feature vector
    feature_vector: {
      entry_price: signal.entry_price,
      stop_loss: signal.stop_loss,
      take_profit: signal.take_profit,
      mode: signal.mode,
      ...(opts.extraFeatures || {}),
    },
  };

  const { data, error } = await supabase
    .from('signal_patterns')
    .insert(pattern)
    .select('id')
    .single();

  if (error) {
    console.error('[pattern-learner] insert failed:', error.message);
    throw error;
  }

  // Log learning event
  await supabase.from('learning_feedback_log').insert({
    event_type: 'pattern_extracted',
    signal_id: signal.id,
    details: { pattern_id: data.id, strategy: signal.strategy },
  });

  console.log(`[pattern-learner] extracted pattern ${data.id} for signal ${signal.id}`);
  return data.id;
}

/**
 * Record the outcome of a signal after it closes or expires.
 * Call from trade close flow or expiration cron.
 */
export async function recordOutcome(signalId, outcome) {
  const update = {
    outcome: outcome.result, // 'win' | 'loss' | 'breakeven' | 'expired'
    outcome_pnl: outcome.pnl ?? 0,
    outcome_reached_tp: outcome.reachedTP ?? false,
    outcome_reached_sl: outcome.reachedSL ?? false,
    outcome_duration_minutes: outcome.durationMinutes ?? null,
    outcome_filled_at: outcome.filledAt || new Date().toISOString(),
  };

  const { error } = await supabase
    .from('signal_patterns')
    .update(update)
    .eq('signal_id', signalId);

  if (error) {
    console.error('[pattern-learner] recordOutcome failed:', error.message);
    throw error;
  }

  await supabase.from('learning_feedback_log').insert({
    event_type: 'outcome_recorded',
    signal_id: signalId,
    details: update,
  });

  console.log(`[pattern-learner] outcome recorded for signal ${signalId}: ${outcome.result}`);
}

/**
 * Get pattern statistics for a given strategy or symbol.
 */
export async function getPatternStats(opts = {}) {
  const { strategy, symbol, limit = 100 } = opts;

  let query = supabase
    .from('signal_patterns')
    .select('*')
    .not('outcome', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(limit);

  if (strategy) query = query.eq('strategy', strategy);
  if (symbol) query = query.eq('symbol', symbol);

  const { data, error } = await query;
  if (error) throw error;

  const total = data.length;
  const wins = data.filter(d => d.outcome === 'win').length;
  const losses = data.filter(d => d.outcome === 'loss').length;
  const expired = data.filter(d => d.outcome === 'expired').length;
  const pnlList = data.map(d => Number(d.outcome_pnl || 0));
  const totalPnl = pnlList.reduce((a, b) => a + b, 0);

  return {
    total,
    wins,
    losses,
    expired,
    winRate: total > 0 ? wins / total : 0,
    totalPnl,
    avgPnl: total > 0 ? totalPnl / total : 0,
    avgConfidence: data.length > 0
      ? data.reduce((a, d) => a + Number(d.confidence || 0), 0) / data.length
      : 0,
    bySymbol: groupBy(data, 'symbol'),
    byStrategy: groupBy(data, 'strategy'),
  };
}

function groupBy(arr, key) {
  const groups = {};
  for (const item of arr) {
    const val = item[key] || 'unknown';
    groups[val] = groups[val] || [];
    groups[val].push(item);
  }
  const result = {};
  for (const [k, items] of Object.entries(groups)) {
    const wins = items.filter(i => i.outcome === 'win').length;
    result[k] = {
      count: items.length,
      wins,
      losses: items.filter(i => i.outcome === 'loss').length,
      winRate: items.length > 0 ? wins / items.length : 0,
    };
  }
  return result;
}
