import { runAdvisor } from '../advisor/runAdvisor.js';

export function parseAdvisorCommand(text = '') {
  const parts = text.trim().split(/\s+/);
  const command = parts[0]?.replace('/', '').toLowerCase();
  const symbol = parts[1]?.toUpperCase();
  const timeframe = parts.find((p) => /^(5m|15m|30m|1h|4h|1d|1w)$/i.test(p)) || '1h';
  const horizon = text.toLowerCase().includes('week') ? 'this_week' : 'today';

  const valid = ['ask', 'strategy', 'risk', 'backtest', 'improve'];
  if (!valid.includes(command)) return null;
  return { command, symbol, timeframe, horizon, raw_prompt: text };
}

export async function handleAdvisorTelegramCommand(ctxLike) {
  const text = ctxLike.message?.text || ctxLike.text || '';
  const parsed = parseAdvisorCommand(text);
  if (!parsed || !parsed.symbol) {
    return ctxLike.reply?.(
      'Usage: /ask BTCUSDT today | /strategy SOLUSDT 4h | /risk ETHUSDT | /backtest PEPEUSDT'
    );
  }

  const { report } = await runAdvisor({
    symbol: parsed.symbol,
    timeframe: parsed.timeframe,
    horizon: parsed.horizon,
    intent: parsed.command,
    user_id: String(ctxLike.from?.id || ''),
    source: 'telegram',
    raw_prompt: parsed.raw_prompt
  });

  return ctxLike.reply?.(formatAdvisorReport(report), { parse_mode: 'Markdown' });
}

export function formatAdvisorReport(r) {
  const reasons = (r.reasons || []).map((x) => `• ${x}`).join('\n') || '• No strong reason yet. Check data wiring.';
  const warnings = (r.warnings || []).map((x) => `⚠️ ${x}`).join('\n') || 'None';

  return [
    `*${r.symbol} AI Consultant*`,
    `Bias: *${String(r.bias).toUpperCase()}*`,
    `Confidence: *${Math.round(Number(r.confidence || 0) * 100)}%*`,
    `Risk: *${Math.round(Number(r.risk_score || 0) * 100)}%*`,
    `Timeframe: *${r.timeframe}* | Horizon: *${r.horizon}*`,
    '',
    '*Reason:*',
    reasons,
    '',
    '*Strategy:*',
    `Entry zone: \`${JSON.stringify(r.entry_zone || {})}\``,
    `Stop loss: \`${r.stop_loss ?? 'n/a'}\``,
    `Take profits: \`${JSON.stringify(r.take_profits || [])}\``,
    `Invalidation: \`${r.invalidation_price ?? 'n/a'}\``,
    '',
    '*Warnings:*',
    warnings,
    '',
    '_Advisor only. Not financial advice. Manual decision required. No automatic trading._'
  ].join('\n');
}
