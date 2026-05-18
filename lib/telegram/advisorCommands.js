import { runAdvisor } from '../advisor/runAdvisor.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export function parseAdvisorCommand(text = '') {
  const parts = text.trim().split(/\s+/);
  const command = parts[0]?.replace('/', '').toLowerCase();
  const symbol = parts[1]?.toUpperCase();
  const timeframe = parts.find((p) => /^(5m|15m|30m|1h|4h|1d|1w)$/i.test(p)) || '1h';
  const horizon = text.toLowerCase().includes('week') ? 'this_week' : 'today';

  const valid = ['ask', 'strategy', 'risk', 'backtest', 'improve', 'analyze'];
  if (!valid.includes(command)) return null;
  return { command, symbol, timeframe, horizon, raw_prompt: text };
}

export async function handleAdvisorTelegramCommand(ctxLike) {
  const text = ctxLike.message?.text || ctxLike.text || '';
  const parsed = parseAdvisorCommand(text);
  if (!parsed || !parsed.symbol) {
    return ctxLike.reply?.(
      'Usage: /ask BTCUSDT today | /strategy SOLUSDT 4h | /risk ETHUSDT | /backtest PEPEUSDT | /analyze BTCUSDT'
    );
  }

  // Handle /analyze command with Ollama
  if (parsed.command === 'analyze') {
    return handleAnalyzeCommand(ctxLike, parsed);
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

/**
 * Handle the /analyze command — uses Ollama for local LLM-powered analysis.
 * Falls back to the standard advisor if Ollama is unavailable.
 */
async function handleAnalyzeCommand(ctxLike, parsed) {
  const baseUrl = config.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = config.OLLAMA_MODEL || 'phi3:mini';

  // Send "thinking" message
  const thinkingMsg = `🔍 Analyzing *${parsed.symbol}* on *${parsed.timeframe}* timeframe using local AI (${model})...`;
  await ctxLike.reply?.(thinkingMsg, { parse_mode: 'Markdown' });

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a crypto trading analyst. Analyze the given symbol and timeframe. Return ONLY a JSON object:
{
  "bias": "bullish" | "bearish" | "neutral",
  "confidence": <0-1>,
  "key_levels": { "support": [<prices>], "resistance": [<prices>] },
  "reasoning": "<2-3 sentence analysis>",
  "risks": ["<risk1>", "<risk2>"],
  "setup": "<brief trade setup description>"
}
Do NOT include any other text.`
          },
          {
            role: 'user',
            content: `Analyze ${parsed.symbol} on ${parsed.timeframe} timeframe. Current market conditions: ${parsed.horizon === 'this_week' ? 'Weekly outlook' : 'Today\'s trading session'}.`
          }
        ],
        options: { temperature: 0.2, max_tokens: 512 }
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);

    const data = await response.json();
    const content = data.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) throw new Error('No JSON in Ollama response');

    const analysis = JSON.parse(jsonMatch[0]);

    const supportLevels = (analysis.key_levels?.support || []).map(p => `\`${p}\``).join(', ') || 'N/A';
    const resistanceLevels = (analysis.key_levels?.resistance || []).map(p => `\`${p}\``).join(', ') || 'N/A';
    const risks = (analysis.risks || []).map(r => `⚠️ ${r}`).join('\n') || 'None identified';

    const reply = [
      `*🧠 Local AI Analysis: ${parsed.symbol}*`,
      `Model: \`${model}\` | Timeframe: *${parsed.timeframe}*`,
      '',
      `*Bias:* ${String(analysis.bias || 'NEUTRAL').toUpperCase()}`,
      `*Confidence:* ${Math.round(Number(analysis.confidence || 0) * 100)}%`,
      '',
      `*Key Levels:*`,
      `Support: ${supportLevels}`,
      `Resistance: ${resistanceLevels}`,
      '',
      `*Reasoning:*`,
      analysis.reasoning || 'No reasoning provided.',
      '',
      `*Setup:*`,
      analysis.setup || 'No specific setup identified.',
      '',
      `*Risks:*`,
      risks,
      '',
      '_Powered by Ollama (local AI) — not financial advice._'
    ].join('\n');

    return ctxLike.reply?.(reply, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.debug(`[advisorCommands] Ollama /analyze failed: ${err.message}`);

    // Fallback to standard advisor
    const { report } = await runAdvisor({
      symbol: parsed.symbol,
      timeframe: parsed.timeframe,
      horizon: parsed.horizon,
      intent: 'ask',
      user_id: String(ctxLike.from?.id || ''),
      source: 'telegram',
      raw_prompt: parsed.raw_prompt
    });

    const fallbackReply = [
      `⚠️ Ollama unavailable — falling back to standard advisor.`,
      '',
      formatAdvisorReport(report)
    ].join('\n');

    return ctxLike.reply?.(fallbackReply, { parse_mode: 'Markdown' });
  }
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
