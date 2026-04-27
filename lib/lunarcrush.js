// ============================================================
// LunarCrush API Client — Social metrics for crypto assets
// Docs: https://lunarcrush.com/developers/docs
// ============================================================

import { config } from './config.js';

const BASE_URL = 'https://lunarcrush.com/api4';
const API_KEY  = config.LUNARCRUSH_API_KEY;

function authHeaders() {
  if (!API_KEY) throw new Error('LUNARCRUSH_API_KEY is not configured');
  return {
    'Authorization': `Bearer ${API_KEY}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };
}

async function lunarFetch(path, query = {}) {
  const qs = new URLSearchParams(query).toString();
  const url = `${BASE_URL}${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`LunarCrush ${res.status}: ${txt}`);
  }
  return res.json();
}

// ── Coin data ───────────────────────────────────────────────

export async function getCoinData(symbol) {
  const data = await lunarFetch('/public/coins', { symbol: symbol.toUpperCase() });
  const coin = data?.data?.[0];
  if (!coin) return null;
  return normalizeCoin(coin);
}

export async function getTopCoins(limit = 20) {
  const data = await lunarFetch('/public/coins/list', { limit, sort: 'galaxy_score', desc: 'true' });
  const coins = data?.data || [];
  return coins.map(normalizeCoin);
}

export async function getCoinTimeSeries(symbol, bucket = '1d', limit = 30) {
  const data = await lunarFetch('/public/coins/' + symbol.toUpperCase() + '/time-series', { bucket, limit });
  return (data?.data || []).map(normalizeTimePoint);
}

// ── Normalizers ─────────────────────────────────────────────

function normalizeCoin(raw) {
  return {
    id: raw.id,
    name: raw.name,
    symbol: raw.symbol,
    price: raw.price,
    price_btc: raw.price_btc,
    percent_change_24h: raw.percent_change_24h,
    percent_change_7d: raw.percent_change_7d,
    percent_change_30d: raw.percent_change_30d,
    market_cap: raw.market_cap,
    volume_24h: raw.volume_24h,
    circulating_supply: raw.circulating_supply,
    total_supply: raw.total_supply,
    galaxy_score: raw.galaxy_score,
    alt_rank: raw.alt_rank,
    social_score: raw.social_score,
    social_volume: raw.social_volume,
    social_volume_global: raw.social_volume_global,
    social_dominance: raw.social_dominance,
    market_dominance: raw.market_dominance,
    sentiment: raw.sentiment,
    bullish_sentiment: raw.bullish_sentiment,
    bearish_sentiment: raw.bearish_sentiment,
    interactions_24h: raw.interactions_24h,
    contributors_active: raw.contributors_active,
    posts_active: raw.posts_active,
    updated: raw.updated
  };
}

function normalizeTimePoint(raw) {
  return {
    time: raw.time,
    open: raw.open,
    high: raw.high,
    low: raw.low,
    close: raw.close,
    volume: raw.volume,
    galaxy_score: raw.galaxy_score,
    alt_rank: raw.alt_rank,
    social_volume: raw.social_volume,
    social_score: raw.social_score,
    sentiment: raw.sentiment
  };
}

// ── Analysis helper ─────────────────────────────────────────

export function analyzeSocialMetrics(coin) {
  const issues = [];
  const positives = [];

  // Galaxy Score (0-100, higher is better social+market combined)
  if (coin.galaxy_score >= 80) positives.push('Exceptional Galaxy Score — strong social-market alignment.');
  else if (coin.galaxy_score >= 60) positives.push('Solid Galaxy Score — healthy engagement.');
  else if (coin.galaxy_score >= 40) issues.push('Mediocre Galaxy Score — social traction is weak.');
  else issues.push('Low Galaxy Score — very poor social sentiment.');

  // AltRank (1-N, lower is better)
  if (coin.alt_rank <= 10) positives.push('Top 10 AltRank — among the most dominant altcoins socially.');
  else if (coin.alt_rank <= 50) positives.push('Strong AltRank in top 50.');
  else if (coin.alt_rank >= 200) issues.push(`Poor AltRank (#${coin.alt_rank}) — low social dominance.`);

  // Social volume
  if (coin.social_volume > 500000) positives.push('Very high social volume — trending heavily.');
  else if (coin.social_volume > 100000) positives.push('Good social volume — active community.');
  else if (coin.social_volume < 10000) issues.push('Low social volume — limited community buzz.');

  // Sentiment
  if (coin.bullish_sentiment > 0.65) positives.push('Bullish sentiment dominates community discussions.');
  else if (coin.bearish_sentiment > 0.55) issues.push('Bearish sentiment is prevailing — caution warranted.');

  // Price vs social divergence
  if (coin.percent_change_24h > 5 && coin.galaxy_score < 50) {
    issues.push('Price pumping while social score lags — potential unsustainable move.');
  }
  if (coin.percent_change_24h < -5 && coin.galaxy_score > 70) {
    positives.push('Price down but social strength remains — potential accumulation zone.');
  }

  const overall = positives.length > issues.length ? 'BULLISH' : issues.length > positives.length ? 'BEARISH' : 'NEUTRAL';

  return {
    overall,
    score: coin.galaxy_score || 0,
    positives,
    issues,
    summary: generateSummary(coin, overall, positives, issues)
  };
}

function generateSummary(coin, overall, positives, issues) {
  const parts = [`**${coin.symbol}** social analysis: *${overall}*`];
  parts.push(`Galaxy Score: **${coin.galaxy_score || 'N/A'}** | AltRank: **#${coin.alt_rank || 'N/A'}** | Social Vol: **${fmtNum(coin.social_volume)}**`);
  if (positives.length) parts.push('✅ ' + positives[0]);
  if (issues.length) parts.push('⚠️ ' + issues[0]);
  return parts.join('  \n');
}

function fmtNum(n) {
  if (n === undefined || n === null) return 'N/A';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}
