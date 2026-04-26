// ============================================================
// News Signal Generator — Combines sentiment + market + tech analysis
// Generates LONG/SHORT signals from news events with win probability
// ============================================================

import { fetchOHLCV } from './exchange.js';
import { fetchAllNews } from './news-aggregator.js';
import { scoreNewsItems, analyzeSentiment, detectAssets, ASSET_MAP } from './news-sentiment.js';
import { buildSignal } from './signal-engine.js';

const BINANCE_BASE = 'https://api.binance.com/api/v3';

// ── Market data fetcher (lightweight, no CCXT overhead) ─────
async function fetchMarketSnapshot(symbol) {
  try {
    const res = await fetch(`${BINANCE_BASE}/ticker/24hr?symbol=${symbol}`);
    if (!res.ok) return null;
    const d = await res.json();
    return {
      price: parseFloat(d.lastPrice),
      change24h: parseFloat(d.priceChangePercent),
      volume24h: parseFloat(d.quoteVolume),
      high24h: parseFloat(d.highPrice),
      low24h: parseFloat(d.lowPrice),
      bidQty: parseFloat(d.bidQty),
      askQty: parseFloat(d.askQty)
    };
  } catch (e) {
    return null;
  }
}

async function fetchKlines(symbol, interval = '1h', limit = 50) {
  try {
    const res = await fetch(`${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// ── Technical scoring helpers ───────────────────────────────
function calculateTechnicals(klines) {
  if (!klines || klines.length < 20) return null;
  const closes = klines.map(k => parseFloat(k[4]));
  const volumes = klines.map(k => parseFloat(k[5]));

  // RSI (14)
  const rsi14 = rsi(closes, 14);
  const rsiVal = rsi14.length ? rsi14[rsi14.length - 1] : 50;

  // EMA 9/21
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema9Val = ema9[ema9.length - 1];
  const ema21Val = ema21[ema21.length - 1];

  // Volume
  const avgVol = volumes.slice(-20, -1).reduce((a, b) => a + b, 0) / 19;
  const lastVol = volumes[volumes.length - 1];
  const volSpike = avgVol > 0 ? lastVol / avgVol : 1;

  // Price vs recent range
  const range20 = Math.max(...closes.slice(-20)) - Math.min(...closes.slice(-20));
  const positionInRange = range20 > 0 ? (closes[closes.length - 1] - Math.min(...closes.slice(-20))) / range20 : 0.5;

  return { rsi: rsiVal, ema9: ema9Val, ema21: ema21Val, volSpike, positionInRange };
}

function ema(data, period) {
  const k = 2 / (period + 1);
  let e = data[0];
  const out = [e];
  for (let i = 1; i < data.length; i++) {
    e = data[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

function rsi(closes, period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const rsis = [];
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsis.push(100 - (100 / (1 + rs)));
  }
  return rsis;
}

function scoreTechnicals(tech, side) {
  if (!tech) return 0;
  let score = 0;
  let components = 0;

  // RSI alignment
  if (side === 'LONG') {
    if (tech.rsi < 30) score += 0.8;
    else if (tech.rsi < 45) score += 0.3;
    else if (tech.rsi > 70) score -= 0.6;
  } else {
    if (tech.rsi > 70) score += 0.8;
    else if (tech.rsi > 55) score += 0.3;
    else if (tech.rsi < 30) score -= 0.6;
  }
  components++;

  // EMA alignment
  if (side === 'LONG') {
    if (tech.ema9 > tech.ema21) score += 0.5;
    else score -= 0.3;
  } else {
    if (tech.ema9 < tech.ema21) score += 0.5;
    else score -= 0.3;
  }
  components++;

  // Volume confirmation
  if (tech.volSpike > 2.0) score += 0.3;
  components++;

  // Position in range (LONG = want near support, SHORT = want near resistance)
  if (side === 'LONG') {
    if (tech.positionInRange < 0.3) score += 0.3;
    else if (tech.positionInRange > 0.7) score -= 0.3;
  } else {
    if (tech.positionInRange > 0.7) score += 0.3;
    else if (tech.positionInRange < 0.3) score -= 0.3;
  }
  components++;

  return components > 0 ? score / components : 0;
}

function scorePriceMomentum(market) {
  if (!market) return 0;
  const change = market.change24h;
  if (change > 5) return 0.9;
  if (change > 2) return 0.5;
  if (change > 0.5) return 0.2;
  if (change < -5) return -0.9;
  if (change < -2) return -0.5;
  if (change < -0.5) return -0.2;
  return 0;
}

// ── Main news signal generator ──────────────────────────────
export async function generateNewsSignal(asset, newsItems, marketSnapshot = null) {
  const symbol = asset.symbol;

  // Filter news for this asset
  const relevantNews = newsItems.filter(item => {
    const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
    return asset.keywords.some(kw => text.includes(kw.toLowerCase()));
  });

  if (relevantNews.length === 0) return null;

  const sentiment = scoreNewsItems(relevantNews);
  const newsScore = sentiment.overallScore; // -1 to +1

  // Fetch market data
  let market = marketSnapshot;
  if (!market) {
    market = await fetchMarketSnapshot(symbol);
  }
  if (!market) return null;

  const klines1h = await fetchKlines(symbol, '1h', 50);
  const tech1h = calculateTechnicals(klines1h);

  // Determine direction from news
  const direction = newsScore > 0 ? 'LONG' : 'SHORT';
  const newsStrength = Math.abs(newsScore);

  // Technical score aligned with direction
  const techScore = scoreTechnicals(tech1h, direction);
  const techStrength = Math.abs(techScore);

  // Price momentum (independent check)
  const momentumScore = scorePriceMomentum(market);
  // If news says LONG but price dumped 5%+, that's contradiction → reduce confidence
  const contradiction = (direction === 'LONG' && momentumScore < -0.5) || (direction === 'SHORT' && momentumScore > 0.5);

  // Weighted composite
  const wNews = 0.40;
  const wTech = 0.35;
  const wMomentum = 0.25;

  let composite = (newsStrength * wNews) + (techStrength * wTech) + (Math.abs(momentumScore) * wMomentum);

  // Penalty for contradiction
  if (contradiction) {
    composite *= 0.6;
  }

  // Convert to confidence (50-100 range, then 0-1)
  let confidence = 0.5 + (composite * 0.5);
  if (confidence < 0.55) return null; // too weak

  // Clamp
  confidence = Math.min(0.98, Math.max(0.55, confidence));

  // Entry/SL/TP
  const price = market.price;
  const atrVal = tech1h ? (tech1h.ema9 && tech1h.ema21 ? Math.abs(tech1h.ema9 - tech1h.ema21) : price * 0.025) : price * 0.025;
  const slPct = Math.min(3.5, Math.max(1.5, (atrVal / price) * 100));

  const sl = direction === 'LONG'
    ? price * (1 - slPct / 100)
    : price * (1 + slPct / 100);

  const tp1 = direction === 'LONG'
    ? price * (1 + slPct * 2 / 100)
    : price * (1 - slPct * 2 / 100);

  const tp2 = direction === 'LONG'
    ? price * (1 + slPct * 3.5 / 100)
    : price * (1 - slPct * 3.5 / 100);

  // Win probability estimation based on signal quality
  const winProb = Math.round(confidence * 100);

  // Risk level
  const riskLevel = contradiction ? 'HIGH' : confidence > 0.80 ? 'MEDIUM' : 'LOW';

  // Suggested leverage
  const leverage = confidence >= 0.85 ? 3 : confidence >= 0.70 ? 2 : 1;

  const signal = buildSignal({
    symbol,
    side: direction,
    entry_price: parseFloat(price.toFixed(4)),
    stop_loss: parseFloat(sl.toFixed(4)),
    take_profit: [parseFloat(tp1.toFixed(4)), parseFloat(tp2.toFixed(4))],
    confidence: parseFloat(confidence.toFixed(3)),
    strategy: 'News_Event',
    timeframe: '1h',
    source: 'news_sentiment',
    mode: process.env.TRADING_MODE || 'paper',
    ttl_minutes: 120,
    metadata: {
      news_sentiment_score: newsScore,
      news_count: relevantNews.length,
      technical_score: techScore,
      price_momentum: momentumScore,
      contradiction,
      win_probability: winProb,
      risk_level: riskLevel,
      leverage_suggested: leverage,
      top_headlines: relevantNews.slice(0, 3).map(n => ({ title: n.title, source: n.source })),
      rsi: tech1h?.rsi,
      ema_bullish: tech1h ? tech1h.ema9 > tech1h.ema21 : null,
      vol_spike: tech1h?.volSpike,
      price_change_24h: market.change24h
    }
  });

  return signal;
}

// ── Batch scan all watched assets ───────────────────────────
const WATCH_ASSETS = ASSET_MAP.slice(0, 10); // Top 10 by default

export async function scanNewsSignals(options = {}) {
  const {
    maxAgeMinutes = 60,
    minConfidence = 0.60,
    assets = WATCH_ASSETS,
    symbolFilter = null
  } = options;

  const results = { scanned: 0, signals: [], errors: [] };

  try {
    // 1. Fetch news
    const newsItems = await fetchAllNews(maxAgeMinutes);
    if (newsItems.length === 0) {
      return { ...results, info: 'No fresh news found' };
    }

    // 2. Detect which assets are mentioned
    const allText = newsItems.map(n => `${n.title} ${n.summary}`).join(' ');
    const detected = detectAssets(allText);
    const targetAssets = symbolFilter
      ? assets.filter(a => a.symbol === symbolFilter.toUpperCase())
      : (detected.length ? detected : assets);

    // 3. Generate signals for each
    for (const asset of targetAssets) {
      results.scanned++;
      try {
        const signal = await generateNewsSignal(asset, newsItems);
        if (signal && signal.confidence >= minConfidence) {
          results.signals.push(signal);
        }
      } catch (e) {
        results.errors.push({ symbol: asset.symbol, error: e.message });
      }
    }

    return results;
  } catch (e) {
    results.errors.push({ fatal: true, error: e.message });
    return results;
  }
}

export { ASSET_MAP };
