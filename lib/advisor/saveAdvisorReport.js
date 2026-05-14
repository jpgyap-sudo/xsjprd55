// ============================================================
// Advisor Report Persistence — Uses shared supabase client
// ============================================================

import { supabase, isSupabaseNoOp } from '../supabase.js';

export async function saveAdvisorRequest(input) {
  if (isSupabaseNoOp()) return { id: null, skipped: true };
  const { data, error } = await supabase.from('advisor_requests').insert(input).select('*').single();
  if (error) throw error;
  return data;
}

export async function saveAdvisorReport(report, requestId = null) {
  if (isSupabaseNoOp()) return { id: null, skipped: true, ...report };
  const payload = {
    request_id: requestId,
    symbol: report.symbol,
    timeframe: report.timeframe,
    horizon: report.horizon,
    bias: report.bias,
    confidence: report.confidence,
    risk_score: report.risk_score,
    invalidation_price: report.invalidation_price,
    entry_zone: report.entry_zone,
    take_profits: report.take_profits,
    stop_loss: report.stop_loss,
    reasons: report.reasons,
    warnings: report.warnings,
    strategy: report.strategy,
    data_snapshot: report.data_snapshot,
    model_used: report.model_used,
    disclaimer: report.disclaimer
  };
  const { data, error } = await supabase.from('advisor_reports').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}
