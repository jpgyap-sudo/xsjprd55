// ============================================================
// Agent Signal Bus — Cross-agent communication via Supabase
// Broadcasts neural social intelligence to signal engine,
// mock trader, learning loop, dashboard, and Telegram bot.
// ============================================================

import { supabase } from './supabase.js';
import { logger } from './logger.js';

const DEFAULT_TARGET_AGENTS = [
  'research_agent',
  'signal_engine',
  'mock_trader',
  'learning_loop',
  'dashboard',
  'telegram_bot'
];

export async function publishAgentMessage({
  from = 'neural_social_intel',
  to,
  type = 'social_news_event',
  payload
}) {
  const { data, error } = await supabase
    .from('agent_messages')
    .insert({
      from_agent: from,
      to_agent: to,
      message_type: type,
      payload,
      status: 'new'
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function broadcastSocialIntel(payload, targetAgents = DEFAULT_TARGET_AGENTS) {
  const rows = targetAgents.map(to => ({
    from_agent: 'neural_social_intel',
    to_agent: to,
    message_type: 'social_news_event',
    payload,
    status: 'new'
  }));

  const { data, error } = await supabase
    .from('agent_messages')
    .insert(rows)
    .select('*');

  if (error) {
    logger.warn(`[agent-signal-bus] broadcast error: ${error.message}`);
    throw error;
  }
  logger.info(`[agent-signal-bus] Broadcasted social intel to ${data?.length || 0} agents`);
  return data || [];
}

export async function getPendingAgentMessages(toAgent, limit = 50) {
  const { data, error } = await supabase
    .from('agent_messages')
    .select('*')
    .eq('to_agent', toAgent)
    .eq('status', 'new')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function markAgentMessageDone(id) {
  const { error } = await supabase
    .from('agent_messages')
    .update({ status: 'done', processed_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}
