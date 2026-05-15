// ============================================================
// OpenClaw Telegram Bridge — /api/openclaw-telegram
// Connects Telegram users to OpenClaw's analysis capabilities
// with full trading context for intelligent answers.
//
// This endpoint:
// 1. Receives a trading question from Telegram
// 2. Builds comprehensive trading context (market, signals, trades, news, etc.)
// 3. Routes to OpenClaw CLI for deep analysis (if available)
// 4. Falls back to AI provider (Kimi/Claude/Ollama) if OpenClaw is unavailable
// 5. Returns a formatted answer ready for Telegram
//
// Endpoints:
//   POST /api/openclaw-telegram — Ask a trading question
//   GET  /api/openclaw-telegram/health — Check availability
// ============================================================

import { runOpenClaw, checkOpenClaw } from '../lib/openclaw.js';
import { buildTradingContext, formatTradingContext } from '../lib/openclaw-trading-context.js';
import { askAI } from '../lib/ai.js';
import { supabase } from '../lib/supabase.js';

// ── OpenClaw Trading System Prompt ─────────────────────────
// This is the core intelligence prompt that makes OpenClaw
// a smart trading advisor when answering Telegram questions.
const OPENCLAW_TRADING_SYSTEM_PROMPT = `You are OpenClaw — a highly intelligent trading analysis agent integrated into a Telegram bot.

Your role is to answer trading-related questions with deep market insight, data-driven analysis, and clear reasoning.

## YOUR CAPABILITIES

You have access to a comprehensive trading context snapshot that includes:
- Real-time market data (prices, volumes, market cap, BTC/ETH dominance)
- Funding rates across exchanges (identify crowded longs/shorts)
- Liquidation intelligence (best short/long candidates, OI data, alerts)
- Active trading signals (side, entry, SL/TP, confidence, strategy)
- Open trades with current PnL
- Strategy performance metrics (win rates, PnL by strategy)
- Brain signal memory (recent brain decisions with explanations)
- Brain learning reports (insights and suggestions from the learning engine)
- Recent news with sentiment analysis
- Data source health status

## HOW TO ANALYZE

When answering a trading question:

1. **Understand the question** — Is the user asking about:
   - Market direction / price prediction?
   - A specific symbol's setup?
   - Short/long candidates?
   - Strategy performance?
   - Risk assessment?
   - News impact?
   - Liquidation risks?
   - General trading education?

2. **Ground your answer in data** — Reference the actual context data:
   - "BTC is currently at $XX,XXX with X% 24h change"
   - "Funding rates show X is paying Y% annualized — indicating crowded longs"
   - "The best short candidate right now is X with risk score Y"
   - "Strategy X has a Y% win rate over Z trades"

3. **Provide structured analysis**:
   - 🎯 **Direct Answer** — Clear, concise response to their question
   - 📊 **Supporting Data** — Key metrics that back your answer
   - ⚠️ **Risks** — What could go wrong
   - 💡 **Actionable Insight** — What they should watch or consider

4. **Be honest about uncertainty**:
   - If data is stale (>5 min), say so
   - If you don't have enough info, say "I don't have enough data to answer confidently"
   - Never claim guaranteed profits
   - Always include risk disclaimers

## TRADING KNOWLEDGE

You understand these core trading concepts and can explain them:
- Technical Analysis: Support/resistance, trend lines, RSI, MACD, EMA, Bollinger Bands, volume profile
- Market Structure: Market cycles, accumulation, distribution, manipulation patterns
- Liquidation Mechanics: How liquidations cascade, OI analysis, funding rate dynamics
- Risk Management: Position sizing, stop losses, risk/reward ratios, portfolio diversification
- Sentiment Analysis: News impact, social sentiment, fear & greed index
- On-Chain Analysis: Whale movements, exchange flows, stablecoin supply
- Derivatives: Perpetual swaps, futures, funding rates, open interest, leverage

## OUTPUT FORMAT

Keep responses Telegram-friendly:
- Use Markdown formatting (*bold*, _italic_, \`code\`)
- Keep messages under 4000 characters (Telegram limit)
- Use emojis for visual structure
- Break long responses into multiple messages if needed
- End with a clear, actionable takeaway

## SAFETY RULES
- Never recommend trading with money someone can't afford to lose
- Always distinguish between paper trading and live trading
- Flag when data might be stale or unreliable
- Never present speculation as fact
- Include: "This is not financial advice. Trade at your own risk."
`;

/**
 * POST /api/openclaw-telegram — Ask a trading question
 * Body: { question, symbol?, chatId?, userId?, chatHistory? }
 */
async function handleAsk(req, res) {
  try {
    const { question, symbol, chatId, userId, chatHistory = [] } = req.body || {};

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing required field: question' });
    }

    // Step 1: Build comprehensive trading context
    const context = await buildTradingContext({ symbol, question });
    const contextText = formatTradingContext(context);

    // Step 2: Check if OpenClaw CLI is available
    const ocStatus = checkOpenClaw();

    let answer;
    let provider;

    if (ocStatus.available) {
      // Use OpenClaw CLI for analysis
      const openclawPrompt = `${OPENCLAW_TRADING_SYSTEM_PROMPT}\n\nTrading Context:\n${contextText}\n\nUser Question: ${question}\n\nProvide a thorough, data-driven analysis.`;
      const result = runOpenClaw(openclawPrompt, { type: 'analysis', timeout: 60000 });

      if (result.ok) {
        answer = result.output;
        provider = 'openclaw';
      } else {
        // Fallback to AI provider
        console.warn('[openclaw-telegram] OpenClaw failed, falling back to AI:', result.error);
        const aiResult = await askAI({
          question: `${OPENCLAW_TRADING_SYSTEM_PROMPT}\n\nTrading Context:\n${contextText}\n\nUser Question: ${question}`,
          chatHistory: [
            { role: 'system', content: OPENCLAW_TRADING_SYSTEM_PROMPT },
            ...chatHistory.slice(-6),
          ],
          maxTokens: 4096,
        });

        if (!aiResult.ok) {
          return res.status(500).json({ ok: false, error: aiResult.error });
        }

        answer = aiResult.answer;
        provider = aiResult.provider;
      }
    } else {
      // OpenClaw not available — use AI provider directly
      console.log('[openclaw-telegram] OpenClaw not available, using AI provider');
      const aiResult = await askAI({
        question: `${OPENCLAW_TRADING_SYSTEM_PROMPT}\n\nTrading Context:\n${contextText}\n\nUser Question: ${question}`,
        chatHistory: [
          { role: 'system', content: OPENCLAW_TRADING_SYSTEM_PROMPT },
          ...chatHistory.slice(-6),
        ],
        maxTokens: 4096,
      });

      if (!aiResult.ok) {
        return res.status(500).json({ ok: false, error: aiResult.error });
      }

      answer = aiResult.answer;
      provider = aiResult.provider;
    }

    // Step 3: Log the interaction for audit
    await logInteraction({
      question,
      answer: answer.slice(0, 500),
      provider,
      symbol: symbol || null,
      chatId: chatId || null,
      userId: userId || null,
    });

    return res.status(200).json({
      ok: true,
      answer,
      provider,
      context: {
        marketSummary: context.summary,
        signalCount: context.signals?.length || 0,
        tradeCount: context.trades?.length || 0,
        newsAvailable: context.news?.hasNews || false,
      },
    });
  } catch (err) {
    console.error('[openclaw-telegram] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * GET /api/openclaw-telegram/health — Check availability
 */
async function handleHealth(req, res) {
  const ocStatus = checkOpenClaw();
  return res.status(200).json({
    ok: true,
    openclaw: ocStatus,
    tradingContext: 'available',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Log interaction to Supabase for audit trail.
 */
async function logInteraction({ question, answer, provider, symbol, chatId, userId }) {
  try {
    await supabase.from('audit_log').insert({
      action: 'openclaw_telegram_query',
      metadata: {
        question: question.slice(0, 500),
        answer_length: answer?.length || 0,
        provider,
        symbol,
        chat_id: chatId,
        user_id: userId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (e) {
    // Non-critical — don't fail the request
    console.warn('[openclaw-telegram] Failed to log interaction:', e.message);
  }
}

// ── Main Handler ───────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pathParts = req.url.split('?')[0].replace(/^\/api\/openclaw-telegram/, '').replace(/\/+$/, '').split('/').filter(Boolean);

  // GET /api/openclaw-telegram/health
  if (req.method === 'GET' && pathParts[0] === 'health') {
    return handleHealth(req, res);
  }

  // GET /api/openclaw-telegram — Info
  if (req.method === 'GET' && pathParts.length === 0) {
    return res.status(200).json({
      ok: true,
      description: 'OpenClaw Telegram Bridge — Smart trading Q&A for Telegram',
      endpoints: {
        'POST /api/openclaw-telegram': 'Ask a trading question (body: { question, symbol?, chatId?, userId?, chatHistory? })',
        'GET /api/openclaw-telegram/health': 'Check availability',
      },
    });
  }

  // POST /api/openclaw-telegram — Ask question
  if (req.method === 'POST') {
    return handleAsk(req, res);
  }

  return res.status(405).json({ ok: false, error: `Method ${req.method} not supported` });
}
