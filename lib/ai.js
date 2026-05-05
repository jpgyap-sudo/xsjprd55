// ============================================================
// lib/ai.js — Multi-Provider AI Advisor Engine
// Primary: Kimi (Moonshot AI) via OpenAI SDK
// Fallback: Anthropic Claude via @anthropic-ai/sdk
// Used by: /api/ask, /api/telegram, lib/suggestion-engine.js
// ============================================================

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { buildNewsContextForAI } from './news-store.js';
import { config } from './config.js';

// ── SDK Clients ─────────────────────────────────────────────
const kimiClient = new OpenAI({
  apiKey: config.KIMI_API_KEY,
  baseURL: config.KIMI_BASE_URL,
});

const anthropicClient = new Anthropic({
  apiKey: config.ANTHROPIC_API_KEY,
});

const KIMI_SAFE_MAX_TOKENS = 2048;
const MAX_HISTORY_CONTENT_CHARS = 4000;

function clampKimiMaxTokens(maxTokens) {
  return Math.max(256, Math.min(maxTokens, config.KIMI_MAX_TOKENS || KIMI_SAFE_MAX_TOKENS, KIMI_SAFE_MAX_TOKENS));
}

function normalizeChatHistory(chatHistory) {
  if (!Array.isArray(chatHistory)) return [];

  return chatHistory
    .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    .slice(-6)
    .map(h => ({
      role: h.role,
      content: h.content.length > MAX_HISTORY_CONTENT_CHARS
        ? `${h.content.slice(0, MAX_HISTORY_CONTENT_CHARS)}\n...[truncated]`
        : h.content
    }));
}

export function prepareAnthropicRequest({ messages = [], system = '' }) {
  const systemParts = [];
  if (typeof system === 'string' && system.trim()) {
    systemParts.push(system.trim());
  }

  const normalizedMessages = [];
  for (const msg of Array.isArray(messages) ? messages : []) {
    if (!msg || typeof msg.content !== 'string') continue;

    if (msg.role === 'system') {
      if (msg.content.trim()) systemParts.push(msg.content.trim());
      continue;
    }

    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    normalizedMessages.push({ role: msg.role, content: msg.content });
  }

  return {
    system: systemParts.join('\n\n'),
    messages: normalizedMessages
  };
}

// ── System Prompt ───────────────────────────────────────────
const SYSTEM_PROMPT = `You are a crypto market analysis assistant focused on trading, liquidity pools, token research, and liquidation intelligence.

Your job is to help users evaluate:
- spot and swing trading opportunities (LONG or SHORT)
- liquidity pool opportunities on Meteora
- token accumulation opportunities during bear markets
- organic meme coins with strong real communities
- undervalued real projects with long-term upside
- LIQUIDATION CASCADES: identify when crowded leverage is about to get wiped

NEWS CONTEXT RULES (prioritize when recent news is available):
1. When news context is provided, incorporate it into your analysis:
   - Breaking news with high urgency scores should factor heavily into recommendations
   - Bullish news + positive funding/technical alignment = stronger LONG conviction
   - Bearish news + negative funding/technical alignment = stronger SHORT conviction
   - News contradicting price action = signal caution, mention the divergence
2. Rate news credibility: treat established sources (CoinTelegraph, CoinDesk, The Block) as higher credibility
3. Freshness matters: news from last hour is more relevant than news from 6 hours ago

LIQUIDATION INTELLIGENCE RULES (critical when user asks about shorts, squeezes, or leverage):
1. When user asks "what is a good short today" or similar:
   - Recommend the coin with the MOST OVERLEVERAGED LONGS (highest positive funding, highest OI, bullish price but bearish internals).
   - Explain WHY: crowded longs + high funding = good short because those longs will get liquidated on any pullback.
   - Include: symbol, current price, funding rate, OI size, risk score, and confidence.
2. When user asks "what is a good buy today" or "good long":
   - Recommend the coin with the MOST OVERLEVERAGED SHORTS (most negative funding) or strong bounce setup.
   - Explain WHY: crowded shorts = short squeeze fuel.
3. When discussing any trade, always reference:
   - Funding rate (annualized) — extreme positive = short opportunity, extreme negative = long opportunity
   - Open Interest — large OI = more liquidation fuel
   - Price vs funding divergence — if price is up but funding is very positive, the move is driven by leverage and is fragile
4. Risk Score: interpret 0-100 where higher = more overleveraged to the long side (better short). Lower = more overleveraged to short side (better long).

Priority sources: jup.ag, birdeye.so, coinmarketcap.com, meteora.ag, x.com for social mentions

Liquidity pool analysis: evaluate TVL, 24h volume, volume-to-TVL ratio, fees/yield quality, token volatility, impermanent loss risk, concentration risk, holder quality, whether activity appears organic or manipulated.

Detect suspicious/manipulated pools: flag when volume, price action, and social activity look inorganic, unusually high volume with weak community, low-quality token fundamentals, shallow holder base, sudden spikes with no narrative, bot-like engagement, abnormal yield inconsistent with token quality.

Token recommendation categories: safer accumulation candidates, undervalued real projects, higher-risk organic meme tokens, avoid/suspicious tokens.

Output format for each token/pool/signal: summary, bullish case, risks, liquidity quality, social momentum quality, organic vs manipulated, suitable for trading/LP/accumulation/avoid, confidence level (low/medium/high).

When recommending a SHORT, structure your answer as:
- 🎯 Recommended Short: [SYMBOL]
- Price: $X
- Funding: X% annualized (crowded longs)
- OI: $X M (liquidation fuel)
- Risk Score: X/100
- Confidence: low/medium/high
- Reason: explain the setup in 2-3 sentences
- ⚠️ Downside risks: what could invalidate the trade

When recommending a LONG, structure similarly but highlight squeeze potential.

Safety rules: never claim guaranteed profits, never present speculation as fact, clearly separate facts/estimates/opinion, state when data is incomplete, always include downside risks, be cautious with illiquid/new/easily manipulated tokens.`;

// ── Kimi (Moonshot AI) — OpenAI SDK ────────────────────────
async function callKimi({ messages, maxTokens = 4096 }) {
  const apiKey = config.KIMI_API_KEY;
  const model = config.KIMI_MODEL;

  if (!apiKey) {
    return { ok: false, error: 'KIMI_API_KEY not configured' };
  }

  try {
    const response = await kimiClient.chat.completions.create({
      model,
      messages,
      max_tokens: clampKimiMaxTokens(maxTokens),
      temperature: 1.0,
    });

    const choice = response.choices?.[0];
    if (!choice) {
      return { ok: false, error: 'Kimi returned empty response' };
    }

    return {
      ok: true,
      answer: choice.message?.content || '',
      model: response.model || model,
      usage: response.usage || null,
      provider: 'kimi'
    };
  } catch (err) {
    return { ok: false, error: err.message || 'Kimi SDK error' };
  }
}

// ── Anthropic Claude — @anthropic-ai/sdk ───────────────────
async function callAnthropic({ messages, system, maxTokens = 4096 }) {
  const apiKey = config.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };
  }

  try {
    const request = prepareAnthropicRequest({ messages, system });
    const response = await anthropicClient.messages.create({
      model: config.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
      max_tokens: maxTokens,
      system: request.system,
      messages: request.messages,
    });

    return {
      ok: true,
      answer: response.content?.[0]?.text || '',
      model: response.model,
      usage: response.usage,
      provider: 'anthropic'
    };
  } catch (err) {
    return { ok: false, error: err.message || 'Anthropic SDK error' };
  }
}

// ── Market Data Helpers ───────────────────────────────────
async function fetchCoinGecko() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=30&page=1&sparkline=false&price_change_percentage=24h');
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(c => ({
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price: c.current_price,
      change24h: c.price_change_percentage_24h,
      marketCap: c.market_cap,
      volume24h: c.total_volume,
      ath: c.ath,
      ath_change: c.ath_change_percentage
    }));
  } catch (e) {
    return [];
  }
}

async function fetchGlobalData() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/global');
    if (!res.ok) return null;
    const data = await res.json();
    return data.data;
  } catch (e) {
    return null;
  }
}

async function fetchOkxFunding(symbols) {
  try {
    const results = {};
    for (const sym of symbols.slice(0, 10)) {
      const pair = sym.replace('/', '-');
      const res = await fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${pair}-SWAP`);
      if (res.ok) {
        const data = await res.json();
        if (data.data?.[0]) {
          results[sym] = {
            fundingRate: parseFloat(data.data[0].fundingRate),
            nextFundingTime: data.data[0].nextFundingTime
          };
        }
      }
    }
    return results;
  } catch (e) {
    return {};
  }
}

async function fetchLiquidationIntel() {
  try {
    const base = config.APP_URL || `http://localhost:${config.PORT}`;
    const res = await fetch(`${base}/api/liquidation`, { method: 'GET' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

export async function buildMarketContext() {
  const [coins, globalData, funding, liqData] = await Promise.all([
    fetchCoinGecko(),
    fetchGlobalData(),
    fetchOkxFunding(['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','XRP/USDT']),
    fetchLiquidationIntel()
  ]);

  return {
    global: globalData ? {
      totalMarketCap: globalData.total_market_cap?.usd,
      totalVolume: globalData.total_volume?.usd,
      btcDominance: globalData.market_cap_percentage?.btc,
      ethDominance: globalData.market_cap_percentage?.eth,
      fearGreed: globalData.market_cap_change_percentage_24h_usd
    } : null,
    topCoins: coins,
    okxFunding: funding,
    liquidationIntel: liqData ? {
      summary: liqData.summary,
      bestShort: liqData.bestShort,
      bestLong: liqData.bestLong,
      topAlerts: liqData.alerts?.slice(0, 5)
    } : null
  };
}

// ── Main askAI — auto-selects provider with fallback ──────
export async function askAI({ question, chatHistory = [], maxTokens = 4096 }) {
  if (!question || typeof question !== 'string') {
    return { ok: false, error: 'Missing question' };
  }

  const provider = config.AI_PROVIDER || 'kimi';

  const [marketContext, newsContext] = await Promise.all([
    buildMarketContext(),
    buildNewsContextForAI(question, { hours: 6, limit: 15 })
  ]);

  const contextText = `Current market context (CoinGecko + OKX + Liquidation Intel):
${JSON.stringify(marketContext, null, 2)}

${newsContext.hasNews ? `Recent News Context:\n${newsContext.context}\n` : 'No recent news available.\n'}

User question: ${question}`;

  const historyMessages = normalizeChatHistory(chatHistory);

  // Try primary provider first
  if (provider === 'kimi') {
    const kimiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...historyMessages,
      { role: 'user', content: contextText }
    ];

    const kimiResult = await callKimi({ messages: kimiMessages, maxTokens });

    if (kimiResult.ok) {
      return buildResponse(kimiResult, marketContext, newsContext);
    }

    // Fallback to Anthropic if Kimi fails
    console.warn('[AI] Kimi failed, falling back to Anthropic:', kimiResult.error);
    const anthropicResult = await callAnthropic({
      messages: [...historyMessages, { role: 'user', content: contextText }],
      system: SYSTEM_PROMPT,
      maxTokens
    });

    if (anthropicResult.ok) {
      return buildResponse(anthropicResult, marketContext, newsContext);
    }

    return { ok: false, error: `Kimi: ${kimiResult.error}; Anthropic fallback: ${anthropicResult.error}` };
  }

  // Anthropic as primary
  const anthropicResult = await callAnthropic({
    messages: [...historyMessages, { role: 'user', content: contextText }],
    system: SYSTEM_PROMPT,
    maxTokens
  });

  if (anthropicResult.ok) {
    return buildResponse(anthropicResult, marketContext, newsContext);
  }

  return { ok: false, error: anthropicResult.error };
}

function buildResponse(aiResult, marketContext, newsContext) {
  return {
    ok: true,
    answer: aiResult.answer,
    model: aiResult.model,
    provider: aiResult.provider,
    usage: aiResult.usage,
    newsSnapshot: newsContext.hasNews ? {
      newsCount: newsContext.newsCount,
      topHeadlines: newsContext.topHeadlines
    } : null,
    marketSnapshot: {
      btcPrice: marketContext.topCoins.find(c => c.symbol === 'BTC')?.price,
      btcChange: marketContext.topCoins.find(c => c.symbol === 'BTC')?.change24h,
      ethPrice: marketContext.topCoins.find(c => c.symbol === 'ETH')?.price,
      ethChange: marketContext.topCoins.find(c => c.symbol === 'ETH')?.change24h
    },
    liquidationSnapshot: marketContext.liquidationIntel ? {
      bestShortSymbol: marketContext.liquidationIntel.bestShort?.symbol,
      bestLongSymbol: marketContext.liquidationIntel.bestLong?.symbol,
      totalOi: marketContext.liquidationIntel.summary?.totalOpenInterestUsd,
      avgFunding: marketContext.liquidationIntel.summary?.averageFundingAnnualized
    } : null
  };
}

// ── Low-level unified call with fallback ────────────────────
export async function generateAIResponse(systemPrompt, userPrompt, opts = {}) {
  const { maxTokens = 4096 } = opts;
  const preferred = config.AI_PROVIDER || 'kimi';
  const fallback = preferred === 'kimi' ? 'claude' : 'kimi';

  async function tryKimi() {
    const response = await kimiClient.chat.completions.create({
      model: config.KIMI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: clampKimiMaxTokens(maxTokens),
      temperature: 1.0,
    });
    return {
      content: response.choices[0].message.content,
      provider: 'kimi',
      model: config.KIMI_MODEL,
    };
  }

  async function tryClaude() {
    const request = prepareAnthropicRequest({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    const response = await anthropicClient.messages.create({
      model: config.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
      max_tokens: maxTokens,
      system: request.system,
      messages: request.messages,
    });
    return {
      content: response.content[0].text,
      provider: 'claude',
      model: config.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
    };
  }

  try {
    const result = preferred === 'kimi' ? await tryKimi() : await tryClaude();
    return result;
  } catch (primaryErr) {
    console.warn(`[AI] ${preferred} failed, falling back to ${fallback}:`, primaryErr.message);
    try {
      const result = fallback === 'kimi' ? await tryKimi() : await tryClaude();
      return result;
    } catch (fallbackErr) {
      console.error(`[AI] ${fallback} fallback also failed:`, fallbackErr.message);
      throw new Error(`AI providers exhausted. ${preferred}: ${primaryErr.message} | ${fallback}: ${fallbackErr.message}`);
    }
  }
}

// ── Convenience wrappers ────────────────────────────────────
export async function generateSignalAnalysis(marketData, strategy) {
  const system = 'You are a crypto trading signal analyst. Evaluate the provided market data and strategy, then generate a concise signal assessment with confidence, entry, stop loss, and take profit rationale.';
  const user = `Market data: ${JSON.stringify(marketData)}\nStrategy: ${strategy}\nGenerate signal assessment.`;
  return generateAIResponse(system, user);
}

export async function generateImprovementSuggestion(performanceStats) {
  const system = 'You are a trading bot improvement advisor. Review performance stats and suggest one concrete, actionable improvement. Be specific about what to change and expected impact.';
  const user = `Performance stats: ${JSON.stringify(performanceStats)}\nSuggest improvements.`;
  return generateAIResponse(system, user);
}
