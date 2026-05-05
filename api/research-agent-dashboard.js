// ============================================================
// Research Agent Dashboard API
// Returns research sources, strategy proposals, backtest results,
// and lifecycle status for the research agent tab.
// Now reads from Supabase (with SQLite fallback).
// ============================================================

import {
  getRecentResearchSources,
  getUntestedProposals,
  getRecentBacktests,
  getRecentLifecycle,
  getPromotedStrategies,
} from '../lib/ml/supabase-db.js';

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

  try {
    // Recent research sources (regardless of used status)
    const recentSources = await getRecentResearchSources(20);

    // Strategy proposals
    const proposals = await getUntestedProposals(30);

    // Recent backtest results
    const backtests = await getRecentBacktests(20);

    // Strategy lifecycle status
    const lifecycle = await getRecentLifecycle(20);

    // Promoted strategies from feedback loop
    const promoted = await getPromotedStrategies(10);

    // ML model info (with error boundary)
    let model = null;
    try {
      const { loadActiveModel } = await import('../lib/ml/model.js');
      model = loadActiveModel();
    } catch (e) {
      console.warn('[research-agent-dashboard] Model load failed:', e.message);
    }

    // Built-in strategy rankings (with error boundary)
    let ranked = [];
    try {
      const { rankAllStrategies } = await import('../lib/ml/strategyEvaluator.js');
      ranked = rankAllStrategies();
    } catch (e) {
      console.warn('[research-agent-dashboard] Strategy ranking failed:', e.message);
    }

    // Source configs (with error boundary)
    let sourceConfigs = [];
    try {
      const { getAllSourceConfigs } = await import('../lib/ml/enhancedSourceCrawler.js');
      sourceConfigs = getAllSourceConfigs();
    } catch (e) {
      console.warn('[research-agent-dashboard] Source configs failed:', e.message);
    }

    // Parse enhanced metadata if available
    const enhancedSources = recentSources.map(s => {
      const hintsRaw = s.extracted_hints_json || s.extracted_hints || '[]';
      const metadata = hintsRaw ?
        (typeof hintsRaw === 'string' && hintsRaw.startsWith('{') ? JSON.parse(hintsRaw) : { hints: Array.isArray(hintsRaw) ? hintsRaw : JSON.parse(hintsRaw) }) :
        {};
      
      return {
        id: s.id,
        createdAt: s.created_at,
        sourceName: s.source_name,
        sourceUrl: s.source_url,
        contentPreview: s.content?.slice(0, 200),
        hints: metadata.hints || (Array.isArray(metadata) ? metadata : []),
        used: !!s.used,
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
        rules: typeof p.rules_json === 'string' ? JSON.parse(p.rules_json || '[]') : (p.rules_json || []),
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
      sourceConfigs,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[research-agent-dashboard] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
