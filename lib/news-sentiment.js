// ============================================================
// News Sentiment Engine — Keyword-based crypto sentiment scoring
// + Ollama LLM enhancement for deeper semantic analysis
// No external NLP library — pure keyword matching with custom lexicon
// ============================================================

import { config } from './config.js';
import { logger } from './logger.js';

// Keyword sentiment scores
const LEXICON = {
  // Strong positive
  bullish: 4, rally: 3, surge: 3, adoption: 3, approved: 3,
  breakthrough: 3, accumulate: 3, ath: 4, breakout: 3,
  institutional: 2, partnership: 2, upgrade: 2, hodl: 2,
  pump: 2, moon: 2, green: 1, recovery: 2, rebound: 2,
  // Strong negative
  bearish: -4, crash: -4, dump: -3, hack: -5, exploit: -5,
  ban: -4, lawsuit: -3, scam: -5, rug: -5, rugpull: -5,
  shutdown: -4, fud: -2, selloff: -3, selloffs: -3,
  'sell off': -3, 'selling off': -3, liquidation: -3,
  liquidation: -3, liquidations: -3, depeg: -4, default: -3,
  // Event-specific
  'etf approved': 4, 'etf rejected': -4, 'sec approves': 4,
  'sec rejects': -4, 'sec lawsuit': -3, 'sec charges': -3,
  'fed cuts rates': 2, 'fed raises rates': -2, 'rate hike': -2,
  'rate cut': 2, 'bankruptcy': -4, 'insolvent': -4,
  // Amplifiers (multiply final score)
  massive: 1.3, breaking: 1.4, urgent: 1.3, historic: 1.2,
  'just in': 1.5, 'just_in': 1.5, alert: 1.2, record: 1.2
};

const URGENCY_TERMS = ['JUST IN', 'BREAKING', 'URGENT', 'ALERT', 'FLASH', 'EXCLUSIVE'];

function scoreText(text) {
  if (!text || typeof text !== 'string') return { score: 0, details: [] };
  const lower = text.toLowerCase();
  let totalScore = 0;
  let matched = [];

  // Check multi-word phrases first
  const phrases = Object.keys(LEXICON).filter(k => k.includes(' '));
  for (const phrase of phrases) {
    if (lower.includes(phrase)) {
      const val = LEXICON[phrase];
      if (val !== undefined) {
        totalScore += val;
        matched.push({ term: phrase, score: val });
      }
    }
  }

  // Check single words
  const words = lower.split(/[\s\W]+/);
  for (const word of words) {
    if (word.length < 2) continue;
    const val = LEXICON[word];
    if (val !== undefined) {
      totalScore += val;
      matched.push({ term: word, score: val });
    }
  }

  // Normalize to -1 to +1 range (clamp)
  const normalized = Math.max(-1, Math.min(1, totalScore * 0.15));

  // Apply urgency multiplier
  const upper = text.toUpperCase();
  const hasUrgency = URGENCY_TERMS.some(term => upper.includes(term));
  const finalScore = hasUrgency ? Math.max(-1, Math.min(1, normalized * 1.4)) : normalized;

  return { score: finalScore, hasUrgency, matched: matched.slice(0, 10) };
}

// Asset detection
const ASSET_MAP = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', keywords: ['bitcoin', 'btc', 'satoshi', 'xbt'] },
  { symbol: 'ETHUSDT', name: 'Ethereum', keywords: ['ethereum', 'eth', 'vitalik', 'erc20', 'erc-20'] },
  { symbol: 'SOLUSDT', name: 'Solana', keywords: ['solana', 'sol'] },
  { symbol: 'BNBUSDT', name: 'BNB', keywords: ['bnb', 'binance coin', 'bsc'] },
  { symbol: 'XRPUSDT', name: 'XRP', keywords: ['xrp', 'ripple'] },
  { symbol: 'ADAUSDT', name: 'Cardano', keywords: ['cardano', 'ada'] },
  { symbol: 'AVAXUSDT', name: 'Avalanche', keywords: ['avalanche', 'avax'] },
  { symbol: 'DOGEUSDT', name: 'Dogecoin', keywords: ['dogecoin', 'doge'] },
  { symbol: 'DOTUSDT', name: 'Polkadot', keywords: ['polkadot', 'dot'] },
  { symbol: 'LINKUSDT', name: 'Chainlink', keywords: ['chainlink', 'link'] },
  { symbol: 'MATICUSDT', name: 'Polygon', keywords: ['polygon', 'matic'] },
  { symbol: 'LTCUSDT', name: 'Litecoin', keywords: ['litecoin', 'ltc'] },
  { symbol: 'BCHUSDT', name: 'Bitcoin Cash', keywords: ['bitcoin cash', 'bch'] },
  { symbol: 'UNIUSDT', name: 'Uniswap', keywords: ['uniswap', 'uni'] },
  { symbol: 'AAVEUSDT', name: 'Aave', keywords: ['aave'] },
  { symbol: 'SUIUSDT', name: 'Sui', keywords: ['sui'] },
  { symbol: 'SEIUSDT', name: 'Sei', keywords: ['sei'] },
  { symbol: 'ARBUSDT', name: 'Arbitrum', keywords: ['arbitrum', 'arb'] },
  { symbol: 'OPUSDT', name: 'Optimism', keywords: ['optimism', 'op'] }
];

export function detectAssets(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found = [];
  for (const asset of ASSET_MAP) {
    const matched = asset.keywords.some(kw => lower.includes(kw));
    if (matched && !found.some(f => f.symbol === asset.symbol)) {
      found.push(asset);
    }
  }
  return found;
}

export function analyzeSentiment(text) {
  return scoreText(text);
}

/**
 * Ollama-powered sentiment analysis.
 * Uses local LLM to analyze text sentiment with deeper semantic understanding.
 * Falls back to keyword-based scoring if Ollama is unavailable.
 */
async function analyzeWithOllama(text) {
  const baseUrl = config.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = config.OLLAMA_MODEL || 'phi3:mini';

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a crypto news sentiment analyzer. Analyze the given text and return ONLY a JSON object with these fields:
{
  "sentiment": "bullish" | "bearish" | "neutral",
  "score": <number between -1 and 1>,
  "confidence": <number between 0 and 1>,
  "reasoning": "<brief 1-sentence explanation>",
  "key_assets": ["<asset symbols mentioned>"]
}
Do NOT include any other text or markdown formatting.`
          },
          { role: 'user', content: text.slice(0, 2000) }
        ],
        options: { temperature: 0.1, max_tokens: 256 }
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);

    const data = await response.json();
    const content = data.message?.content || '';

    // Parse the JSON response
    try {
      // Try to extract JSON from the response (handle markdown-wrapped JSON)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      const parsed = JSON.parse(jsonMatch[0]);

      return {
        score: Math.max(-1, Math.min(1, Number(parsed.score) || 0)),
        sentiment: parsed.sentiment || 'neutral',
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        reasoning: parsed.reasoning || '',
        keyAssets: Array.isArray(parsed.key_assets) ? parsed.key_assets : [],
        source: 'ollama'
      };
    } catch (parseErr) {
      logger.debug('[news-sentiment] Ollama JSON parse failed, falling back to keyword');
      return null;
    }
  } catch (err) {
    logger.debug(`[news-sentiment] Ollama unavailable: ${err.message}`);
    return null;
  }
}

/**
 * Enhanced sentiment analysis that combines keyword scoring with Ollama LLM.
 * Uses Ollama when available, falls back to pure keyword scoring.
 */
export async function analyzeSentimentEnhanced(text) {
  if (!text || typeof text !== 'string') return { score: 0, details: [], source: 'none' };

  // Always run keyword scoring first (fast path)
  const keywordResult = scoreText(text);

  // Try Ollama enhancement (non-blocking — if it fails, use keyword result)
  try {
    const ollamaResult = await analyzeWithOllama(text);
    if (ollamaResult && ollamaResult.confidence >= 0.6) {
      // Blend: 60% Ollama + 40% keyword when Ollama is confident
      const blendedScore = ollamaResult.score * 0.6 + keywordResult.score * 0.4;
      return {
        score: Number(blendedScore.toFixed(4)),
        keywordScore: keywordResult.score,
        ollamaScore: ollamaResult.score,
        sentiment: ollamaResult.sentiment,
        confidence: ollamaResult.confidence,
        reasoning: ollamaResult.reasoning,
        keyAssets: ollamaResult.keyAssets,
        hasUrgency: keywordResult.hasUrgency,
        matched: keywordResult.matched,
        source: 'ollama_enhanced'
      };
    }
  } catch (err) {
    logger.debug(`[news-sentiment] Ollama enhancement failed: ${err.message}`);
  }

  // Fallback to pure keyword
  return {
    ...keywordResult,
    source: 'keyword'
  };
}

export function scoreNewsItems(newsItems) {
  if (!newsItems?.length) return { overallScore: 0, items: [] };

  let totalWeight = 0;
  let weightedScore = 0;
  const scored = [];

  for (const item of newsItems) {
    const combined = `${item.title || ''} ${item.summary || ''}`;
    const { score, hasUrgency, matched } = scoreText(combined);
    const weight = item.weight || 1.0;
    weightedScore += score * weight;
    totalWeight += weight;

    const assets = detectAssets(combined);
    scored.push({
      ...item,
      sentimentScore: score,
      hasUrgency,
      matchedKeywords: matched,
      detectedAssets: assets,
      impact: Math.abs(score) >= 0.5 ? (score > 0 ? 'bullish' : 'bearish') : 'neutral'
    });
  }

  return {
    overallScore: totalWeight > 0 ? weightedScore / totalWeight : 0,
    itemCount: newsItems.length,
    items: scored.sort((a, b) => Math.abs(b.sentimentScore) - Math.abs(a.sentimentScore))
  };
}

/**
 * Score news items with Ollama-enhanced sentiment.
 * Processes items in parallel with Ollama for deeper analysis.
 */
export async function scoreNewsItemsEnhanced(newsItems) {
  if (!newsItems?.length) return { overallScore: 0, items: [] };

  const scored = await Promise.all(
    newsItems.map(async (item) => {
      const combined = `${item.title || ''} ${item.summary || ''}`;
      const enhanced = await analyzeSentimentEnhanced(combined);
      const assets = detectAssets(combined);

      return {
        ...item,
        sentimentScore: enhanced.score,
        keywordScore: enhanced.keywordScore,
        ollamaScore: enhanced.ollamaScore,
        hasUrgency: enhanced.hasUrgency,
        matchedKeywords: enhanced.matched,
        detectedAssets: assets,
        reasoning: enhanced.reasoning,
        sentimentSource: enhanced.source,
        impact: Math.abs(enhanced.score) >= 0.5
          ? (enhanced.score > 0 ? 'bullish' : 'bearish')
          : 'neutral'
      };
    })
  );

  const totalWeight = scored.reduce((s, i) => s + (i.weight || 1.0), 0);
  const weightedScore = scored.reduce((s, i) => s + i.sentimentScore * (i.weight || 1.0), 0);

  return {
    overallScore: totalWeight > 0 ? weightedScore / totalWeight : 0,
    itemCount: newsItems.length,
    items: scored.sort((a, b) => Math.abs(b.sentimentScore) - Math.abs(a.sentimentScore))
  };
}

export { ASSET_MAP };
