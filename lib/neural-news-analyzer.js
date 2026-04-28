// ============================================================
// Neural News Analyzer — Deep Learning Sentiment Classification
// Uses LLM (Kimi/OpenAI/Anthropic) + heuristic fallback.
// Maps news posts to structured market intelligence events.
// ============================================================

import { logger } from './logger.js';

const EVENT_TYPES = [
  'regulation', 'etf', 'hack', 'exchange_issue', 'listing', 'delisting',
  'partnership', 'macro', 'whale', 'liquidation', 'funding', 'lawsuit',
  'protocol_upgrade', 'meme_hype', 'general_market'
];

const BULLISH_WORDS = [
  'approve', 'approval', 'bullish', 'surge', 'rally', 'breakout',
  'partnership', 'launch', 'adoption', 'inflow', 'buy', 'accumulate',
  'record high', 'moon', 'pump', 'green', 'rocket', ' ATH'
];

const BEARISH_WORDS = [
  'hack', 'exploit', 'lawsuit', 'ban', 'crackdown', 'bearish', 'dump',
  'selloff', 'outflow', 'liquidation', 'insolvent', 'halt', 'delist',
  'crash', 'rekt', 'sell', 'short', 'red', 'fud', 'death cross'
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function inferEventType(text) {
  const t = text.toLowerCase();
  if (/(sec|regulat|ban|law|compliance|senate|congress)/.test(t)) return 'regulation';
  if (/(etf|blackrock|fidelity|ark|grayscale)/.test(t)) return 'etf';
  if (/(hack|exploit|drain|stolen|bridge attack)/.test(t)) return 'hack';
  if (/(binance|bybit|okx|coinbase|kraken).*(halt|outage|withdraw|maintenance)/.test(t)) return 'exchange_issue';
  if (/(listing|listed|launchpool|launchpad)/.test(t)) return 'listing';
  if (/(delist|removed trading)/.test(t)) return 'delisting';
  if (/(partner|partnership|integrat|collaborat)/.test(t)) return 'partnership';
  if (/(fed|cpi|ppi|rates|inflation|dxy|treasury|macro)/.test(t)) return 'macro';
  if (/(whale|large transfer|wallet|arkham|on-chain)/.test(t)) return 'whale';
  if (/(liquidation|liquidated|short squeeze|long squeeze)/.test(t)) return 'liquidation';
  if (/(funding rate|open interest|oi)/.test(t)) return 'funding';
  if (/(lawsuit|court|judge|settlement)/.test(t)) return 'lawsuit';
  if (/(upgrade|mainnet|testnet|fork|airdrop)/.test(t)) return 'protocol_upgrade';
  if (/(meme|doge|pepe|shib|viral|memecoin)/.test(t)) return 'meme_hype';
  return 'general_market';
}

function heuristicAnalyze(post) {
  const text = `${post.raw_text || ''}`.toLowerCase();
  let score = 0;
  for (const w of BULLISH_WORDS) if (text.includes(w)) score += 0.15;
  for (const w of BEARISH_WORDS) if (text.includes(w)) score -= 0.15;

  const eventType = inferEventType(text);
  const breaking = /\b(breaking|urgent|just in|developing|alert)\b/.test(text);
  const criticalEvent = ['hack', 'exchange_issue', 'regulation', 'etf', 'lawsuit'].includes(eventType);

  const sentimentScore = clamp(score, -1, 1);
  const abs = Math.abs(sentimentScore);
  const confidence = clamp(0.52 + abs * 0.22 + (criticalEvent ? 0.12 : 0), 0.35, 0.92);
  const impact = criticalEvent || breaking ? 'high' : abs > 0.35 ? 'medium' : 'low';

  let suggestedBias = 'neutral';
  if (sentimentScore > 0.12) suggestedBias = 'bullish';
  if (sentimentScore < -0.12) suggestedBias = 'bearish';

  return {
    symbol: post.symbol || (post.symbols && post.symbols[0]) || null,
    symbols: post.symbols || [],
    event_type: eventType,
    sentiment_score: Number(sentimentScore.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    impact_level: impact,
    urgency: breaking ? 'breaking' : criticalEvent ? 'fast' : 'normal',
    summary: (post.raw_text || '').slice(0, 280),
    suggested_bias: suggestedBias,
    time_decay_minutes: impact === 'high' ? 240 : impact === 'medium' ? 180 : 90,
    source_quality: post.metadata?.source_quality ?? 0.5,
    model_provider: 'heuristic',
    model_name: 'heuristic-v2',
    features: {
      heuristic: true,
      text_length: (post.raw_text || '').length,
      bullish_words: BULLISH_WORDS.filter(w => text.includes(w)).length,
      bearish_words: BEARISH_WORDS.filter(w => text.includes(w)).length
    }
  };
}

function safeJsonFromText(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Model did not return JSON');
  return JSON.parse(match[0]);
}

async function callOpenAICompatible({ apiKey, baseUrl = 'https://api.openai.com/v1', model, post }) {
  const prompt = `
You are a crypto market news intelligence model.
Analyze this post and return STRICT JSON only. No markdown, no explanation.

Post:
${post.raw_text}

Symbols mentioned: ${(post.symbols || []).join(', ') || 'unknown'}

JSON schema:
{
  "symbol": "BTCUSDT or null",
  "symbols": ["BTCUSDT"],
  "event_type": "one of: ${EVENT_TYPES.join(', ')}",
  "sentiment_score": -1.0,
  "confidence": 0.0,
  "impact_level": "low|medium|high|critical",
  "urgency": "normal|fast|breaking",
  "summary": "short market-relevant summary max 160 chars",
  "suggested_bias": "bullish|bearish|neutral|mixed",
  "time_decay_minutes": 180,
  "source_quality": 0.5,
  "features": {"reason":"why this matters"}
}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 600,
      messages: [
        { role: 'system', content: 'Return only valid JSON. No markdown.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`NLP API HTTP ${response.status}: ${txt}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return safeJsonFromText(content);
}

async function callAnthropic({ apiKey, model, post }) {
  const prompt = `Analyze crypto market post and return strict JSON only with:
symbol, symbols, event_type, sentiment_score, confidence, impact_level, urgency, summary, suggested_bias, time_decay_minutes, source_quality, features.

Post: ${post.raw_text}
Known symbols: ${(post.symbols || []).join(', ') || 'unknown'}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Anthropic HTTP ${response.status}: ${txt}`);
  }
  const data = await response.json();
  const content = data.content?.map(c => c.text || '').join('\n') || '';
  return safeJsonFromText(content);
}

function normalizeAnalysis(raw, post, provider, model) {
  const symbols = Array.isArray(raw.symbols) && raw.symbols.length
    ? raw.symbols
    : (post.symbols || []);
  const symbol = raw.symbol || post.symbol || symbols[0] || null;
  const sentiment = clamp(Number(raw.sentiment_score ?? 0), -1, 1);
  const confidence = clamp(Number(raw.confidence ?? 0.5), 0, 1);

  return {
    symbol,
    symbols,
    event_type: EVENT_TYPES.includes(raw.event_type)
      ? raw.event_type
      : inferEventType(post.raw_text || ''),
    sentiment_score: Number(sentiment.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    impact_level: ['low', 'medium', 'high', 'critical'].includes(raw.impact_level)
      ? raw.impact_level
      : 'medium',
    urgency: ['normal', 'fast', 'breaking'].includes(raw.urgency)
      ? raw.urgency
      : 'normal',
    summary: String(raw.summary || post.raw_text || '').slice(0, 500),
    suggested_bias: ['bullish', 'bearish', 'neutral', 'mixed'].includes(raw.suggested_bias)
      ? raw.suggested_bias
      : 'neutral',
    time_decay_minutes: Number(raw.time_decay_minutes || 180),
    source_quality: clamp(
      Number(raw.source_quality ?? post.metadata?.source_quality ?? 0.5),
      0, 1
    ),
    model_provider: provider,
    model_name: model,
    features: raw.features || {}
  };
}

export async function analyzePostWithNeuralModel(post) {
  const provider = (process.env.NEURAL_NLP_PROVIDER || 'heuristic').toLowerCase();

  logger.info(`[NEURAL-ANALYZER] Analyzing post from ${post.source} with provider=${provider}`);

  try {
    if (provider === 'openai' && process.env.OPENAI_API_KEY) {
      const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
      const raw = await callOpenAICompatible({
        apiKey: process.env.OPENAI_API_KEY, model, post
      });
      return normalizeAnalysis(raw, post, provider, model);
    }

    if (provider === 'kimi' && process.env.KIMI_API_KEY) {
      const model = process.env.KIMI_MODEL || 'kimi-k2-6';
      const raw = await callOpenAICompatible({
        apiKey: process.env.KIMI_API_KEY,
        baseUrl: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
        model,
        post
      });
      return normalizeAnalysis(raw, post, provider, model);
    }

    if (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
      const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
      const raw = await callAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY, model, post });
      return normalizeAnalysis(raw, post, provider, model);
    }
  } catch (error) {
    logger.warn(`[NEURAL-ANALYZER] Provider ${provider} failed, falling back to heuristic: ${error.message}`);
  }

  return heuristicAnalyze(post);
}
