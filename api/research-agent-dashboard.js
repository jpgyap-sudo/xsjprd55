// ============================================================
// Research Agent Dashboard API
// Returns research sources, strategy proposals, backtest results,
// and lifecycle status for the research agent tab.
// ============================================================

import { db } from '../lib/ml/db.js';
import { initMlDb } from '../lib/ml/db.js';
import { rankAllStrategies } from '../lib/ml/strategyEvaluator.js';
import { loadActiveModel } from '../lib/ml/model.js';
import { getAllSourceConfigs } from '../lib/ml/enhancedSourceCrawler.js';

// Helper to get icon for source
function getSourceIcon(sourceName) {
  const icons = {
    cryptopanic: '📰',
    coingecko_global: '🌍',
    binance_funding: '💰',
    lunarcrush: '📊',
    tradingview_ideas: '📈',
    default: '📄'
  };
  return icons[sourceName] || icons.default;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  initMlDb();

  try {
    // Recent research sources
    const recentSources = db.prepare(`
      SELECT id, created_at, source_name, source_url, content, extracted_hints_json, used
      FROM research_sources
      ORDER BY created_at DESC
      LIMIT 20
    `).all();

    // Strategy proposals
    const proposals = db.prepare(`
      SELECT id, created_at, name, description, rules_json, confidence, tested, promoted, rejected
      FROM strategy_proposals
      ORDER BY created_at DESC
      LIMIT 30
    `).all();

    // Recent backtest results for research strategies
    const backtests = db.prepare(`
      SELECT run_at, strategy_name, symbol, total_return_pct, total_trades, win_rate, sharpe_ratio, max_drawdown_pct, profit_factor
      FROM backtest_results
      WHERE strategy_name LIKE 'research_%'
      ORDER BY run_at DESC
      LIMIT 20
    `).all();

    // Strategy lifecycle status
    const lifecycle = db.prepare(`
      SELECT strategy_name, status, historical_backtest_score, mock_trading_score, approved_for_mock, rejected_reason, created_at, updated_at
      FROM strategy_lifecycle
      ORDER BY updated_at DESC
      LIMIT 20
    `).all();

    // Promoted strategies from feedback loop
    const promoted = db.prepare(`
      SELECT strategy_name, feedback_score, trades, wins, losses, total_pnl_usd, promoted
      FROM mock_strategy_feedback
      WHERE promoted = 1
      ORDER BY feedback_score DESC
      LIMIT 10
    `).all();

    // ML model info
    const model = loadActiveModel();

    // Built-in strategy rankings
    const ranked = rankAllStrategies();

    // Parse enhanced metadata if available
    const enhancedSources = recentSources.map(s => {
      const metadata = s.extracted_hints_json ?
        (s.extracted_hints_json.startsWith('{') ? JSON.parse(s.extracted_hints_json) : { hints: JSON.parse(s.extracted_hints_json) }) :
        {};
      
      return {
        id: s.id,
        createdAt: s.created_at,
        sourceName: s.source_name,
        sourceUrl: s.source_url,
        contentPreview: s.content?.slice(0, 200),
        hints: metadata.hints || (Array.isArray(metadata) ? metadata : []),
        used: !!s.used,
        // Enhanced fields
        displayName: metadata.displayName || s.source_name,
        description: metadata.description || s.content?.slice(0, 500),
        category: metadata.category || 'other',
        relevanceScore: metadata.relevanceScore || 0.5,
        snapshotUrl: metadata.snapshotUrl || null,
        icon: getSourceIcon(s.source_name),
      };
    });

    return res.status(200).json({
      ok: true,
      recentSources: enhancedSources,
      proposals: proposals.map(p => ({
        id: p.id,
        createdAt: p.created_at,
        name: p.name,
        description: p.description,
        rules: JSON.parse(p.rules_json || '[]'),
        confidence: p.confidence,
        tested: !!p.tested,
        promoted: !!p.promoted,
        rejected: !!p.rejected,
      })),
      backtests: backtests.map(b => ({
        runAt: b.run_at,
        strategyName: b.strategy_name,
        symbol: b.symbol,
        totalReturnPct: b.total_return_pct,
        totalTrades: b.total_trades,
        winRate: b.win_rate,
        sharpeRatio: b.sharpe_ratio,
        maxDrawdownPct: b.max_drawdown_pct,
        profitFactor: b.profit_factor,
      })),
      lifecycle: lifecycle.map(l => ({
        strategyName: l.strategy_name,
        status: l.status,
        historicalBacktestScore: l.historical_backtest_score,
        mockTradingScore: l.mock_trading_score,
        approvedForMock: !!l.approved_for_mock,
        rejectedReason: l.rejected_reason,
        createdAt: l.created_at,
        updatedAt: l.updated_at,
      })),
      promotedStrategies: promoted.map(p => ({
        name: p.strategy_name,
        score: p.feedback_score,
        trades: p.trades,
        winRate: p.trades > 0 ? Number((p.wins / p.trades).toFixed(3)) : 0,
        totalPnl: p.total_pnl_usd,
      })),
      rankedStrategies: ranked.slice(0, 10),
      mlModel: model ? {
        name: model.modelName,
        version: model.version,
        metrics: model.metrics,
      } : null,
      sourceConfigs: getAllSourceConfigs(),
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[research-agent-dashboard] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
