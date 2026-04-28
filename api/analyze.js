// ============================================================
// Analysis API — Full Probability Scoring
// GET /api/analyze?symbol=BTCUSDT
// Returns bias, confidence scores, and recommendation.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { analyzeProbability } from '../lib/probability-score.js';
import { estimateProbableDirection } from '../lib/liquidation-engine.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const symbol = (req.query?.symbol || 'BTCUSDT').toUpperCase();

  try {
    // Fetch latest liquidation heatmap
    const { data: liqRow } = await supabase
      .from('liquidation_heatmaps')
      .select('*')
      .eq('symbol', symbol)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Fetch latest OI snapshot
    const { data: oiRow } = await supabase
      .from('open_interest_snapshots')
      .select('*')
      .eq('symbol', symbol)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Fetch latest market data for technical score
    const { data: marketRow } = await supabase
      .from('market_data')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', '1h')
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    // Build component scores
    const scores = {
      technical: marketRow ? computeTechnicalScore(marketRow) : 50,
      backtest: 55, // Placeholder until backtest engine is wired
      liquidation: liqRow ? (liqRow.confidence_score || 50) : 50,
      oiFunding: oiRow ? computeOiFundingScore(oiRow) : 50,
      newsSocial: 50, // Placeholder until news sentiment is wired
    };

    const dataReliabilityScore = computeDataReliability({ liqRow, oiRow, marketRow });

    const analysis = analyzeProbability({
      scores,
      dataReliabilityScore,
      currentPrice: marketRow?.close || liqRow?.current_price || 0,
      longLiquidations: liqRow?.long_liquidation_levels || [],
      shortLiquidations: liqRow?.short_liquidation_levels || [],
      oiTrend: oiRow ? (oiRow.open_interest > (oiRow.previous_oi || 0) ? 'rising' : 'flat') : 'flat',
      fundingRate: oiRow?.funding_rate || 0,
    });

    // Save analysis result
    await supabase.from('analysis_results').insert({
      symbol,
      bias: analysis.bias,
      raw_confidence: analysis.rawConfidence,
      data_reliability_score: analysis.dataReliabilityScore,
      adjusted_confidence: analysis.adjustedConfidence,
      technical_score: scores.technical,
      backtest_score: scores.backtest,
      liquidation_score: scores.liquidation,
      oi_funding_score: scores.oiFunding,
      news_social_score: scores.newsSocial,
      recommendation: analysis.recommendation,
      risk_warning: analysis.riskWarning,
      explanation: analysis,
    });

    logger.info(`[ANALYZE] ${symbol} bias=${analysis.bias} confidence=${analysis.adjustedConfidence}`);
    return res.status(200).json({
      symbol,
      ...analysis,
      dataReliabilityScore,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`[ANALYZE] ${symbol} error: ${err.message}`);
    return res.status(500).json({ error: err.message, symbol });
  }
}

function computeTechnicalScore(market) {
  if (!market) return 50;
  const change = ((market.close - market.open) / market.open) * 100;
  // Simple momentum score: +change = bullish, -change = bearish
  return Math.min(100, Math.max(0, 50 + change * 5));
}

function computeOiFundingScore(oi) {
  if (!oi) return 50;
  let score = 50;
  if (oi.funding_rate > 0.01) score -= 10; // crowded longs
  if (oi.funding_rate < -0.01) score += 10; // crowded shorts
  return Math.min(100, Math.max(0, score));
}

function computeDataReliability({ liqRow, oiRow, marketRow }) {
  let score = 100;
  if (!liqRow) score -= 20;
  if (!oiRow) score -= 20;
  if (!marketRow) score -= 20;
  if (liqRow?.fallback_used) score -= 10;
  if (oiRow?.fallback_used) score -= 10;
  return Math.max(0, score);
}
