import { assertAdvisorOnly, sanitizeTradingRecommendation } from '../safety/advisorModeGuard.js';
import { buildAdvisorContext } from './marketContext.js';
import { scoreLongShort } from './strategyScorer.js';
import { runAdvisorRiskGate } from './riskGate.js';
import { buildAdvisorReport } from './reportBuilder.js';
import { saveAdvisorRequest, saveAdvisorReport } from './saveAdvisorReport.js';

export async function runAdvisor({
  symbol,
  timeframe = process.env.ADVISOR_DEFAULT_TIMEFRAME || '1h',
  horizon = process.env.ADVISOR_DEFAULT_HORIZON || 'today',
  intent = 'ask',
  user_id = null,
  source = 'api',
  raw_prompt = ''
}) {
  assertAdvisorOnly('runAdvisor');

  if (!symbol) throw new Error('symbol is required');

  const request = await saveAdvisorRequest({
    user_id,
    source,
    symbol: symbol.toUpperCase(),
    timeframe,
    horizon,
    intent,
    raw_prompt,
    status: 'running'
  });

  const context = await buildAdvisorContext({ symbol, timeframe, horizon });
  const score = scoreLongShort(context);
  const risk = runAdvisorRiskGate(context, score);
  const report = sanitizeTradingRecommendation(buildAdvisorReport({ context, score, risk }));
  const saved = await saveAdvisorReport(report, request?.id || null);

  return { request, report: saved?.id ? { ...report, id: saved.id } : report };
}
