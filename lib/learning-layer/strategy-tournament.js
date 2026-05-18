// ============================================================
// Strategy Tournament (#6) — Head-to-head strategy comparison
//
// Runs within the TLL pipeline to compare strategies against
// each other using paired analysis:
//   - Win rate comparison (head-to-head)
//   - Average PnL comparison
//   - Risk-adjusted score comparison
//   - Regime-specific performance comparison
//
// Produces a tournament ranking that feeds into weight tuning.
// No new worker needed — runs inside existing TLL cycle.
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';

/**
 * Run the strategy tournament — compare all strategies head-to-head.
 * @returns {Promise<Object>} Tournament results
 */
export async function runStrategyTournament() {
  try {
    // 1. Fetch all resolved signals grouped by strategy
    const { data: signals, error } = await supabase
      .from('brain_signal_memory')
      .select('id, strategy, resolved_outcome, resolved_pnl, source, resolved_at')
      .not('resolved_outcome', 'is', null)
      .order('resolved_at', { ascending: false })
      .limit(2000);

    if (error) throw error;
    if (!signals?.length) {
      logger.info('[strategy-tournament] No resolved signals found');
      return { status: 'no_data', matches: [], rankings: [] };
    }

    // 2. Group by strategy
    const strategyGroups = {};
    for (const s of signals) {
      const strat = s.strategy || 'unknown';
      if (!strategyGroups[strat]) strategyGroups[strat] = [];
      strategyGroups[strat].push(s);
    }

    const strategyNames = Object.keys(strategyGroups);
    if (strategyNames.length < 2) {
      logger.info('[strategy-tournament] Need at least 2 strategies to compare');
      return { status: 'insufficient_strategies', matches: [], rankings: [] };
    }

    // 3. Calculate per-strategy stats
    const strategyStats = {};
    for (const [name, sigs] of Object.entries(strategyGroups)) {
      const wins = sigs.filter(s => s.resolved_outcome === 'win').length;
      const losses = sigs.filter(s => s.resolved_outcome === 'loss').length;
      const total = wins + losses;
      const winRate = total > 0 ? wins / total : 0;
      const totalPnl = sigs.reduce((sum, s) => sum + (parseFloat(s.resolved_pnl) || 0), 0);
      const avgPnl = sigs.length > 0 ? totalPnl / sigs.length : 0;
      const pnls = sigs.map(s => parseFloat(s.resolved_pnl) || 0);
      const variance = pnls.length > 1
        ? pnls.reduce((sum, p) => sum + (p - avgPnl) ** 2, 0) / (pnls.length - 1)
        : 0;
      const stdDev = Math.sqrt(variance);

      strategyStats[name] = {
        name,
        signals: sigs.length,
        wins,
        losses,
        winRate,
        totalPnl,
        avgPnl,
        stdDev,
        // Sharpe-like score: avgPnl / stdDev (per-signal risk-adjusted)
        riskAdjustedScore: stdDev > 0 ? avgPnl / stdDev : avgPnl > 0 ? 1 : -1,
      };
    }

    // 4. Run head-to-head matches
    const matches = [];
    for (let i = 0; i < strategyNames.length; i++) {
      for (let j = i + 1; j < strategyNames.length; j++) {
        const a = strategyStats[strategyNames[i]];
        const b = strategyStats[strategyNames[j]];

        // Determine winner by composite score:
        // 40% win rate, 30% avg PnL, 30% risk-adjusted score
        const scoreA = a.winRate * 0.4 + normalizePnl(a.avgPnl, strategyStats) * 0.3 + normalizeRisk(a.riskAdjustedScore) * 0.3;
        const scoreB = b.winRate * 0.4 + normalizePnl(b.avgPnl, strategyStats) * 0.3 + normalizeRisk(b.riskAdjustedScore) * 0.3;

        const winner = scoreA > scoreB ? a.name : b.name;
        const loser = scoreA > scoreB ? b.name : a.name;
        const scoreDiff = Math.abs(scoreA - scoreB);

        matches.push({
          contender1: a.name,
          contender2: b.name,
          score1: Number(scoreA.toFixed(4)),
          score2: Number(scoreB.toFixed(4)),
          winner,
          loser,
          score_diff: Number(scoreDiff.toFixed(4)),
          decisive: scoreDiff > 0.1, // >10% difference = decisive win
          details: {
            [a.name]: {
              win_rate: Number(a.winRate.toFixed(4)),
              avg_pnl: Number(a.avgPnl.toFixed(4)),
              risk_score: Number(a.riskAdjustedScore.toFixed(4)),
              total_signals: a.signals,
            },
            [b.name]: {
              win_rate: Number(b.winRate.toFixed(4)),
              avg_pnl: Number(b.avgPnl.toFixed(4)),
              risk_score: Number(b.riskAdjustedScore.toFixed(4)),
              total_signals: b.signals,
            },
          },
        });
      }
    }

    // 5. Calculate tournament rankings (Elo-style)
    const rankings = calculateRankings(matches, strategyStats);

    // 6. Save tournament results to brain_events for audit
    try {
      const { logBrainEvent } = await import('../brain/brain-telemetry.js');
      await logBrainEvent('strategy_tournament', {
        match_count: matches.length,
        ranked_strategies: rankings.length,
        top_strategy: rankings[0]?.name,
        top_score: rankings[0]?.score,
        generated_at: new Date().toISOString(),
      });
    } catch (_) { /* non-blocking */ }

    logger.info(`[strategy-tournament] ${matches.length} matches, ${rankings.length} strategies ranked`);

    return {
      status: 'completed',
      matches,
      rankings,
      strategyStats: Object.fromEntries(
        Object.entries(strategyStats).map(([k, v]) => [k, {
          ...v,
          winRate: Number(v.winRate.toFixed(4)),
          avgPnl: Number(v.avgPnl.toFixed(4)),
          riskAdjustedScore: Number(v.riskAdjustedScore.toFixed(4)),
        }])
      ),
    };
  } catch (e) {
    logger.error('[strategy-tournament] Error:', e.message);
    return { status: 'error', error: e.message, matches: [], rankings: [] };
  }
}

/**
 * Normalize PnL across all strategies to 0-1 range.
 */
function normalizePnl(pnl, allStats) {
  const allPnls = Object.values(allStats).map(s => s.avgPnl);
  const min = Math.min(...allPnls);
  const max = Math.max(...allPnls);
  if (max === min) return 0.5;
  return (pnl - min) / (max - min);
}

/**
 * Normalize risk-adjusted score to 0-1 range (clamped).
 */
function normalizeRisk(score) {
  // Clamp to [-2, 2] then map to [0, 1]
  const clamped = Math.max(-2, Math.min(2, score));
  return (clamped + 2) / 4;
}

/**
 * Calculate Elo-style rankings from match results.
 * @param {Object[]} matches - Array of match objects
 * @param {Object} strategyStats - Per-strategy stats
 * @returns {Object[]} Ranked strategies
 */
function calculateRankings(matches, strategyStats) {
  const elo = {};
  const K = 32; // Elo K-factor

  // Initialize Elo ratings based on signal count (more signals = higher base)
  for (const [name, stats] of Object.entries(strategyStats)) {
    elo[name] = 1000 + Math.min(200, stats.signals * 2);
  }

  // Process each match
  for (const match of matches) {
    const r1 = elo[match.contender1] || 1000;
    const r2 = elo[match.contender2] || 1000;

    const e1 = 1 / (1 + 10 ** ((r2 - r1) / 400));
    const e2 = 1 / (1 + 10 ** ((r1 - r2) / 400));

    // Actual scores: 1 for winner, 0 for loser
    const s1 = match.winner === match.contender1 ? 1 : 0;
    const s2 = match.winner === match.contender2 ? 1 : 0;

    elo[match.contender1] = r1 + K * (s1 - e1);
    elo[match.contender2] = r2 + K * (s2 - e2);
  }

  // Sort by Elo descending
  return Object.entries(elo)
    .map(([name, score]) => ({
      name,
      elo_score: Math.round(score),
      signals: strategyStats[name]?.signals || 0,
      win_rate: Number((strategyStats[name]?.winRate || 0).toFixed(4)),
      total_pnl: Number((strategyStats[name]?.totalPnl || 0).toFixed(4)),
    }))
    .sort((a, b) => b.elo_score - a.elo_score)
    .map((r, i) => ({ rank: i + 1, ...r }));
}
