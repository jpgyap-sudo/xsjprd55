// ============================================================
// Whale / Profitable Wallet Tracker — Hyperliquid Integration
// Tracks high-performing wallets via Hyperliquid API and generates
// trading signals from cluster detection + news correlation.
// Ported from wallet-tracker-mvp
// ============================================================

import { logger } from './logger.js';

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';

// ---------- Hyperliquid API Helpers ----------
async function postInfo(body, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(HL_INFO_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function n(v) {
  const num = Number(v ?? 0);
  return Number.isFinite(num) ? num : 0;
}

export async function getClearinghouseState(user) {
  return postInfo({ type: 'clearinghouseState', user });
}

export async function getUserFills(user, startTime, endTime) {
  const body = { type: 'userFills', user };
  if (startTime) body.startTime = startTime;
  if (endTime) body.endTime = endTime;
  return postInfo(body);
}

export async function getUserFunding(user, startTime, endTime) {
  const body = { type: 'userFunding', user, startTime };
  if (endTime) body.endTime = endTime;
  return postInfo(body);
}

// ---------- Wallet Scoring ----------
export function calculateWalletMetrics(fills) {
  const realizedPnls = fills
    .map(f => n(f.closedPnl) - Math.abs(n(f.fee)))
    .filter(v => v !== 0);

  const wins = realizedPnls.filter(v => v > 0).length;
  const losses = realizedPnls.filter(v => v < 0).length;
  const realizedPnl = realizedPnls.reduce((a, b) => a + b, 0);
  const winRate = realizedPnls.length ? wins / realizedPnls.length : 0;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const pnl of realizedPnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const pnlMean = realizedPnls.length ? realizedPnl / realizedPnls.length : 0;
  const variance = realizedPnls.length
    ? realizedPnls.reduce((a, v) => a + Math.pow(v - pnlMean, 2), 0) / realizedPnls.length
    : 0;
  const consistency = variance === 0
    ? (realizedPnl > 0 ? 1 : 0)
    : Math.max(0, Math.min(1, pnlMean / Math.sqrt(variance)));

  const pnlScore = Math.max(0, Math.min(1, realizedPnl / 100000));
  const winScore = winRate;
  const ddScore = Math.max(0, Math.min(1, 1 - maxDrawdown / Math.max(Math.abs(realizedPnl), 1)));
  const consistencyScore = Math.max(0, Math.min(1, consistency));

  const qualityScore = Math.round(100 * (
    pnlScore * 0.30 +
    winScore * 0.25 +
    ddScore * 0.20 +
    consistencyScore * 0.25
  ));

  return {
    realizedPnl,
    winRate: Math.round(winRate * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    avgLeverage: 0,
    consistency: Math.round(consistencyScore * 100) / 100,
    qualityScore,
  };
}

// ---------- Cluster Detection ----------
function directionFromSide(side) {
  const s = String(side).toLowerCase();
  if (s.includes('buy') || s === 'b') return 'LONG';
  if (s.includes('sell') || s === 'a') return 'SHORT';
  return 'NEUTRAL';
}

export function detectClusterSignals(fills, newsScoresByAsset = {}) {
  const grouped = new Map();
  for (const fill of fills) {
    const direction = directionFromSide(fill.side);
    if (direction === 'NEUTRAL') continue;
    const key = `${fill.asset}:${direction}`;
    grouped.set(key, [...(grouped.get(key) || []), fill]);
  }

  const signals = [];
  for (const [key, group] of grouped.entries()) {
    const [asset, direction] = key.split(':');
    const uniqueWalletStrength = group.reduce((a, f) => a + (f.walletScore || 50), 0) / Math.max(group.length, 1);
    const notional = group.reduce((a, f) => a + Math.abs(n(f.sz) * n(f.px)), 0);
    const clusterScore = Math.min(100, group.length * 12 + Math.log10(Math.max(notional, 1)) * 8);
    const walletScore = Math.min(100, uniqueWalletStrength);
    const newsScore = newsScoresByAsset[asset] || 0;
    const confidence = Math.round(walletScore * 0.45 + clusterScore * 0.35 + newsScore * 0.20);

    if (confidence >= 55) {
      signals.push({
        asset,
        direction,
        confidence,
        walletScore,
        clusterScore,
        newsScore,
        liquidationScore: 0,
        rationale: [
          `${group.length} tracked wallet fills detected for ${asset} ${direction}`,
          `Cluster score ${clusterScore.toFixed(1)}`,
          `Average wallet quality ${walletScore.toFixed(1)}`,
          newsScore ? `News score ${newsScore}` : 'No strong news confirmation yet',
        ],
      });
    }
  }
  return signals.sort((a, b) => b.confidence - a.confidence);
}

// ---------- News Correlation ----------
export function scoreRecentNewsByAsset(news, lookbackMinutes = 60) {
  const cutoff = Date.now() - lookbackMinutes * 60_000;
  const scores = {};
  for (const item of news) {
    if (!item.asset || new Date(item.publishedAt).getTime() < cutoff) continue;
    const score = Math.max(-100, Math.min(100, item.sentiment * item.importance * 100));
    scores[item.asset] = (scores[item.asset] || 0) + score;
  }
  for (const asset of Object.keys(scores)) {
    scores[asset] = Math.max(-100, Math.min(100, scores[asset]));
  }
  return scores;
}

// ---------- Signal Conversion ----------
export function convertWalletSignalToTradingSignal(walletSignal) {
  const isBullish = walletSignal.direction === 'LONG';
  const asset = walletSignal.asset;
  // Map Hyperliquid asset names to trading symbols
  const symbolMap = {
    'BTC': 'BTCUSDT',
    'ETH': 'ETHUSDT',
    'SOL': 'SOLUSDT',
    'BNB': 'BNBUSDT',
    'XRP': 'XRPUSDT',
    'DOGE': 'DOGEUSDT',
    'ADA': 'ADAUSDT',
    'AVAX': 'AVAXUSDT',
    'LINK': 'LINKUSDT',
    'MATIC': 'MATICUSDT',
    'ARB': 'ARBUSDT',
    'OP': 'OPUSDT',
    'SUI': 'SUIUSDT',
    'SEI': 'SEIUSDT',
    'TIA': 'TIAUSDT',
    'HYPE': 'HYPEUSDT',
  };
  const symbol = symbolMap[asset] || `${asset}USDT`;

  return {
    id: `whale_${asset}_${Date.now()}`,
    symbol,
    side: walletSignal.direction,
    entry_price: null, // Will be filled from current market price
    stop_loss: null,
    take_profit: [],
    confidence: Math.min(walletSignal.confidence / 100, 0.95),
    strategy: 'WalletTracker_Hyperliquid',
    timeframe: '1h',
    generated_at: new Date().toISOString(),
    valid_until: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), // 6h validity
    source: 'wallet_tracker',
    mode: 'paper',
    metadata: {
      whale_signal_type: walletSignal.direction,
      cluster_score: walletSignal.clusterScore,
      wallet_score: walletSignal.walletScore,
      news_score: walletSignal.newsScore,
      rationale: walletSignal.rationale,
      asset,
    },
  };
}

// ---------- Main Tracker Runner ----------
/**
 * Run wallet tracker for a list of tracked wallet addresses.
 * @param {Array<{address:string, label?:string}>} wallets
 * @param {Array<{asset:string, title:string, sentiment:number, importance:number, publishedAt:string}>} recentNews
 * @returns {Promise<{snapshots:Array, signals:Array, metrics:Object}>}
 */
export async function runWalletTracker(wallets, recentNews = []) {
  const results = { snapshots: [], signals: [], metrics: {} };
  const recentFillsForCluster = [];
  const startTime = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
  const clusterCutoff = Date.now() - 60 * 60 * 1000; // 1 hour

  for (const wallet of wallets) {
    try {
      const [state, fills] = await Promise.all([
        getClearinghouseState(wallet.address),
        getUserFills(wallet.address, startTime),
      ]);

      // Save snapshot
      results.snapshots.push({
        address: wallet.address,
        label: wallet.label,
        accountValue: n(state?.marginSummary?.accountValue),
        withdrawable: n(state?.withdrawable),
        marginUsed: n(state?.marginSummary?.totalMarginUsed),
        raw: state,
        timestamp: new Date().toISOString(),
      });

      // Normalize fills
      const normalized = Array.isArray(fills) ? fills : [];

      // Calculate metrics
      const metrics = calculateWalletMetrics(normalized);
      results.metrics[wallet.address] = { ...metrics, label: wallet.label };

      // Collect recent fills for cluster detection
      for (const f of normalized) {
        if (n(f.time) >= clusterCutoff) {
          recentFillsForCluster.push({
            asset: String(f.coin || f.asset || 'UNKNOWN'),
            side: String(f.side || 'UNKNOWN'),
            sz: n(f.sz),
            px: n(f.px),
            time: new Date(n(f.time)),
            walletScore: metrics.qualityScore,
            walletAddress: wallet.address,
          });
        }
      }
    } catch (err) {
      logger.error(`[WALLET-TRACKER] Failed for ${wallet.address}: ${err.message}`);
    }
  }

  // Score news
  const newsScores = scoreRecentNewsByAsset(recentNews);

  // Detect clusters
  const clusterSignals = detectClusterSignals(recentFillsForCluster, newsScores);
  results.signals = clusterSignals.map(s => convertWalletSignalToTradingSignal(s));

  logger.info(`[WALLET-TRACKER] Processed ${wallets.length} wallets, found ${clusterSignals.length} cluster signals`);
  return results;
}
