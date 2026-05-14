// ============================================================
// Model Router — Routes brain decision explanations to the
// appropriate AI model provider.
// Wired to: existing AI providers (Kimi, Claude, etc.)
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load a prompt template from the prompts/ directory.
 */
function loadPrompt(name) {
  const promptPath = path.join(__dirname, '..', '..', 'prompts', name);
  try {
    return fs.readFileSync(promptPath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Explain a brain decision using the configured AI provider.
 * Falls back to a local explanation if no AI provider is available.
 */
export async function explainDecision({ context, strategy, risk }) {
  const provider = (process.env.BRAIN_AI_PROVIDER || 'local').toLowerCase();

  // Try configured AI provider
  if (provider === 'kimi') {
    return explainViaKimi({ context, strategy, risk });
  }
  if (provider === 'claude' || provider === 'anthropic') {
    return explainViaClaude({ context, strategy, risk });
  }
  if (provider === 'openai') {
    return explainViaOpenAI({ context, strategy, risk });
  }

  // Default: local explanation
  return explainLocal({ context, strategy, risk });
}

/**
 * Local explanation generator — no external API needed.
 */
function explainLocal({ context, strategy, risk }) {
  const side = strategy?.side || 'NEUTRAL';
  const confidence = strategy?.composite ?? 0;
  const breakdown = strategy?.breakdown || {};
  const verdict = risk?.verdict || 'UNKNOWN';

  const parts = [];
  parts.push(`Signal: ${side} with ${(confidence * 100).toFixed(0)}% confidence`);
  parts.push(`EMA: ${((breakdown.ema ?? 0.5) * 100).toFixed(0)}% | RSI: ${((breakdown.rsi ?? 0.5) * 100).toFixed(0)}% | Volume: ${((breakdown.volume ?? 0.5) * 100).toFixed(0)}%`);
  parts.push(`Liquidation bias: ${((breakdown.liquidation ?? 0) * 100).toFixed(0)}% | News sentiment: ${((breakdown.news ?? 0) * 100).toFixed(0)}%`);
  parts.push(`Risk verdict: ${verdict}`);

  return {
    provider: 'local',
    explanation: parts.join(' | '),
    summary: `${side} signal at ${(confidence * 100).toFixed(0)}% confidence — ${verdict}`
  };
}

/**
 * Explain via Kimi AI (Moonshot).
 */
async function explainViaKimi({ context, strategy, risk }) {
  const apiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  if (!apiKey) return explainLocal({ context, strategy, risk });

  const prompt = loadPrompt('signal-reviewer.md');
  try {
    const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'moonshot-v1-8k',
        messages: [
          { role: 'system', content: prompt || 'You are a trading signal analyst.' },
          { role: 'user', content: JSON.stringify({ context, strategy, risk }) }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });
    const data = await response.json();
    const explanation = data?.choices?.[0]?.message?.content || 'No explanation from Kimi';
    return { provider: 'kimi', explanation, summary: explanation.split('\n')[0] };
  } catch (err) {
    console.error('[model-router] Kimi error:', err.message);
    return explainLocal({ context, strategy, risk });
  }
}

/**
 * Explain via Claude AI (Anthropic).
 */
async function explainViaClaude({ context, strategy, risk }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return explainLocal({ context, strategy, risk });

  const prompt = loadPrompt('signal-reviewer.md');
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        system: prompt || 'You are a trading signal analyst.',
        messages: [{ role: 'user', content: JSON.stringify({ context, strategy, risk }) }]
      })
    });
    const data = await response.json();
    const explanation = data?.content?.[0]?.text || 'No explanation from Claude';
    return { provider: 'claude', explanation, summary: explanation.split('\n')[0] };
  } catch (err) {
    console.error('[model-router] Claude error:', err.message);
    return explainLocal({ context, strategy, risk });
  }
}

/**
 * Explain via OpenAI.
 */
async function explainViaOpenAI({ context, strategy, risk }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return explainLocal({ context, strategy, risk });

  const prompt = loadPrompt('signal-reviewer.md');
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: prompt || 'You are a trading signal analyst.' },
          { role: 'user', content: JSON.stringify({ context, strategy, risk }) }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });
    const data = await response.json();
    const explanation = data?.choices?.[0]?.message?.content || 'No explanation from OpenAI';
    return { provider: 'openai', explanation, summary: explanation.split('\n')[0] };
  } catch (err) {
    console.error('[model-router] OpenAI error:', err.message);
    return explainLocal({ context, strategy, risk });
  }
}
