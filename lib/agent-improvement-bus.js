// ============================================================
// Agent Improvement Bus — Shared communication channel for all bots
// Every bot records observations, problems, and improvement ideas.
// Safety rule: trading ideas must go through Needs Backtest → Approved
// ============================================================

import { supabase } from './supabase.js';
import { logger } from './logger.js';

const AGENT_NAMES = new Set([
  'Coding Bot', 'Application Bot', 'Trading Signal Bot',
  'Mock Trading Bot', 'Backtesting Bot', 'Wallet Tracker Bot'
]);

const VALID_TYPES = new Set([
  'Bug Fix', 'Feature Upgrade', 'Strategy Improvement', 'Risk Management',
  'Data Source Improvement', 'UI/UX Improvement', 'Performance Improvement',
  'Automation Idea', 'Cost Optimization', 'Security Improvement', 'Tech Stack Upgrade'
]);

const VALID_STATUS = new Set([
  'New', 'Under Review', 'Approved', 'Rejected', 'In Progress',
  'Completed', 'Needs Backtest', 'Needs Human Decision'
]);

const VALID_PRIORITY = new Set(['Critical', 'High', 'Medium', 'Low', 'Optional']);
const VALID_CONFIDENCE = new Set(['High', 'Medium', 'Low', 'Needs Testing']);

/**
 * Record a structured improvement idea from any bot.
 * Returns the inserted row ID or null on error.
 */
export async function sendIdea({
  sourceBot,
  ideaType,
  featureAffected,
  observation,
  recommendation,
  expectedBenefit = '',
  priority = 'Medium',
  confidence = 'Medium',
  status = 'New',
  relatedTradeId,
  relatedBacktestId,
  relatedWallet,
  relatedErrorId,
}) {
  // Validation
  if (!AGENT_NAMES.has(sourceBot)) {
    logger.warn(`[AGENT-BUS] Invalid sourceBot: ${sourceBot}`);
    return null;
  }
  if (!VALID_TYPES.has(ideaType)) {
    logger.warn(`[AGENT-BUS] Invalid ideaType: ${ideaType}`);
    return null;
  }
  if (!VALID_STATUS.has(status)) {
    logger.warn(`[AGENT-BUS] Invalid status: ${status}`);
    return null;
  }
  if (!VALID_PRIORITY.has(priority)) priority = 'Medium';
  if (!VALID_CONFIDENCE.has(confidence)) confidence = 'Medium';

  const row = {
    source_bot: sourceBot,
    idea_type: ideaType,
    feature_affected: featureAffected,
    observation,
    recommendation,
    expected_benefit: expectedBenefit,
    priority,
    confidence,
    status,
    related_trade_id: relatedTradeId || null,
    related_backtest_id: relatedBacktestId || null,
    related_wallet: relatedWallet || null,
    related_error_id: relatedErrorId || null,
  };

  try {
    const { data, error } = await supabase
      .from('agent_improvement_ideas')
      .insert(row)
      .select('id')
      .single();

    if (error) throw error;
    if (!data) {
      logger.debug(`[AGENT-BUS] Idea queued (no-op mode): ${sourceBot} → ${ideaType}`);
      return null;
    }
    logger.info(`[AGENT-BUS] Idea recorded: ${sourceBot} → ${ideaType} (${data.id})`);
    return data.id;
  } catch (err) {
    logger.error(`[AGENT-BUS] Failed to record idea: ${err.message}`);
    return null;
  }
}

/**
 * De-duplicate before sending: check if same observation exists recently.
 */
export async function dedupSendIdea(idea, windowHours = 24) {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  try {
    const { data } = await supabase
      .from('agent_improvement_ideas')
      .select('id')
      .eq('source_bot', idea.sourceBot)
      .eq('idea_type', idea.ideaType)
      .eq('feature_affected', idea.featureAffected)
      .gte('created_at', since)
      .limit(1);

    if (data?.length) {
      logger.debug(`[AGENT-BUS] Duplicate suppressed: ${idea.sourceBot}/${idea.ideaType}/${idea.featureAffected}`);
      return data[0].id;
    }
  } catch (e) {
    // ignore
  }
  return sendIdea(idea);
}

/**
 * Fetch ideas for dashboard.
 */
export async function getIdeas({ status, sourceBot, limit = 100, offset = 0 } = {}) {
  let q = supabase
    .from('agent_improvement_ideas')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) q = q.eq('status', status);
  if (sourceBot) q = q.eq('source_bot', sourceBot);

  try {
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  } catch (err) {
    logger.error(`[AGENT-BUS] getIdeas failed: ${err.message}`);
    return [];
  }
}

/**
 * Update idea status (e.g., after review or implementation).
 */
export async function updateIdeaStatus(id, status, extra = {}) {
  if (!VALID_STATUS.has(status)) {
    logger.warn(`[AGENT-BUS] Invalid status update: ${status}`);
    return false;
  }
  try {
    const { error } = await supabase
      .from('agent_improvement_ideas')
      .update({ status, ...extra, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    logger.error(`[AGENT-BUS] updateIdeaStatus failed: ${err.message}`);
    return false;
  }
}

/**
 * Summary counts for dashboard cards.
 */
export async function getIdeaSummary() {
  try {
    const { data, error } = await supabase
      .from('agent_improvement_ideas')
      .select('status, priority, source_bot');
    if (error) throw error;

    const summary = {
      total: data.length,
      byStatus: {},
      byPriority: {},
      byBot: {},
    };
    for (const row of data) {
      summary.byStatus[row.status] = (summary.byStatus[row.status] || 0) + 1;
      summary.byPriority[row.priority] = (summary.byPriority[row.priority] || 0) + 1;
      summary.byBot[row.source_bot] = (summary.byBot[row.source_bot] || 0) + 1;
    }
    return summary;
  } catch (err) {
    logger.error(`[AGENT-BUS] getIdeaSummary failed: ${err.message}`);
    return { total: 0, byStatus: {}, byPriority: {}, byBot: {} };
  }
}
