// ============================================================
// Research Agent Chat API
// AI-powered chat interface for the research agent.
// Users can ask about strategies, backtests, and get AI analysis.
// ============================================================

import { askAI } from '../lib/ai.js';
import { initMlDb } from '../lib/ml/db.js';
import { db } from '../lib/ml/db.js';
import { getPromotedStrategies } from '../lib/ml/feedbackLoop.js';
import { rankAllStrategies, getTopStrategies } from '../lib/ml/strategyEvaluator.js';
import { getRecentBacktests, getRecentResearchSources, getRecentLifecycle, getResearchAgentCounts } from '../lib/ml/supabase-db.js';
import { logger } from '../lib/logger.js';

// ── In-memory chat history per session ─────────────────────
const chatSessions = new Map();
const MAX_HISTORY = 20;

/**
 * Build a comprehensive context snapshot of the research agent's state.
 */
async function buildResearchContext() {
  initMlDb();
  const context = {
    counts: { research_sources: 0, strategy_proposals: 0, backtest_results: 0, strategy_lifecycle: 0, mock_strategy_feedback: 0 },
    promotedStrategies: [],
    recentBacktests: [],
    recentResearch: [],
    recentLifecycle: [],
    topStrategies: [],
    allRanked: [],
  };

  try {
    context.counts = await getResearchAgentCounts();
  } catch (e) {
    try {
      const tables = ['research_sources', 'strategy_proposals', 'backtest_results', 'strategy_lifecycle', 'mock_strategy_feedback'];
      for (const t of tables) {
        const r = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get();
        context.counts[t] = r.c;
      }
      context.counts.source = 'sqlite';
    } catch (e2) {}
  }

  try {
    context.promotedStrategies = getPromotedStrategies();
  } catch (e) {}

  try {
    context.recentBacktests = (await getRecentBacktests(10)) || [];
  } catch (e) {
    try {
      context.recentBacktests = db.prepare('SELECT * FROM backtest_results ORDER BY run_at DESC LIMIT 10').all();
    } catch (e2) {}
  }

  try {
    context.recentResearch = (await getRecentResearchSources(10)) || [];
  } catch (e) {
    try {
      context.recentResearch = db.prepare('SELECT * FROM research_sources ORDER BY created_at DESC LIMIT 10').all();
    } catch (e2) {}
  }

  try {
    context.recentLifecycle = (await getRecentLifecycle(10)) || [];
  } catch (e) {
    try {
      context.recentLifecycle = db.prepare('SELECT * FROM strategy_lifecycle ORDER BY updated_at DESC LIMIT 10').all();
    } catch (e2) {}
  }

  try {
    context.topStrategies = getTopStrategies(10, ['S', 'A', 'B']);
  } catch (e) {}

  try {
    context.allRanked = rankAllStrategies();
  } catch (e) {}

  return context;
}

/**
 * Format research context into a readable text for the AI prompt.
 */
function formatResearchContext(ctx) {
  const lines = [];

  lines.push('=== RESEARCH AGENT STATE ===');
  lines.push(`Data Source: ${ctx.counts.source || 'unknown'}`);
  lines.push(`Research Sources: ${ctx.counts.research_sources || 0}`);
  lines.push(`Strategy Proposals: ${ctx.counts.strategy_proposals || 0}`);
  lines.push(`Backtest Results: ${ctx.counts.backtest_results || 0}`);
  lines.push(`Lifecycle Entries: ${ctx.counts.strategy_lifecycle || 0}`);
  lines.push(`Mock Feedback Entries: ${ctx.counts.mock_strategy_feedback || 0}`);
  lines.push('');

  if (ctx.promotedStrategies.length > 0) {
    lines.push('--- PROMOTED STRATEGIES ---');
    for (const s of ctx.promotedStrategies) {
      lines.push(`  ${s.name}: score=${s.score}, trades=${s.trades}, winRate=${(s.winRate * 100).toFixed(1)}%, PnL=$${s.totalPnl}`);
    }
    lines.push('');
  }

  if (ctx.topStrategies.length > 0) {
    lines.push('--- TOP RANKED STRATEGIES ---');
    for (const s of ctx.topStrategies) {
      lines.push(`  ${s.name}: tier=${s.tier}, score=${s.compositeScore}, winRate=${(s.winRate * 100).toFixed(1)}%, trades=${s.trades}`);
    }
    lines.push('');
  }

  if (ctx.recentBacktests.length > 0) {
    lines.push('--- RECENT BACKTESTS ---');
    for (const b of ctx.recentBacktests.slice(0, 5)) {
      lines.push(`  ${b.strategy_name} on ${b.symbol}: return=${b.total_return_pct?.toFixed(2)}%, trades=${b.total_trades}, WR=${(b.win_rate * 100).toFixed(1)}%, Sharpe=${b.sharpe_ratio?.toFixed(2)}`);
    }
    lines.push('');
  }

  if (ctx.recentLifecycle.length > 0) {
    lines.push('--- STRATEGY LIFECYCLE ---');
    for (const l of ctx.recentLifecycle.slice(0, 5)) {
      lines.push(`  ${l.strategy_name}: status=${l.status}, backtestScore=${l.historical_backtest_score}, mockScore=${l.mock_trading_score}, approved=${l.approved_for_mock}`);
    }
    lines.push('');
  }

  if (ctx.recentResearch.length > 0) {
    lines.push('--- RECENT RESEARCH SOURCES ---');
    for (const r of ctx.recentResearch.slice(0, 5)) {
      const contentPreview = (r.content || '').slice(0, 120);
      lines.push(`  [${r.source_name}] ${contentPreview}...`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── System prompt for the research agent chat ──────────────
const RESEARCH_CHAT_SYSTEM_PROMPT = `You are the Research Agent Chat — an AI assistant specialized in explaining and discussing the trading strategies discovered by the automated research agent.

Your role:
1. Explain what strategies the research agent has found, backtested, and promoted
2. Analyze strategy performance metrics (win rate, Sharpe ratio, profit factor, drawdown)
3. Compare different strategies and explain which ones are performing better
4. Suggest improvements or combinations of strategies
5. Answer questions about the research pipeline (crawling, extraction, backtesting, promotion)
6. Provide trading insights based on the research agent's findings

Rules:
- Base your answers on the actual research context data provided below
- If you don't have enough data to answer confidently, say so
- Never claim guaranteed profits — trading always carries risk
- Explain technical metrics in simple terms when asked
- Be specific about strategy names, metrics, and performance
- When discussing backtest results, mention which symbol and timeframe was used
- Distinguish between backtest results (historical simulation) and live trading performance

The current research context is provided below. Use it to answer the user's questions accurately.`;

/**
 * GET /api/research-agent-chat — Get research context summary
 * POST /api/research-agent-chat — Chat with the research agent
 * POST /api/research-agent-chat?reset=true — Reset chat history
 */
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET — return research context summary
  if (req.method === 'GET') {
    try {
      const ctx = await buildResearchContext();
      return res.status(200).json({
        ok: true,
        counts: ctx.counts,
        promotedStrategies: ctx.promotedStrategies,
        topStrategies: ctx.topStrategies,
        recentBacktests: ctx.recentBacktests.slice(0, 5),
        recentLifecycle: ctx.recentLifecycle.slice(0, 5),
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // POST — chat with the research agent
  if (req.method === 'POST') {
    const { question, sessionId = 'default' } = req.body || {};
    const reset = req.query.reset === 'true';

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing question' });
    }

    // Reset session if requested
    if (reset) {
      chatSessions.delete(sessionId);
    }

    // Initialize session
    if (!chatSessions.has(sessionId)) {
      chatSessions.set(sessionId, []);
    }
    const history = chatSessions.get(sessionId);

    try {
      // Build fresh research context
      const ctx = await buildResearchContext();
      const contextText = formatResearchContext(ctx);

      // Build the AI prompt
      const userPrompt = `Research Context:\n${contextText}\n\nUser Question: ${question}`;

      // Use the existing askAI infrastructure with a custom system prompt
      const aiResult = await askAI({
        question: userPrompt,
        chatHistory: history.slice(-6).map(h => ({
          role: h.role,
          content: h.content,
        })),
        maxTokens: 4096,
      });

      if (!aiResult.ok) {
        // Fallback: use generateAIResponse directly
        const { generateAIResponse } = await import('../lib/ai.js');
        try {
          const fallbackResult = await generateAIResponse(RESEARCH_CHAT_SYSTEM_PROMPT, userPrompt);
          const answer = fallbackResult.content;

          // Update history
          history.push({ role: 'user', content: question });
          history.push({ role: 'assistant', content: answer });
          if (history.length > MAX_HISTORY) {
            chatSessions.set(sessionId, history.slice(-MAX_HISTORY));
          }

          return res.status(200).json({
            ok: true,
            answer,
            provider: fallbackResult.provider,
            model: fallbackResult.model,
            context: {
              promotedCount: ctx.promotedStrategies.length,
              backtestCount: ctx.recentBacktests.length,
              totalProposals: ctx.counts.strategy_proposals,
            },
          });
        } catch (fallbackErr) {
          return res.status(500).json({ ok: false, error: `AI unavailable: ${fallbackErr.message}` });
        }
      }

      const answer = aiResult.answer;

      // Update chat history
      history.push({ role: 'user', content: question });
      history.push({ role: 'assistant', content: answer });
      if (history.length > MAX_HISTORY) {
        chatSessions.set(sessionId, history.slice(-MAX_HISTORY));
      }

      return res.status(200).json({
        ok: true,
        answer,
        provider: aiResult.provider,
        model: aiResult.model,
        usage: aiResult.usage,
        context: {
          promotedCount: ctx.promotedStrategies.length,
          backtestCount: ctx.recentBacktests.length,
          totalProposals: ctx.counts.strategy_proposals,
        },
      });
    } catch (e) {
      logger.error(`[RESEARCH-CHAT] ${e.message}`);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
