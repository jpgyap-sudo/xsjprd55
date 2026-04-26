// ============================================================
// News Sentiment Engine — Keyword-based crypto sentiment scoring
// No external NLP library — pure keyword matching with custom lexicon
// ============================================================

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

export { ASSET_MAP };
