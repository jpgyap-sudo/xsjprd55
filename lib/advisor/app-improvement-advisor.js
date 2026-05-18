// ============================================================
// App Improvement Advisor
// Generates actionable upgrade suggestions based on backtest
// performance, data quality, and infrastructure health.
// v2: Uses Ollama for AI-powered improvement suggestions
// ============================================================

import { supabase } from '../supabase.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

/**
 * Generate Ollama-powered improvement suggestions.
 * Uses local LLM to analyze system state and suggest improvements.
 */
async function generateOllamaSuggestions({ featurePerformance = [], infra = {}, dataQuality = {} }) {
  const baseUrl = config.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = config.OLLAMA_MODEL || 'phi3:mini';

  const systemState = {
    featurePerformance: featurePerformance.slice(0, 10),
    infra: {
      workerCrashes24h: infra.workerCrashes24h || 0,
      cpuPct: infra.cpuPct || 0,
      memoryPct: infra.memoryPct || 0,
      queueDelayMinutes: infra.queueDelayMinutes || 0,
      uptimeHours: infra.uptimeHours || 0
    },
    dataQuality: {
      liquidation: dataQuality.liquidation || 0,
      social: dataQuality.social || 0,
      market: dataQuality.market || 0,
      news: dataQuality.news || 0
    }
  };

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a system improvement advisor for a crypto trading bot. Analyze the system state and suggest improvements. Return ONLY a JSON array:
[
  {
    "category": "data_subscription" | "api_subscription" | "server_upgrade" | "tech_stack" | "optimization" | "monitoring",
    "priority": "high" | "medium" | "low",
    "title": "<short title>",
    "reason": "<why this matters>",
    "expected_accuracy_impact": "<impact description>",
    "estimated_cost": "<cost estimate>",
    "suggested_provider": "<provider or tool name>"
  }
]
Max 5 suggestions. Do NOT include any other text.`
          },
          {
            role: 'user',
            content: JSON.stringify(systemState)
          }
        ],
        options: { temperature: 0.2, max_tokens: 512 }
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = await response.json();
    const content = data.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in response');

    const suggestions = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(suggestions)) throw new Error('Response is not an array');

    return suggestions.filter(s => s.title && s.reason).slice(0, 5);
  } catch (err) {
    logger.debug(`[ADVISOR] Ollama suggestions unavailable: ${err.message}`);
    return null;
  }
}

export async function generateSuggestions({ featurePerformance = [], infra = {}, dataQuality = {} }) {
  // Try Ollama-powered suggestions first
  try {
    const ollamaSuggestions = await generateOllamaSuggestions({ featurePerformance, infra, dataQuality });
    if (ollamaSuggestions && ollamaSuggestions.length > 0) {
      logger.info(`[ADVISOR] Generated ${ollamaSuggestions.length} Ollama-powered suggestions`);
      return ollamaSuggestions;
    }
  } catch (e) {
    logger.debug(`[ADVISOR] Ollama generation failed, using rule-based: ${e.message}`);
  }

  // Rule-based fallback suggestions
  const suggestions = [];

  const liquidationImpact = featurePerformance.find(x => x.feature === 'liquidation');
  if (liquidationImpact?.winRateLift >= 5 && (dataQuality.liquidation || 0) < 60) {
    suggestions.push({
      category: 'data_subscription',
      priority: 'high',
      title: 'Upgrade liquidation data source',
      reason: 'Liquidation features improved win rate, but crawler/screenshot quality is inconsistent.',
      expected_accuracy_impact: 'medium to high',
      estimated_cost: 'Depends on Coinglass or alternative provider plan',
      suggested_provider: 'Coinglass API or liquidation-data alternative',
    });
  }

  if ((dataQuality.social || 0) < 50) {
    suggestions.push({
      category: 'api_subscription',
      priority: 'medium',
      title: 'Improve social signal coverage',
      reason: 'Social score has low data quality. Meme and narrative trades need better X/Telegram coverage.',
      expected_accuracy_impact: 'medium for meme coins, low for BTC/ETH',
      estimated_cost: 'Depends on X API/social data provider',
      suggested_provider: 'X API, Telegram ingestion, or third-party sentiment provider',
    });
  }

  if ((infra.workerCrashes24h || 0) >= 3 || (infra.cpuPct || 0) > 80) {
    suggestions.push({
      category: 'server_upgrade',
      priority: 'high',
      title: 'Upgrade VPS resources',
      reason: 'Backtest workers are crashing or CPU is saturated.',
      expected_accuracy_impact: 'indirect: enables more symbols and deeper tests',
      estimated_cost: 'DigitalOcean 4GB/8GB droplet or higher',
      suggested_provider: 'DigitalOcean',
    });
  }

  if ((infra.queueDelayMinutes || 0) > 10) {
    suggestions.push({
      category: 'tech_stack',
      priority: 'medium',
      title: 'Add Redis + BullMQ job queue',
      reason: 'Backtest jobs are overlapping and delaying signal evaluation.',
      expected_accuracy_impact: 'indirect: cleaner scheduling and fewer missed signals',
      estimated_cost: 'Free/self-hosted Redis or managed Redis',
      suggested_provider: 'Redis/BullMQ',
    });
  }

  return suggestions;
}

export async function saveSuggestions(suggestions) {
  if (!suggestions?.length) return;
  const { error } = await supabase.from('app_improvement_suggestions').insert(
    suggestions.map(s => ({ ...s, status: 'pending' }))
  );
  if (error) logger.error(`[ADVISOR] Failed to save suggestions: ${error.message}`);
  else logger.info(`[ADVISOR] Saved ${suggestions.length} suggestions`);
}
