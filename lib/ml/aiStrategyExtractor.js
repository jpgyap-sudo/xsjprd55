// ============================================================
// AI Strategy Extractor
// Uses the brain's model-router to send research text to an AI
// provider (Kimi, Claude, OpenAI, Ollama) and parse the response
// into structured trading rules.
// ============================================================

import { explainDecision } from '../brain/model-router.js';
import { logger } from '../logger.js';
import { checkDuplicate, hashProposal } from './duplicateDetector.js';
import { getSourceCredibility } from './promotionGate.js';
import { saveProposal } from './saveProposal.js';

/**
 * @typedef {Object} AIExtractedStrategy
 * @property {string} name
 * @property {string} description
 * @property {Array<{feature:string, operator:'gt'|'lt'|'eq'|'between', value:number, value2?:number, weight:number}>} rules
 * @property {number} confidence
 * @property {string[]} tags
 * @property {string} [rulesHash]
 * @property {'LONG'|'SHORT'|null} inferredSide
 */

/**
 * Build a structured context object from research text for the AI.
 * @param {string} content - Research text content
 * @param {string} sourceName - Source identifier
 * @returns {Object} Context for AI
 */
function buildAIContext(content, sourceName) {
  return {
    task: 'extract_trading_strategy',
    researchText: content,
    source: sourceName,
    availableFeatures: [
      { name: 'funding_rate', description: 'Perpetual futures funding rate. Negative = bullish (longs pay shorts), Positive = bearish (shorts pay longs). Range: -0.1 to 0.1.' },
      { name: 'open_interest_change_pct', description: 'Open interest change percentage. Rising OI confirms trend, falling OI suggests reversal. Range: -50 to 50.' },
      { name: 'liquidation_imbalance', description: 'Ratio of long liquidations to short liquidations. >1 means more longs being liquidated (bearish). Range: 0 to 5.' },
      { name: 'social_sentiment', description: 'Social media sentiment score. Positive = bullish chatter. Range: -1 to 1.' },
      { name: 'volume_change_pct', description: 'Volume change percentage relative to average. Spikes indicate strong interest. Range: -100 to 500.' },
      { name: 'volatility_pct', description: 'ATR-based volatility as percentage of price. Range: 0 to 10.' },
      { name: 'whale_flow_score', description: 'Whale transaction flow score. Positive = accumulation. Range: -1 to 1.' },
      { name: 'btc_trend_score', description: 'BTC short-term trend score. Positive = bullish. Range: -1 to 1.' },
      { name: 'ema_cross_score', description: 'EMA9/EMA21 cross score. Positive = bullish cross. Range: -1 to 1.' },
      { name: 'rsi_divergence', description: 'RSI divergence score. Positive = bullish divergence. Range: -1 to 1.' },
      { name: 'support_resistance_score', description: 'Proximity to support/resistance. Positive = near support. Range: -1 to 1.' },
      { name: 'macro_score', description: 'Macroeconomic conditions score. Positive = favorable. Range: -1 to 1.' },
      { name: 'btc_dominance_score', description: 'BTC dominance trend. Positive = capital flowing to BTC. Range: -1 to 1.' },
      { name: 'order_book_depth', description: 'Order book depth imbalance. Positive = more bid depth. Range: -1 to 1.' },
    ],
    outputFormat: {
      type: 'object',
      properties: {
        strategies: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Short descriptive name (snake_case)' },
              description: { type: 'string', description: 'What this strategy detects' },
              side: { type: 'string', enum: ['LONG', 'SHORT', null] },
              rules: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    feature: { type: 'string', enum: ['funding_rate', 'open_interest_change_pct', 'liquidation_imbalance', 'social_sentiment', 'volume_change_pct', 'volatility_pct', 'whale_flow_score', 'btc_trend_score', 'ema_cross_score', 'rsi_divergence', 'support_resistance_score', 'macro_score', 'btc_dominance_score', 'order_book_depth'] },
                    operator: { type: 'string', enum: ['gt', 'lt', 'eq', 'between'] },
                    value: { type: 'number' },
                    value2: { type: 'number', description: 'Only for between operator' },
                    weight: { type: 'number', description: 'Importance weight 0.1-1.0' },
                  },
                  required: ['feature', 'operator', 'value', 'weight'],
                },
              },
              confidence: { type: 'number', description: 'Confidence in this strategy 0-1' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'description', 'rules', 'confidence'],
          },
        },
      },
    },
  };
}

/**
 * Parse AI response text into structured strategy objects.
 * Handles both JSON and text-based responses.
 * @param {string} responseText
 * @returns {Array<{name:string, description:string, rules:Array, confidence:number, tags:string[], inferredSide:string|null}>}
 */
function parseAIResponse(responseText) {
  // Try to extract JSON from the response
  let jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
  if (!jsonMatch) {
    jsonMatch = responseText.match(/```\n([\s\S]*?)\n```/);
  }
  if (!jsonMatch) {
    // Try to find JSON object directly
    jsonMatch = responseText.match(/\{[\s\S]*"strategies"[\s\S]*\}/);
  }

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      if (parsed.strategies && Array.isArray(parsed.strategies)) {
        return parsed.strategies.map(s => ({
          name: s.name || `ai_extracted_${Date.now().toString(36)}`,
          description: s.description || 'AI-extracted strategy',
          rules: (s.rules || []).map(r => ({
            feature: r.feature,
            operator: r.operator || 'gt',
            value: typeof r.value === 'number' ? r.value : 0.5,
            value2: r.value2,
            weight: r.weight || 0.5,
          })),
          confidence: Math.min(s.confidence ?? 0.5, 0.95),
          tags: s.tags || ['ai-extracted'],
          inferredSide: s.side || null,
        }));
      }
    } catch (e) {
      logger.warn(`[AI-EXTRACTOR] JSON parse failed: ${e.message}`);
    }
  }

  // Fallback: try to parse structured text response
  return parseTextResponse(responseText);
}

/**
 * Fallback parser for non-JSON AI responses.
 * Extracts strategy patterns from natural language text.
 * @param {string} text
 * @returns {Array}
 */
function parseTextResponse(text) {
  const strategies = [];
  const lines = text.split('\n').filter(l => l.trim());

  // Look for strategy-like patterns
  const strategyBlocks = text.split(/(?=Strategy:|## |### )/).filter(b => b.trim().length > 20);

  for (const block of strategyBlocks) {
    const name = block.match(/(?:Strategy|Name):\s*(\w+)/i)?.[1] || `ai_text_${Date.now().toString(36)}`;
    const side = block.match(/side:\s*(LONG|SHORT)/i)?.[1] || null;
    const confidence = parseFloat(block.match(/confidence:\s*([0-9.]+)/i)?.[1]) || 0.5;

    // Extract rules from text patterns
    const rules = [];
    for (const feature of ['funding_rate', 'open_interest_change_pct', 'liquidation_imbalance',
      'social_sentiment', 'volume_change_pct', 'volatility_pct', 'whale_flow_score',
      'btc_trend_score', 'ema_cross_score', 'rsi_divergence', 'support_resistance_score',
      'macro_score', 'btc_dominance_score', 'order_book_depth']) {
      const featureRegex = new RegExp(`${feature}[\\s:]+(gt|lt|eq|between|>|<|=)\\s*([0-9.-]+)`, 'i');
      const match = block.match(featureRegex);
      if (match) {
        const opMap = { '>': 'gt', '<': 'lt', '=': 'eq', 'gt': 'gt', 'lt': 'lt', 'eq': 'eq', 'between': 'between' };
        rules.push({
          feature,
          operator: opMap[match[1].toLowerCase()] || 'gt',
          value: parseFloat(match[2]),
          weight: 0.5,
        });
      }
    }

    if (rules.length > 0) {
      strategies.push({
        name,
        description: `AI text-extracted strategy. Source text: ${text.slice(0, 100)}...`,
        rules,
        confidence: Math.min(confidence, 0.95),
        tags: ['ai-extracted', 'text-parsed'],
        inferredSide: side,
      });
    }
  }

  return strategies;
}

/**
 * Extract strategies from research text using AI.
 * Uses the brain's model-router to send text to configured AI provider.
 * @param {string} content - Research text content
 * @param {string} sourceName - Source identifier
 * @returns {Promise<AIExtractedStrategy[]>}
 */
export async function extractStrategiesWithAI(content, sourceName = 'unknown') {
  if (!content || content.length < 20) {
    return [];
  }

  try {
    const context = buildAIContext(content, sourceName);

    // Use the brain's model-router to explain/extract
    const aiResult = await explainDecision({
      context,
      strategy: { side: 'NONE', composite: 0, breakdown: {} },
      risk: { verdict: 'ANALYSIS' },
    });

    if (!aiResult || !aiResult.explanation) {
      logger.debug('[AI-EXTRACTOR] No AI response, falling back to text parsing');
      return parseTextResponse(content);
    }

    const strategies = parseAIResponse(aiResult.explanation);

    // Apply source credibility multiplier
    const sourceCredibility = getSourceCredibility(sourceName);
    const credibilityMultiplier = Math.min(sourceCredibility / 0.5, 1.0);

    return strategies.map(s => ({
      ...s,
      confidence: s.confidence * credibilityMultiplier,
      rulesHash: hashProposal({ name: s.name, rules: s.rules }),
    }));
  } catch (e) {
    logger.warn(`[AI-EXTRACTOR] AI extraction failed: ${e.message}`);
    return [];
  }
}

/**
 * Run AI extraction on multiple research sources and save proposals.
 * @param {Array<{id:number, content:string, source_name:string}>} sources
 * @returns {Promise<{extracted:number, saved:number, strategies:AIExtractedStrategy[]}>}
 */
export async function extractAndSaveWithAI(sources) {
  let extracted = 0;
  let saved = 0;
  const allStrategies = [];

  for (const source of sources) {
    try {
      const strategies = await extractStrategiesWithAI(source.content, source.source_name);

      for (const s of strategies) {
        // Check for duplicates
        const dupCheck = checkDuplicate({ name: s.name, rules: s.rules });
        if (dupCheck.isDuplicate) {
          logger.debug(`[AI-EXTRACTOR] Skipping duplicate: ${s.name}`);
          continue;
        }

        // Save using shared helper (Supabase → SQLite fallback)
        const result = await saveProposal({
          name: s.name,
          description: s.description,
          rules: s.rules,
          confidence: s.confidence,
          tags: s.tags,
          rulesHash: s.rulesHash || null,
          sourceName: source.source_name,
          sourceCredibility: getSourceCredibility(source.source_name),
        });

        if (result.ok) {
          saved++;
          allStrategies.push(s);
          extracted++;
        } else {
          logger.warn(`[AI-EXTRACTOR] Save failed for ${s.name}: ${result.error}`);
        }
      }
    } catch (e) {
      logger.warn(`[AI-EXTRACTOR] Source ${source.id} failed: ${e.message}`);
    }
  }

  logger.info(`[AI-EXTRACTOR] AI-extracted ${extracted} strategies, saved ${saved}`);
  return { extracted, saved, strategies: allStrategies };
}
