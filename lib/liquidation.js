// ============================================================
// lib/liquidation.js — Liquidation Intelligence Engine v2
// Aggregates OI, funding, volume from OKX | Hyperliquid | Bybit | Binance
// Returns TOP 10 long/short recommendations + squeeze alerts
// No auth required for any endpoint (public market data)
// ============================================================

const OKX_BASE = 'https://www.okx.com';
const HL_BASE = 'https://api.hyperliquid.xyz';
const BYBIT_BASE = 'https://api.bybit.com';
const BINANCE_BASE = 'https://fapi.binance.com';

// Robust fetch with timeout + abort
async function fetchJson(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

// Normalize symbol to base asset (e.g. BTC-USDT-SWAP → BTC, BTCUSDT → BTC)
function normalizeSymbol(raw, exchange) {
  let s = String(raw).toUpperCase();
  s = s.replace(/-?PERP$/i, '').replace(/-?SWAP$/i, '').replace(/-?USDC?$/i, '').replace(/_?USDC?$/i, '');
  if (exchange === 'okx') {
    const m = s.match(/^([A-Z0-9]+)-/);
    return m ? m[1] : s;
  }
  if (exchange === 'hyperliquid') return s;
  if (exchange === 'bybit') {
    return s.replace(/USDC?$/, '').replace(/USD$/, '');
  }
  if (exchange === 'binance') {
    return s.replace(/USDC?$/, '').replace(/USD$/, '');
  }
  return s;
}

// ---------- OKX ----------
async function fetchOkxData() {
  const [tickers, oiData, funding] = await Promise.all([
    fetchJson(`${OKX_BASE}/api/v5/market/tickers?instType=SWAP`, {}, 7000),
    fetchJson(`${OKX_BASE}/api/v5/public/open-interest?instType=SWAP`, {}, 7000),
    fetchOkxFundingBatch()
  ]);

  const NON_CRYPTO = new Set(['MSTR','TSLA','NVDA','COIN','AMD','META','GOOGL','AAPL','AMZN','MSFT','NFLX','BABA','PLTR','HOOD','ARKK','BITO','GBTC','QQQ','SPY','TLT','GLD','SLV','USO','UNG','DXY','VIX','EUR','GBP','JPY']);

  // Build OI map
  const oiMap = new Map();
  for (const o of (oiData?.data || [])) {
    const sym = normalizeSymbol(o.instId, 'okx');
    if (NON_CRYPTO.has(sym)) continue;
    oiMap.set(sym, {
      oi: parseFloat(o.oi) || 0,
      oiCcy: parseFloat(o.oiCcy) || 0
    });
  }

  const result = {};
  for (const t of (tickers?.data || [])) {
    const sym = normalizeSymbol(t.instId, 'okx');
    if (NON_CRYPTO.has(sym)) continue;
    const last = parseFloat(t.last) || 0;
    const open = parseFloat(t.sodUtc0) || last;
    const fundData = funding.get(sym) || {};
    const oi = oiMap.get(sym) || {};
    const oiUsd = (oi.oiCcy || 0) * last;

    result[sym] = {
      exchange: 'okx',
      symbol: sym,
      price: last,
      change24h: open ? ((last - open) / open) * 100 : 0,
      volume24h: parseFloat(t.volCcy24h) || 0,
      openInterest: oi.oiCcy || 0,
      openInterestUsd: oiUsd,
      fundingRate: fundData.fundingRate || 0,
      nextFundingTime: fundData.nextFundingTime || null
    };
  }
  return result;
}

async function fetchOkxFundingBatch() {
  const topSymbols = [
    'BTC-USDT-SWAP','ETH-USDT-SWAP','SOL-USDT-SWAP','BNB-USDT-SWAP','XRP-USDT-SWAP',
    'DOGE-USDT-SWAP','ADA-USDT-SWAP','AVAX-USDT-SWAP','LINK-USDT-SWAP','LTC-USDT-SWAP',
    'DOT-USDT-SWAP','UNI-USDT-SWAP','AAVE-USDT-SWAP','SUI-USDT-SWAP','SEI-USDT-SWAP',
    'INJ-USDT-SWAP','RNDR-USDT-SWAP','ARB-USDT-SWAP','OP-USDT-SWAP','STRK-USDT-SWAP',
    'TIA-USDT-SWAP','FET-USDT-SWAP','WLD-USDT-SWAP','PYTH-USDT-SWAP','JUP-USDT-SWAP',
    'JTO-USDT-SWAP','BONK-USDT-SWAP','PEPE-USDT-SWAP','WIF-USDT-SWAP','SHIB-USDT-SWAP',
    'FLOKI-USDT-SWAP','ENA-USDT-SWAP','W-USDT-SWAP','TAO-USDT-SWAP','ARKM-USDT-SWAP',
    'MEME-USDT-SWAP','BEAM-USDT-SWAP','RUNE-USDT-SWAP','NEAR-USDT-SWAP','APT-USDT-SWAP',
    'TRX-USDT-SWAP','ETC-USDT-SWAP','XLM-USDT-SWAP','FIL-USDT-SWAP','ALGO-USDT-SWAP',
    'ATOM-USDT-SWAP','IMX-USDT-SWAP','GRT-USDT-SWAP','STX-USDT-SWAP','FLOW-USDT-SWAP',
    'SAND-USDT-SWAP','MANA-USDT-SWAP','AXS-USDT-SWAP','CHZ-USDT-SWAP','CRV-USDT-SWAP',
    'DYDX-USDT-SWAP','GMX-USDT-SWAP','SNX-USDT-SWAP','COMP-USDT-SWAP','MKR-USDT-SWAP',
    'YFI-USDT-SWAP','BAL-USDT-SWAP','1INCH-USDT-SWAP','ZRX-USDT-SWAP','LDO-USDT-SWAP',
    'PENDLE-USDT-SWAP','ZRO-USDT-SWAP'
  ];

  const results = new Map();
  await Promise.all(topSymbols.map(async (instId) => {
    const data = await fetchJson(`${OKX_BASE}/api/v5/public/funding-rate?instId=${instId}`, {}, 4000);
    if (data?.data?.[0]) {
      const sym = normalizeSymbol(instId, 'okx');
      results.set(sym, {
        fundingRate: parseFloat(data.data[0].fundingRate) || 0,
        nextFundingTime: data.data[0].nextFundingTime
      });
    }
  }));
  return results;
}

// ---------- Hyperliquid ----------
async function fetchHyperliquidData() {
  const data = await fetchJson(`${HL_BASE}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'perpMetaAndAssetCtxs' })
  }, 7000);

  if (!Array.isArray(data) || data.length < 2) return {};

  const meta = data[0];
  const ctxs = data[1];

  const result = {};
  if (meta?.universe && Array.isArray(ctxs)) {
    meta.universe.forEach((asset, i) => {
      const ctx = ctxs[i];
      if (!ctx) return;
      const sym = asset.name.toUpperCase();
      const price = parseFloat(ctx.markPx) || 0;
      const prevPrice = parseFloat(ctx.prevDayPx) || price;
      const change24h = prevPrice ? ((price - prevPrice) / prevPrice) * 100 : 0;
      const oiCoins = parseFloat(ctx.openInterest) || 0;
      const oiUsd = oiCoins * price;

      result[sym] = {
        exchange: 'hyperliquid',
        symbol: sym,
        price,
        change24h: isFinite(change24h) ? change24h : 0,
        volume24h: parseFloat(ctx.dayNtlVlm) || 0,
        openInterest: oiCoins,
        openInterestUsd: oiUsd,
        fundingRate: parseFloat(ctx.funding) || 0,
        premium: parseFloat(ctx.premium) || 0
      };
    });
  }
  return result;
}

// ---------- Bybit ----------
async function fetchBybitData() {
  const [tickers, funding] = await Promise.all([
    fetchJson(`${BYBIT_BASE}/v5/market/tickers?category=linear`, {}, 7000),
    fetchBybitFundingBatch()
  ]);

  const result = {};
  for (const t of (tickers?.result?.list || [])) {
    const sym = normalizeSymbol(t.symbol, 'bybit');
    const last = parseFloat(t.lastPrice) || 0;
    const oiUsd = parseFloat(t.openInterestValue) || 0;
    const fundData = funding.get(sym) || {};

    result[sym] = {
      exchange: 'bybit',
      symbol: sym,
      price: last,
      change24h: parseFloat(t.price24hPcnt) * 100 || 0,
      volume24h: parseFloat(t.turnover24h) || 0,
      openInterest: parseFloat(t.openInterest) || 0,
      openInterestUsd: oiUsd,
      fundingRate: fundData.fundingRate || 0,
      nextFundingTime: fundData.nextFundingTime || null
    };
  }
  return result;
}

async function fetchBybitFundingBatch() {
  const results = new Map();
  try {
    const data = await fetchJson(`${BYBIT_BASE}/v5/market/tickers?category=linear`, {}, 7000);
    for (const t of (data?.result?.list || [])) {
      const sym = normalizeSymbol(t.symbol, 'bybit');
      results.set(sym, {
        fundingRate: parseFloat(t.fundingRate) || 0,
        nextFundingTime: t.nextFundingTime
      });
    }
  } catch (e) {}
  return results;
}

// ---------- Binance ----------
async function fetchBinanceData() {
  const [tickers, funding] = await Promise.all([
    fetchJson(`${BINANCE_BASE}/fapi/v1/ticker/24hr`, {}, 7000),
    fetchBinanceFundingBatch()
  ]);

  const result = {};
  for (const t of (tickers || [])) {
    if (!t.symbol?.includes('USDT')) continue;
    const sym = normalizeSymbol(t.symbol, 'binance');
    const last = parseFloat(t.lastPrice) || 0;
    const fundData = funding.get(sym) || {};

    result[sym] = {
      exchange: 'binance',
      symbol: sym,
      price: last,
      change24h: parseFloat(t.priceChangePercent) || 0,
      volume24h: parseFloat(t.quoteVolume) || 0,
      openInterest: 0, // would need separate OI endpoint
      openInterestUsd: 0,
      fundingRate: fundData.fundingRate || 0,
      nextFundingTime: fundData.nextFundingTime || null
    };
  }
  return result;
}

async function fetchBinanceFundingBatch() {
  const results = new Map();
  try {
    const data = await fetchJson(`${BINANCE_BASE}/fapi/v1/premiumIndex`, {}, 7000);
    for (const d of (data || [])) {
      if (!d.symbol?.includes('USDT')) continue;
      const sym = normalizeSymbol(d.symbol, 'binance');
      results.set(sym, {
        fundingRate: parseFloat(d.lastFundingRate) || 0,
        nextFundingTime: d.nextFundingTime
      });
    }
  } catch (e) {}
  return results;
}

// ---------- Aggregation ----------
function aggregateBySymbol(maps) {
  const agg = {};
  for (const map of maps) {
    for (const [sym, data] of Object.entries(map)) {
      if (!agg[sym]) {
        agg[sym] = {
          symbol: sym,
          exchanges: {},
          prices: [],
          fundingRates: [],
          volumes24h: [],
          oisUsd: [],
          changes24h: [],
          oisCoins: []
        };
      }
      agg[sym].exchanges[data.exchange] = data;
      if (data.price) agg[sym].prices.push(data.price);
      if (data.fundingRate !== undefined) agg[sym].fundingRates.push(data.fundingRate);
      if (data.volume24h) agg[sym].volumes24h.push(data.volume24h);
      if (data.openInterestUsd) agg[sym].oisUsd.push(data.openInterestUsd);
      if (data.openInterest) agg[sym].oisCoins.push(data.openInterest);
      if (data.change24h !== undefined) agg[sym].changes24h.push(data.change24h);
    }
  }

  for (const sym in agg) {
    const a = agg[sym];
    a.price = a.prices.length ? a.prices.reduce((s, v) => s + v, 0) / a.prices.length : 0;
    a.fundingRate = a.fundingRates.length ? a.fundingRates.reduce((s, v) => s + v, 0) / a.fundingRates.length : 0;
    a.volume24h = a.volumes24h.length ? a.volumes24h.reduce((s, v) => s + v, 0) : 0;
    a.openInterestUsd = a.oisUsd.length ? a.oisUsd.reduce((s, v) => s + v, 0) : (a.oisCoins.length ? a.oisCoins.reduce((s, v) => s + v, 0) * a.price : 0);
    a.openInterest = a.oisCoins.length ? a.oisCoins.reduce((s, v) => s + v, 0) : 0;
    a.change24h = a.changes24h.length ? a.changes24h.reduce((s, v) => s + v, 0) / a.changes24h.length : 0;

    // Annualized funding (8h → daily × 3 → yearly × 365)
    a.fundingAnnualized = a.fundingRate * 3 * 365;
    a.funding8h = a.fundingRate;

    delete a.prices;
    delete a.fundingRates;
    delete a.volumes24h;
    delete a.oisUsd;
    delete a.oisCoins;
    delete a.changes24h;
  }

  return agg;
}

function computeSignals(agg) {
  const coins = Object.values(agg).filter(c => c.price > 0 && c.volume24h >= 100_000);
  const alerts = [];

  const scored = coins.map(c => {
    let shortScore = 0;
    let longScore = 0;

    const fund = c.fundingRate;
    const fundAnn = c.fundingAnnualized || 0;
    const oiUsd = c.openInterestUsd || 0;

    // Funding extremes — lowered thresholds for relative ranking
    // Even small positive funding = slight short bias; negative = slight long bias
    if (fund > 0.00001) shortScore += Math.min(fund * 5000, 25);
    if (fund < -0.00001) longScore += Math.min(Math.abs(fund) * 5000, 25);
    if (fund > 0.0001) shortScore += 15;
    if (fund < -0.0001) longScore += 15;
    if (fund > 0.0003) shortScore += 15;
    if (fund < -0.0003) longScore += 15;
    if (fund > 0.001) shortScore += 15; // extreme
    if (fund < -0.001) longScore += 15;

    // OI fuel — bigger OI = more liquidation potential
    const oiScore = oiUsd > 0 ? Math.min(Math.log10(oiUsd + 1) * 4, 20) : 2;
    shortScore += oiScore;
    longScore += oiScore;

    // Price divergence boost
    if (fund > 0.00005 && c.change24h < -2) shortScore += 12;
    if (fund < -0.00005 && c.change24h > 2) longScore += 12;

    // Volume confirmation
    if (c.volume24h > 10_000_000) {
      shortScore += 3;
      longScore += 3;
    }
    if (c.volume24h > 50_000_000) {
      shortScore += 3;
      longScore += 3;
    }

    // Risk score 0-100 (higher = more risky/overleveraged to the long side)
    let riskScore = 50;
    riskScore += Math.min(fundAnn / 3, 25);
    riskScore += oiUsd > 0 ? Math.min(Math.log10(oiUsd + 1) * 2, 15) : 0;
    riskScore += c.change24h > 5 ? -10 : c.change24h < -5 ? 10 : 0;
    riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));

    return { ...c, shortScore, longScore, riskScore };
  });

  // Top 10 shorts (highest shortScore) — always return 10 if available
  const topShorts = scored
    .filter(c => c.shortScore > 0)
    .sort((a, b) => b.shortScore - a.shortScore)
    .slice(0, 10)
    .map(c => ({
      symbol: c.symbol,
      side: 'SHORT',
      confidence: Math.min(c.shortScore / 100, 0.95),
      price: c.price,
      funding8h: c.funding8h,
      fundingAnnualized: c.fundingAnnualized,
      openInterestUsd: c.openInterestUsd,
      openInterest: c.openInterest,
      riskScore: c.riskScore,
      change24h: c.change24h,
      reason: `${c.symbol} — funding ${c.fundingAnnualized?.toFixed(1)}% ann. (${c.funding8h > 0 ? '+' : ''}${(c.funding8h * 100).toFixed(4)}% / 8h) · OI $${formatM(c.openInterestUsd)} · 24h ${c.change24h >= 0 ? '+' : ''}${c.change24h.toFixed(2)}% · Risk ${c.riskScore}/100`
    }));

  // Top 10 longs (highest longScore) — always return 10 if available
  const topLongs = scored
    .filter(c => c.longScore > 0)
    .sort((a, b) => b.longScore - a.longScore)
    .slice(0, 10)
    .map(c => ({
      symbol: c.symbol,
      side: 'LONG',
      confidence: Math.min(c.longScore / 100, 0.95),
      price: c.price,
      funding8h: c.funding8h,
      fundingAnnualized: c.fundingAnnualized,
      openInterestUsd: c.openInterestUsd,
      openInterest: c.openInterest,
      riskScore: c.riskScore,
      change24h: c.change24h,
      reason: `${c.symbol} — funding ${c.fundingAnnualized?.toFixed(1)}% ann. (${c.funding8h > 0 ? '+' : ''}${(c.funding8h * 100).toFixed(4)}% / 8h) · OI $${formatM(c.openInterestUsd)} · 24h ${c.change24h >= 0 ? '+' : ''}${c.change24h.toFixed(2)}% · Risk ${c.riskScore}/100`
    }));

  // Best single picks
  const bestShort = topShorts[0] || null;
  const bestLong = topLongs[0] || null;

  // Alerts
  for (const c of scored) {
    const fundAnn = c.fundingAnnualized;
    if (fundAnn > 100) {
      alerts.push({
        type: 'overleveraged_longs',
        severity: fundAnn > 200 ? 'high' : 'medium',
        symbol: c.symbol,
        message: `${c.symbol}: funding ${fundAnn.toFixed(1)}% annualized — crowded longs`
      });
    }
    if (fundAnn < -100) {
      alerts.push({
        type: 'overleveraged_shorts',
        severity: fundAnn < -200 ? 'high' : 'medium',
        symbol: c.symbol,
        message: `${c.symbol}: funding ${fundAnn.toFixed(1)}% annualized — crowded shorts`
      });
    }
  }

  return {
    coins: scored.slice(0, 30),
    alerts: alerts.slice(0, 15),
    topShorts,
    topLongs,
    bestShort,
    bestLong
  };
}

function formatM(usd) {
  if (!usd || usd <= 0) return '0.0M';
  if (usd >= 1e9) return (usd / 1e9).toFixed(2) + 'B';
  if (usd >= 1e6) return (usd / 1e6).toFixed(1) + 'M';
  return (usd / 1e3).toFixed(1) + 'K';
}

// ---------- Public API ----------
export async function buildLiquidationOverview() {
  const start = Date.now();
  const [okx, hyperliquid, bybit, binance] = await Promise.all([
    fetchOkxData().catch(() => ({})),
    fetchHyperliquidData().catch(() => ({})),
    fetchBybitData().catch(() => ({})),
    fetchBinanceData().catch(() => ({}))
  ]);

  const agg = aggregateBySymbol([okx, hyperliquid, bybit, binance]);
  const signals = computeSignals(agg);

  const allCoins = Object.values(agg);
  const totalOi = allCoins.reduce((s, c) => s + (c.openInterestUsd || 0), 0);
  const avgFunding = allCoins.length ? allCoins.reduce((s, c) => s + (c.fundingRate || 0), 0) / allCoins.length : 0;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - start,
    summary: {
      sources: ['okx', 'hyperliquid', 'bybit', 'binance'],
      totalCoinsTracked: allCoins.length,
      totalOpenInterestUsd: Math.round(totalOi),
      averageFundingRate: avgFunding,
      averageFundingAnnualized: avgFunding * 3 * 365,
      dominantSentiment: avgFunding > 0.0003 ? 'bullish_leverage' : avgFunding < -0.0003 ? 'bearish_leverage' : 'neutral'
    },
    ...signals
  };
}

// Format for Telegram broadcast
export function formatLiquidationTelegram(data) {
  const ts = new Date(data.generatedAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });

  let msg = `💥 *Liquidation Intel — ${ts}*\n\n`;

  msg += `*📉 TOP 10 SHORT SETUPS*\n`;
  if (data.topShorts?.length) {
    data.topShorts.forEach((c, i) => {
      msg += `${i + 1}. 🔴 *${c.symbol}* @ $${c.price.toLocaleString(undefined, { maximumFractionDigits: c.price > 100 ? 0 : c.price > 1 ? 2 : 4 })}\n`;
      msg += `   Funding: ${c.fundingAnnualized.toFixed(1)}% ann. · OI: ${formatM(c.openInterestUsd)} · Risk: ${c.riskScore}/100\n`;
    });
  } else {
    msg += `_No strong short setups found_\n`;
  }

  msg += `\n*📈 TOP 10 LONG SETUPS*\n`;
  if (data.topLongs?.length) {
    data.topLongs.forEach((c, i) => {
      msg += `${i + 1}. 🟢 *${c.symbol}* @ $${c.price.toLocaleString(undefined, { maximumFractionDigits: c.price > 100 ? 0 : c.price > 1 ? 2 : 4 })}\n`;
      msg += `   Funding: ${c.fundingAnnualized.toFixed(1)}% ann. · OI: ${formatM(c.openInterestUsd)} · Risk: ${c.riskScore}/100\n`;
    });
  } else {
    msg += `_No strong long setups found_\n`;
  }

  if (data.alerts?.length) {
    msg += `\n*⚡ Active Alerts*\n`;
    data.alerts.slice(0, 5).forEach(a => {
      const emoji = a.severity === 'high' ? '🔴' : '🟡';
      msg += `${emoji} ${a.message}\n`;
    });
  }

  msg += `\n_Updated: ${ts}_ · ${data.summary?.totalCoinsTracked || 0} coins tracked`;
  return msg;
}
