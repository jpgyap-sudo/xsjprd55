// ============================================================
// lib/ai.js — Multi-Provider AI Advisor Engine
// Primary: Kimi (Moonshot AI) — OpenAI-compatible API
// Fallback: Anthropic Claude
// Used by: /api/ask, /api/telegram, lib/suggestion-engine.js
// ============================================================

import { buildNewsContextForAI } from './news-store.js';
import { config } from './config.js';

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

// ── Kimi (Moonshot AI) — OpenAI-compatible ─────────────────
async function callKimi({ messages, maxTokens = 4096 }) {
  const apiKey = config.KIMI_API_KEY;
  const baseUrl = config.KIMI_BASE_URL;
  const model = config.KIMI_MODEL;

  if (!apiKey) {
    return { ok: false, error: 'KIMI_API_KEY not configured' };
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: maxTokens
    })
  });

  const data = await res.json();

  if (!res.ok) {
    return { ok: false, error: 'Kimi API error', details: data };
  }

  const choice = data.choices?.[0];
  if (!choice) {
    return { ok: false, error: 'Kimi returned empty response' };
  }

  return {
    ok: true,
    answer: choice.message?.content || '',
    model: data.model || model,
    usage: data.usage || null,
    provider: 'kimi'
  };
}

// ── Anthropic Claude ──────────────────────────────────────
async function callAnthropic({ messages, system, maxTokens = 4096 }) {
  const apiKey = config.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages
    })
  });

  const data = await res.json();

  if (!res.ok) {
    return { ok: false, error: 'Anthropic API error', details: data };
  }

  return {
    ok: true,
    answer: data.content?.[0]?.text || '',
    model: data.model,
    usage: data.usage,
    provider: 'anthropic'
  };
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
    // Prefer explicit APP_URL, fallback to VERCEL_PRODUCTION_URL, then localhost
    const base = config.APP_URL || process.env.VERCEL_PRODUCTION_URL || `http://localhost:${config.PORT}`;
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

  const historyMessages = chatHistory.slice(-6).map(h => ({
    role: h.role,
    content: h.content
  }));

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
