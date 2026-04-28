// ============================================================
// Suggestion Engine — Bot generates improvement ideas
// Analyzes patterns, performance gaps, data source coverage, and market trends
// ============================================================

import { supabase } from './supabase.js';
import { getPatternStats } from './pattern-learner.js';
import { askAI } from './ai.js';

const SUGGESTION_AI_ENABLED = process.env.SUGGESTION_AI_ENABLED === 'true';
const MIN_PATTERN_COUNT = Number(process.env.SUGGESTION_MIN_PATTERNS || 20);

/**
 * Main entry: analyze everything and generate suggestions.
 */
export async function generateSuggestions() {
  const suggestions = [];

  // 1. Strategy performance analyzer
  const stratSuggestions = await analyzeStrategyPerformance();
  suggestions.push(...stratSuggestions);

  // 2. Data source gap analyzer
  const gapSuggestions = await analyzeDataSourceGaps();
  suggestions.push(...gapSuggestions);

  // 3. Feature correlation analyzer
  const corrSuggestions = await analyzeFeatureCorrelations();
  suggestions.push(...corrSuggestions);

  // 5. Infrastructure & plan limitation analyzer
  const infraSuggestions = analyzeInfrastructureLimits();
  suggestions.push(...infraSuggestions);

  // 4. AI meta-suggestions (if enabled)
  if (SUGGESTION_AI_ENABLED) {
    const aiSuggestions = await generateAIMetaSuggestions();
    suggestions.push(...aiSuggestions);
  }

  // Persist new suggestions (avoid duplicates by title)
  const inserted = [];
  for (const sug of suggestions) {
    const { data: existing } = await supabase
      .from('app_suggestions')
      .select('id')
      .eq('title', sug.title)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) continue;

    const { data, error } = await supabase
      .from('app_suggestions')
      .insert(sug)
      .select('id')
      .single();

    if (!error && data) {
      inserted.push(data.id);
      await supabase.from('learning_feedback_log').insert({
        event_type: 'suggestion_generated',
        suggestion_id: data.id,
        details: { category: sug.category, title: sug.title },
      });
    }
  }

  console.log(`[suggestion-engine] generated ${inserted.length} new suggestions`);
  return inserted;
}

// ── Analyzer 1: Strategy Performance ────────────────────────
async function analyzeStrategyPerformance() {
  const suggestions = [];

  // Get stats for all strategies
  const { data: perfRows } = await supabase
    .from('strategy_performance')
    .select('*')
    .order('window_end', { ascending: false })
    .limit(50);

  if (!perfRows?.length) return suggestions;

  const byStrategy = {};
  for (const row of perfRows) {
    byStrategy[row.strategy] = byStrategy[row.strategy] || [];
    byStrategy[row.strategy].push(row);
  }

  for (const [strategy, windows] of Object.entries(byStrategy)) {
    const recent = windows.slice(0, 3);
    const avgWinRate = recent.reduce((a, r) => a + Number(r.win_rate || 0), 0) / recent.length;
    const avgPnl = recent.reduce((a, r) => a + Number(r.total_pnl || 0), 0) / recent.length;

    if (avgWinRate < 0.4 && recent.length >= 2) {
      suggestions.push({
        category: 'strategy_tweak',
        title: `${strategy} underperforming — consider parameter tuning`,
        description: `Recent win rate for ${strategy} averaged ${(avgWinRate * 100).toFixed(1)}% over ${recent.length} windows.`,
        rationale: 'Consistently low win rate indicates the strategy may need adjusted thresholds or filters.',
        expected_impact: `Improve win rate from ${(avgWinRate * 100).toFixed(1)}% to target 55%+`,
        implementation_hint: 'Review EMA periods, RSI thresholds, or add volume confirmation filters.',
        evidence: { strategy, avgWinRate, avgPnl, windows: recent.length },
        source_module: 'suggestion-engine.strategy-analyzer',
      });
    }

    if (avgPnl < -10 && recent.length >= 2) {
      suggestions.push({
        category: 'risk_adjustment',
        title: `${strategy} showing negative PnL — tighten risk gates`,
        description: `Total PnL for ${strategy} averaged $${avgPnl.toFixed(2)} across recent windows.`,
        rationale: 'Negative aggregate PnL suggests position sizing or stop-loss levels need adjustment.',
        expected_impact: 'Reduce average loss per signal by 20-30%',
        implementation_hint: 'Tighten stop-loss multiplier or reduce max position size for this strategy.',
        evidence: { strategy, avgPnl, avgWinRate },
        source_module: 'suggestion-engine.risk-analyzer',
      });
    }
  }

  return suggestions;
}

// ── Analyzer 2: Data Source Gaps ────────────────────────────
async function analyzeDataSourceGaps() {
  const suggestions = [];

  const { data: sources } = await supabase
    .from('data_source_registry')
    .select('*');

  if (!sources) return suggestions;

  const hasOnChain = sources.some(s => s.type === 'onchain');
  const hasSocial = sources.some(s => s.type === 'social');
  const hasSentimentAPI = sources.some(s => s.type === 'sentiment' && s.status === 'active');
  const lowReliability = sources.filter(s => s.reliability_score < 0.7 && s.status === 'active');

  if (!hasOnChain) {
    suggestions.push({
      category: 'new_data_source',
      title: 'Add on-chain data source (e.g., Glassnode, Dune)',
      description: 'No on-chain data source is connected. On-chain metrics (exchange flows, whale movements, network activity) strongly correlate with price movements.',
      rationale: 'On-chain data provides early signals before price action reflects them.',
      expected_impact: '+10-15% accuracy for trend-reversal signals',
      implementation_hint: 'Integrate Glassnode API or Dune Analytics queries for exchange inflow/outflow.',
      evidence: { gap: 'onchain', current_sources: sources.length },
      source_module: 'suggestion-engine.gap-analyzer',
    });
  }

  if (!hasSocial) {
    suggestions.push({
      category: 'new_data_source',
      title: 'Add social sentiment source (e.g., LunarCrush, Santiment)',
      description: 'No social sentiment tracker connected. Social volume and sentiment often lead price by hours.',
      rationale: 'Retail sentiment extremes are contrarian indicators at market tops/bottoms.',
      expected_impact: '+5-10% accuracy for timing entries/exits',
      implementation_hint: 'Add LunarCrush API for social volume, bullish/bearish ratio, and influencer activity.',
      evidence: { gap: 'social', current_sources: sources.length },
      source_module: 'suggestion-engine.gap-analyzer',
    });
  }

  for (const src of lowReliability) {
    suggestions.push({
      category: 'correction',
      title: `${src.display_name} reliability degraded (${(src.reliability_score * 100).toFixed(0)}%)`,
      description: `This source has a reliability score of ${(src.reliability_score * 100).toFixed(0)}% with ${src.last_error_message || 'recent errors'}.`,
      rationale: 'Unreliable data sources introduce noise and false signals.',
      expected_impact: 'Improve signal accuracy by removing noisy inputs',
      implementation_hint: `Investigate ${src.name} errors, add retry logic, or find alternative source.`,
      evidence: { source: src.name, reliability: src.reliability_score, errors: src.last_error_message },
      source_module: 'suggestion-engine.health-analyzer',
    });
  }

  return suggestions;
}

// ── Analyzer 3: Feature Correlations ────────────────────────
async function analyzeFeatureCorrelations() {
  const suggestions = [];

  const { data: patterns } = await supabase
    .from('signal_patterns')
    .select('*')
    .not('outcome', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(200);

  if (!patterns || patterns.length < MIN_PATTERN_COUNT) return suggestions;

  // Check if news sentiment is predictive
  const withNews = patterns.filter(p => p.news_sentiment_score !== null);
  if (withNews.length > MIN_PATTERN_COUNT) {
    const newsWins = withNews.filter(p => p.outcome === 'win');
    const strongNews = withNews.filter(p => Math.abs(p.news_sentiment_score) > 0.5);
    const strongNewsWins = strongNews.filter(p => p.outcome === 'win');

    const baselineRate = newsWins.length / withNews.length;
    const strongRate = strongNews.length > 0 ? strongNewsWins.length / strongNews.length : 0;

    if (strongRate > baselineRate + 0.15) {
      suggestions.push({
        category: 'strategy_tweak',
        title: 'Weight news sentiment more heavily in signal scoring',
        description: `Strong news sentiment signals (|score| > 0.5) have ${(strongRate * 100).toFixed(1)}% win rate vs ${(baselineRate * 100).toFixed(1)}% baseline.`,
        rationale: 'News sentiment is a statistically significant predictor of signal success.',
        expected_impact: `Boost win rate from ${(baselineRate * 100).toFixed(1)}% to ${(strongRate * 100).toFixed(1)}%`,
        implementation_hint: 'Add a news sentiment multiplier (1.1x - 1.3x) to confidence when |sentiment| > 0.5.',
        evidence: { baselineRate, strongRate, sampleSize: withNews.length },
        source_module: 'suggestion-engine.correlation-analyzer',
      });
    }
  }

  // Check if liquidation risk is predictive
  const withLiq = patterns.filter(p => p.liq_risk_score !== null);
  if (withLiq.length > MIN_PATTERN_COUNT) {
    const highLiq = withLiq.filter(p => p.liq_risk_score > 70);
    const highLiqWins = highLiq.filter(p => p.outcome === 'win');
    const lowLiq = withLiq.filter(p => p.liq_risk_score < 30);
    const lowLiqWins = lowLiq.filter(p => p.outcome === 'win');

    const highRate = highLiq.length > 0 ? highLiqWins.length / highLiq.length : 0;
    const lowRate = lowLiq.length > 0 ? lowLiqWins.length / lowLiq.length : 0;

    if (highRate > lowRate + 0.15) {
      suggestions.push({
        category: 'strategy_tweak',
        title: 'Favor signals during high liquidation risk periods',
        description: `High liquidation risk (>70) signals win ${(highRate * 100).toFixed(1)}% vs ${(lowRate * 100).toFixed(1)}% for low risk.`,
        rationale: 'High liquidation risk often precedes violent moves that technical signals capture.',
        expected_impact: `Improve win rate by ${((highRate - lowRate) * 100).toFixed(1)} percentage points`,
        implementation_hint: 'Add liquidation risk as a confidence boost factor in signal-engine.js.',
        evidence: { highRate, lowRate, sampleSize: withLiq.length },
        source_module: 'suggestion-engine.correlation-analyzer',
      });
    }
  }

  return suggestions;
}

// ── Analyzer 4: AI Meta-Suggestions ─────────────────────────
async function generateAIMetaSuggestions() {
  const suggestions = [];

  try {
    const stats = await getPatternStats({ limit: 200 });

    const prompt = `You are a senior quant analyst reviewing a crypto trading signal bot.

Here are the bot's recent performance stats:
- Total signals analyzed: ${stats.total}
- Win rate: ${(stats.winRate * 100).toFixed(1)}%
- Total PnL: $${stats.totalPnl?.toFixed(2) || 'N/A'}
- Avg PnL per signal: $${stats.avgPnl?.toFixed(2) || 'N/A'}
- Avg confidence: ${(stats.avgConfidence * 100).toFixed(1)}%

By strategy: ${JSON.stringify(stats.byStrategy)}
By symbol: ${JSON.stringify(stats.bySymbol)}

Suggest 2-3 specific, actionable improvements to boost accuracy. Format each as:
CATEGORY: <one of new_api, new_strategy, strategy_tweak, new_data_source, ui_improvement, risk_adjustment, tool_discovery, correction>
TITLE: <short title>
DESCRIPTION: <1-2 sentences>
RATIONALE: <why this helps>
IMPACT: <expected improvement>
HINT: <rough implementation steps>

Be specific. Suggest actual tools/APIs if relevant.`;

    const aiRes = await askAI({ question: prompt, chatHistory: [] });
    const text = aiRes?.answer || '';

    // Parse AI response into suggestion objects
    const blocks = text.split(/\n(?=CATEGORY:|CATEGORY\s*:)/i).filter(Boolean);
    for (const block of blocks) {
      const category = extractField(block, 'CATEGORY');
      const title = extractField(block, 'TITLE');
      const description = extractField(block, 'DESCRIPTION');
      const rationale = extractField(block, 'RATIONALE');
      const impact = extractField(block, 'IMPACT');
      const hint = extractField(block, 'HINT');

      if (title && description) {
        suggestions.push({
          category: normalizeCategory(category),
          title,
          description,
          rationale: rationale || 'AI-generated recommendation based on performance data.',
          expected_impact: impact || 'Improve overall signal accuracy',
          implementation_hint: hint || 'Review documentation and implement incrementally.',
          evidence: { ai_generated: true, stats_summary: { total: stats.total, winRate: stats.winRate } },
          source_module: 'suggestion-engine.ai-meta',
        });
      }
    }
  } catch (e) {
    console.warn('[suggestion-engine] AI meta-suggestion failed:', e.message);
  }

  return suggestions;
}

// ── Analyzer 5: Infrastructure & Plan Limitations ───────────
function analyzeInfrastructureLimits() {
  const suggestions = [];

  // Vercel Hobby limits
  suggestions.push({
    category: 'tool_discovery',
    title: 'Upgrade Vercel to Pro for faster news ingestion (5 min vs daily cron)',
    description: 'Currently on Vercel Hobby: crons limited to daily, max 12 serverless functions, no edge caching. News ingest runs once/day — RSS feed freshness is degraded.',
    rationale: 'Vercel Pro unlocks cron intervals down to 1 minute, 24+ serverless functions, and better cold-start performance. This directly improves news freshness and signal latency.',
    expected_impact: 'News freshness improves from ~12h avg to <10 min. Signal latency drops from hours to minutes.',
    implementation_hint: 'Upgrade plan in Vercel dashboard ($20/mo). Add more RSS feeds without function limit concerns.',
    evidence: { plan: 'vercel_hobby', daily_cron_limit: true, function_limit: 12, current_functions: 12 },
    source_module: 'suggestion-engine.infra-analyzer',
  });

  // Supabase free tier limits
  suggestions.push({
    category: 'tool_discovery',
    title: 'Upgrade Supabase for larger news_events retention and faster queries',
    description: 'Supabase free tier: 500MB storage, 2GB egress/month. news_events table with 7-day retention could hit limits at scale. Connection pooling limited to 60 concurrent.',
    rationale: 'Larger DB + connection pooling prevents ingest/query bottlenecks during high-volatility news days. Enables longer news history (30d+ vs 7d).',
    expected_impact: 'Eliminate DB size alerts. Enable 30-day news history for better backtesting and pattern detection.',
    implementation_hint: 'Supabase Pro ($25/mo) gives 8GB storage, 250GB egress, 150 connections, pg_cron for auto-cleanup.',
    evidence: { plan: 'supabase_free', storage_limit_mb: 500, connection_limit: 60, current_retention_days: 7 },
    source_module: 'suggestion-engine.infra-analyzer',
  });

  // Data source breadth
  suggestions.push({
    category: 'new_data_source',
    title: 'Add premium news APIs (TheBlock Pro, Messari, Santiment) for higher credibility signals',
    description: 'Current sources: 7 RSS feeds (free tier only). No access to paid Twitter/X firehose, on-chain sentiment, or institutional research. Signal accuracy limited by free data quality.',
    rationale: 'Premium data sources have higher signal-to-noise ratio, earlier scoop detection, and institutional-grade sentiment scoring.',
    expected_impact: 'Improve signal win rate by 5-10% through better early detection and reduced false positives from low-quality news.',
    implementation_hint: 'Start with Messari API ($29/mo) for macro intelligence. Add LunarCrush for social sentiment. Evaluate TheBlock Pro for institutional signals.',
    evidence: { current_sources: 7, free_only: true, missing_premium: ['messari', 'santiment', 'theblock_pro', 'lunarcrush_pro'] },
    source_module: 'suggestion-engine.infra-analyzer',
  });

  // AI model limits
  suggestions.push({
    category: 'new_api',
    title: 'Upgrade AI model or add fine-tuned signal classifier for better entry/exit timing',
    description: 'Currently using Claude Sonnet 4.6 via API. No fine-tuned model on historical win/loss patterns. AI reasoning is generic — not trained on bot-specific edge cases.',
    rationale: 'A fine-tuned classifier trained on bot signal history + outcomes can predict win probability more accurately than general-purpose LLM reasoning.',
    expected_impact: 'Replace 60% of LLM reasoning with a fast classifier. Reduce AI costs by 70% while maintaining or improving accuracy.',
    implementation_hint: 'Export signal_patterns + outcomes to CSV. Fine-tune OpenAI GPT-4o-mini or use Replicate LLaMA-3 for classification. Deploy as edge function.',
    evidence: { current_model: 'claude-sonnet-4-6', fine_tuned: false, ai_cost_per_query: '~$0.01-0.03' },
    source_module: 'suggestion-engine.infra-analyzer',
  });

  return suggestions;
}

function extractField(text, field) {
  const regex = new RegExp(`${field}\\s*[:=]\\s*(.+?)(?=\\n[A-Z_]+\\s*[:=]|$)`, 'is');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function normalizeCategory(cat) {
  const valid = ['new_api', 'new_strategy', 'strategy_tweak', 'new_data_source', 'ui_improvement', 'risk_adjustment', 'tool_discovery', 'correction'];
  const clean = (cat || '').toLowerCase().trim().replace(/\s+/g, '_');
  return valid.includes(clean) ? clean : 'tool_discovery';
}

/**
 * Vote on a suggestion.
 */
export async function voteSuggestion(id, vote) {
  const { data, error } = await supabase
    .from('app_suggestions')
    .update({ user_vote: vote })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Change suggestion status (admin).
 */
export async function reviewSuggestion(id, status, notes = '') {
  const update = {
    status,
    admin_notes: notes,
    reviewed_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('app_suggestions')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  await supabase.from('learning_feedback_log').insert({
    event_type: 'suggestion_reviewed',
    suggestion_id: id,
    details: { status, notes },
  });

  return data;
}
