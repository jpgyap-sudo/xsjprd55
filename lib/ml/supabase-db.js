// ============================================================
// Research Agent Supabase Database Adapter
// Replaces SQLite with Supabase for shared VPS/dashboard storage.
// Falls back to SQLite if Supabase is unavailable.
// ============================================================

import { supabase } from '../supabase.js';
import { db as sqliteDb } from './db.js';
import { logger } from '../logger.js';

const USE_SUPABASE = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// ── Helper: run Supabase query with fallback ──────────────
async function supaQuery(table, operation, args) {
  if (!USE_SUPABASE) return { error: new Error('Supabase not configured'), data: null };
  try {
    let q = supabase.from(table);
    if (operation === 'select') {
      q = q.select(args.columns || '*');
      if (args.order) q = q.order(args.order.column, { ascending: args.order.ascending ?? false });
      if (args.limit) q = q.limit(args.limit);
      if (args.eq) {
        for (const [k, v] of Object.entries(args.eq)) q = q.eq(k, v);
      }
      const { data, error } = await q;
      return { data, error };
    }
    if (operation === 'insert') {
      const { data, error } = await q.insert(args.rows).select();
      return { data, error };
    }
    if (operation === 'upsert') {
      const { data, error } = await q.upsert(args.rows).select();
      return { data, error };
    }
    if (operation === 'update') {
      let u = q.update(args.values);
      if (args.eq) {
        for (const [k, v] of Object.entries(args.eq)) u = u.eq(k, v);
      }
      const { data, error } = await u;
      return { data, error };
    }
    return { error: new Error('Unknown operation: ' + operation), data: null };
  } catch (e) {
    return { error: e, data: null };
  }
}

function isMissingTableError(error) {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('relation') || msg.includes('42p01');
}

// ── Research Sources ──────────────────────────────────────
export async function storeResearchSource(item) {
  const row = {
    source_name: item.sourceName,
    source_url: item.sourceUrl || null,
    content: item.content,
    extracted_hints_json: JSON.stringify(item.hints || []),
    used: false,
  };

  if (USE_SUPABASE) {
    const { error } = await supaQuery('research_sources', 'insert', { rows: [row] });
    if (error) logger.warn('[SUPA-DB] storeResearchSource error:', error.message);
    else return;
  }

  // Fallback SQLite
  sqliteDb.prepare(`
    INSERT INTO research_sources (created_at, source_name, source_url, content, extracted_hints_json, used)
    VALUES (datetime('now'), ?, ?, ?, ?, 0)
  `).run(row.source_name, row.source_url, row.content, row.extracted_hints_json);
}

export async function getUnusedResearchSources(limit = 50) {
  if (USE_SUPABASE) {
    const { data, error } = await supaQuery('research_sources', 'select', {
      eq: { used: false },
      order: { column: 'created_at', ascending: false },
      limit,
    });
    if (!error && data) return data;
    logger.warn('[SUPA-DB] getUnusedResearchSources error:', error?.message);
  }

  return sqliteDb.prepare(`
    SELECT * FROM research_sources WHERE used = 0 ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

export async function getRecentResearchSources(limit = 20) {
  if (USE_SUPABASE) {
    const { data, error } = await supaQuery('research_sources', 'select', {
      order: { column: 'created_at', ascending: false },
      limit,
    });
    if (!error && data) return data;
    if (!isMissingTableError(error)) {
      logger.warn('[SUPA-DB] getRecentResearchSources error:', error?.message);
    }
  }

  return sqliteDb.prepare(`
    SELECT * FROM research_sources ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

export async function markResearchSourceUsed(id) {
  if (USE_SUPABASE) {
    const { error } = await supaQuery('research_sources', 'update', {
      values: { used: true },
      eq: { id },
    });
    if (!error) return;
    logger.warn('[SUPA-DB] markResearchSourceUsed error:', error.message);
  }

  sqliteDb.prepare(`UPDATE research_sources SET used = 1 WHERE id = ?`).run(id);
}

// ── Strategy Proposals ────────────────────────────────────
export async function saveStrategyProposal(proposal) {
  const row = {
    name: proposal.name,
    description: proposal.description,
    rules_json: JSON.stringify(proposal.rules || []),
    confidence: proposal.confidence || 0.5,
    tested: false,
    promoted: false,
    rejected: false,
  };

  if (USE_SUPABASE) {
    const { error } = await supaQuery('strategy_proposals', 'insert', { rows: [row] });
    if (!error) return;
    logger.warn('[SUPA-DB] saveStrategyProposal error:', error.message);
  }

  sqliteDb.prepare(`
    INSERT INTO strategy_proposals (created_at, name, description, rules_json, confidence, tested, promoted, rejected)
    VALUES (datetime('now'), ?, ?, ?, ?, 0, 0, 0)
  `).run(row.name, row.description, row.rules_json, row.confidence);
}

export async function getUntestedProposals(limit = 50) {
  if (USE_SUPABASE) {
    const { data, error } = await supaQuery('strategy_proposals', 'select', {
      eq: { tested: false },
      order: { column: 'created_at', ascending: false },
      limit,
    });
    if (!error && data) return data;
    if (!isMissingTableError(error)) {
      logger.warn('[SUPA-DB] getUntestedProposals error:', error?.message);
    }
  }

  return sqliteDb.prepare(`
    SELECT * FROM strategy_proposals WHERE tested = 0 ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

export async function markProposalTested(id) {
  if (USE_SUPABASE) {
    const { error } = await supaQuery('strategy_proposals', 'update', {
      values: { tested: true },
      eq: { id },
    });
    if (!error) return;
    logger.warn('[SUPA-DB] markProposalTested error:', error.message);
  }

  sqliteDb.prepare(`UPDATE strategy_proposals SET tested = 1 WHERE id = ?`).run(id);
}

export async function markProposalPromoted(name) {
  if (USE_SUPABASE) {
    const { error } = await supaQuery('strategy_proposals', 'update', {
      values: { promoted: true },
      eq: { name },
    });
    if (!error) return;
    logger.warn('[SUPA-DB] markProposalPromoted error:', error.message);
  }

  sqliteDb.prepare(`UPDATE strategy_proposals SET promoted = 1 WHERE name = ?`).run(name);
}

export async function markProposalRejected(name) {
  if (USE_SUPABASE) {
    const { error } = await supaQuery('strategy_proposals', 'update', {
      values: { rejected: true },
      eq: { name },
    });
    if (!error) return;
    logger.warn('[SUPA-DB] markProposalRejected error:', error.message);
  }

  sqliteDb.prepare(`UPDATE strategy_proposals SET rejected = 1 WHERE name = ?`).run(name);
}

// ── Backtest Results ──────────────────────────────────────
export async function saveBacktestResult(result) {
  const row = {
    run_at: new Date().toISOString(),
    strategy_name: result.strategyName,
    symbol: result.symbol || 'BTCUSDT',
    total_return_pct: result.totalReturnPct || 0,
    total_trades: result.totalTrades || 0,
    win_rate: result.winRate || 0,
    sharpe_ratio: result.sharpeRatio || 0,
    max_drawdown_pct: result.maxDrawdownPct || 0,
    profit_factor: result.profitFactor || 0,
    trade_log_json: JSON.stringify(result.tradeLog || []),
  };

  if (USE_SUPABASE) {
    const { error } = await supaQuery('backtest_results', 'insert', { rows: [row] });
    if (!error) return;
    logger.warn('[SUPA-DB] saveBacktestResult error:', error.message);
  }

  sqliteDb.prepare(`
    INSERT INTO backtest_results (run_at, strategy_name, symbol, total_return_pct, total_trades, win_rate, sharpe_ratio, max_drawdown_pct, profit_factor, trade_log_json)
    VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.strategy_name, row.symbol, row.total_return_pct, row.total_trades, row.win_rate, row.sharpe_ratio, row.max_drawdown_pct, row.profit_factor, row.trade_log_json);
}

export async function getRecentBacktests(limit = 20) {
  if (USE_SUPABASE) {
    const { data, error } = await supaQuery('backtest_results', 'select', {
      order: { column: 'run_at', ascending: false },
      limit,
    });
    if (!error && data) return data;
    if (!isMissingTableError(error)) {
      logger.warn('[SUPA-DB] getRecentBacktests error:', error?.message);
    }
  }

  return sqliteDb.prepare(`
    SELECT * FROM backtest_results ORDER BY run_at DESC LIMIT ?
  `).all(limit);
}

// ── Mock Strategy Feedback ────────────────────────────────
export async function saveMockStrategyFeedback(input) {
  const row = {
    strategy_name: input.strategyName,
    trades: input.trades || 0,
    wins: input.wins || 0,
    losses: input.losses || 0,
    total_pnl_usd: input.totalPnlUsd || 0,
    max_drawdown_pct: input.maxDrawdownPct || 0,
    feedback_score: input.feedbackScore || 0,
    promoted: input.promoted || false,
    updated_at: new Date().toISOString(),
  };

  if (USE_SUPABASE) {
    const { error } = await supaQuery('mock_strategy_feedback', 'upsert', { rows: [row] });
    if (!error) return;
    logger.warn('[SUPA-DB] saveMockStrategyFeedback error:', error.message);
  }

  sqliteDb.prepare(`
    INSERT INTO mock_strategy_feedback
      (strategy_name, trades, wins, losses, total_pnl_usd, max_drawdown_pct, feedback_score, promoted, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(strategy_name) DO UPDATE SET
      trades = ?, wins = ?, losses = ?, total_pnl_usd = ?, max_drawdown_pct = ?, feedback_score = ?,
      promoted = MAX(promoted, ?), updated_at = datetime('now')
  `).run(
    row.strategy_name, row.trades, row.wins, row.losses, row.total_pnl_usd, row.max_drawdown_pct, row.feedback_score, row.promoted ? 1 : 0,
    row.trades, row.wins, row.losses, row.total_pnl_usd, row.max_drawdown_pct, row.feedback_score, row.promoted ? 1 : 0
  );
}

export async function getPromotedStrategies(limit = 10) {
  if (USE_SUPABASE) {
    const { data, error } = await supaQuery('mock_strategy_feedback', 'select', {
      eq: { promoted: true },
      order: { column: 'feedback_score', ascending: false },
      limit,
    });
    if (!error && data) return data;
    if (!isMissingTableError(error)) {
      logger.warn('[SUPA-DB] getPromotedStrategies error:', error?.message);
    }
  }

  return sqliteDb.prepare(`
    SELECT * FROM mock_strategy_feedback WHERE promoted = 1 ORDER BY feedback_score DESC LIMIT ?
  `).all(limit);
}

// ── Strategy Lifecycle ────────────────────────────────────
export async function upsertStrategyLifecycle(lifecycle) {
  const row = {
    proposal_id: lifecycle.proposalId || null,
    strategy_name: lifecycle.strategyName,
    status: lifecycle.status || 'researched',
    historical_backtest_score: lifecycle.historicalBacktestScore || 0,
    mock_trading_score: lifecycle.mockTradingScore || 0,
    approved_for_mock: lifecycle.approvedForMock || false,
    rejected_reason: lifecycle.rejectedReason || null,
    updated_at: new Date().toISOString(),
  };

  if (USE_SUPABASE) {
    const { error } = await supaQuery('strategy_lifecycle', 'upsert', { rows: [row] });
    if (!error) return;
    logger.warn('[SUPA-DB] upsertStrategyLifecycle error:', error.message);
  }

  sqliteDb.prepare(`
    INSERT INTO strategy_lifecycle (proposal_id, strategy_name, status, historical_backtest_score, mock_trading_score, approved_for_mock, rejected_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(strategy_name) DO UPDATE SET
      status = ?, historical_backtest_score = ?, mock_trading_score = ?, approved_for_mock = ?, rejected_reason = ?, updated_at = datetime('now')
  `).run(
    row.proposal_id, row.strategy_name, row.status, row.historical_backtest_score, row.mock_trading_score, row.approved_for_mock ? 1 : 0, row.rejected_reason,
    row.status, row.historical_backtest_score, row.mock_trading_score, row.approved_for_mock ? 1 : 0, row.rejected_reason
  );
}

export async function getRecentLifecycle(limit = 20) {
  if (USE_SUPABASE) {
    const { data, error } = await supaQuery('strategy_lifecycle', 'select', {
      order: { column: 'updated_at', ascending: false },
      limit,
    });
    if (!error && data) return data;
    if (!isMissingTableError(error)) {
      logger.warn('[SUPA-DB] getRecentLifecycle error:', error?.message);
    }
  }

  return sqliteDb.prepare(`
    SELECT * FROM strategy_lifecycle ORDER BY updated_at DESC LIMIT ?
  `).all(limit);
}

// ── Counts for debug ──────────────────────────────────────
export async function getResearchAgentCounts() {
  const counts = {};
  const tables = ['research_sources', 'strategy_proposals', 'backtest_results', 'strategy_lifecycle', 'mock_strategy_feedback'];

  if (USE_SUPABASE) {
    let anySuccess = false;
    for (const t of tables) {
      try {
        const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
        if (error) {
          if (isMissingTableError(error)) {
            counts[t] = 'not_found';
          } else {
            counts[t] = 'error: ' + error.message;
          }
        } else if (count != null) {
          counts[t] = count;
          anySuccess = true;
        } else {
          counts[t] = 'not_found';
        }
      } catch (e) {
        counts[t] = 'error: ' + e.message;
      }
    }
    if (anySuccess) {
      counts.source = 'supabase';
      return counts;
    }
  }

  for (const t of tables) {
    try {
      const r = sqliteDb.prepare(`SELECT COUNT(*) as c FROM ${t}`).get();
      counts[t] = r.c;
    } catch (e) {
      counts[t] = 'error: ' + e.message;
    }
  }
  counts.source = 'sqlite';
  return counts;
}
