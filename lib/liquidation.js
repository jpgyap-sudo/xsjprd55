// ============================================================
// lib/liquidation.js — Liquidation Intelligence Engine
// Aggregates OI, funding, volume from OKX | Hyperliquid | Deribit | Crypto.com
// No auth required for any endpoint (public market data)
// ============================================================

const OKX_BASE = 'https://www.okx.com';
const HL_BASE = 'https://api.hyperliquid.xyz';
const DERIBIT_BASE = 'https://www.deribit.com';
const CRYPTO_COM_BASE = 'https://api.crypto.com/exchange/v1';

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

// Normalize symbol to base asset (e.g. BTC-USDT-SWAP → BTC)
function normalizeSymbol(raw, exchange) {
  let s = String(raw).toUpperCase();
  // Strip common USDT/USD quote suffixes so BTCUSDT, BTCUSD, BTC-USDT, BTC_USD all → BTC
  s = s.replace(/-?USDC?-SWAP$/i, '').replace(/-?USDC?$/i, '').replace(/_?USDC?$/i, '');
  if (exchange === 'okx') {
    const m = s.match(/^([A-Z0-9]+)-/);
    return m ? m[1] : s;
  }
  if (exchange === 'hyperliquid') return s;
  if (exchange === 'deribit') {
    const m = s.match(/^([A-Z0-9]+)-/);
    return m ? m[1] : s;
  }
  if (exchange === 'cryptocom') {
    return s.replace(/USD.*$/, '').replace(/_.*$/, '');
  }
  return s;
}

// ---------- OKX ----------
async function fetchOkxData() {
  const [tickers, oi, funding] = await Promise.all([
    fetchJson(`${OKX_BASE}/api/v5/market/tickers?instType=SWAP`, {}, 7000),
    fetchJson(`${OKX_BASE}/api/v5/public/open-interest?instType=SWAP`, {}, 7000),
    fetchOkxFundingBatch()
  ]);

  const tickerMap = new Map();
  if (tickers?.data) {
    for (const t of tickers.data) {
      const sym = normalizeSymbol(t.instId, 'okx');
      const last = parseFloat(t.last) || 0;
      const open = parseFloat(t.sodUtc0) || last;
      tickerMap.set(sym, {
        price: last,
        change24h: open ? ((last - open) / open) * 100 : 0,
        volume24h: parseFloat(t.volCcy24h) || 0,
        high24h: parseFloat(t.high24h) || 0,
        low24h: parseFloat(t.low24h) || 0
      });
    }
  }

  const NON_CRYPTO = new Set(['MSTR','TSLA','NVDA','COIN','AMD','META','GOOGL','AAPL','AMZN','MSFT','NFLX','BABA','PLTR','HOOD','ARKK','BITO','GBTC','QQQ','SPY','TLT','GLD','SLV','USO','UNG','DXY','VIX','EUR','GBP','JPY']);

  const oiMap = new Map();
  if (oi?.data) {
    for (const o of oi.data) {
      const sym = normalizeSymbol(o.instId, 'okx');
      if (NON_CRYPTO.has(sym)) continue;
      const oiCcy = parseFloat(o.oiCcy) || 0;
      const isUsdtMargined = String(o.instId).includes('-USDT-');
      oiMap.set(sym, {
        openInterest: parseFloat(o.oi) || 0,
        openInterestCcy: oiCcy,
        isUsdtMargined
      });
    }
  }

  const result = {};
  for (const [sym, ticker] of tickerMap) {
    if (NON_CRYPTO.has(sym)) continue;
    const oiData = oiMap.get(sym) || {};
    const fundData = funding.get(sym) || {};
    const openInterestUsd = oiData.isUsdtMargined
      ? (oiData.openInterestCcy || 0)          // already in USDT terms
      : (oiData.openInterestCcy || 0) * (ticker.price || 0); // base currency → USD
    result[sym] = {
      exchange: 'okx',
      symbol: sym,
      price: ticker.price,
      change24h: isFinite(ticker.change24h) ? ticker.change24h : 0,
      volume24h: ticker.volume24h,
      openInterest: oiData.openInterest || 0,
      openInterestUsd,
      fundingRate: fundData.fundingRate || 0,
      nextFundingTime: fundData.nextFundingTime || null
    };
  }
  return result;
}

async function fetchOkxFundingBatch() {
  const topSymbols = [
    'BTC-USDT-SWAP','ETH-USDT-SWAP','SOL-USDT-SWAP','BNB-USDT-SWAP',
    'XRP-USDT-SWAP','DOGE-USDT-SWAP','ADA-USDT-SWAP','AVAX-USDT-SWAP',
    'TRX-USDT-SWAP','DOT-USDT-SWAP','LINK-USDT-SWAP','MATIC-USDT-SWAP',
    'LTC-USDT-SWAP','BCH-USDT-SWAP','ETC-USDT-SWAP','SUI-USDT-SWAP',
    'SEI-USDT-SWAP','ARB-USDT-SWAP','OP-USDT-SWAP','STRK-USDT-SWAP'
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

// ---------- Deribit ----------
async function fetchDeribitData() {
  const currencies = ['BTC', 'ETH', 'SOL'];
  const summaries = await Promise.all(currencies.map(async (curr) => {
    const data = await fetchJson(`${DERIBIT_BASE}/api/v2/public/get_book_summary_by_currency?currency=${curr}&kind=future`, {}, 5000);
    return data?.result || [];
  }));

  const fundingData = await Promise.all(currencies.map(async (curr) => {
    const inst = `${curr}-PERPETUAL`;
    const data = await fetchJson(`${DERIBIT_BASE}/api/v2/public/get_funding_rate_value?instrument_name=${inst}&start_timestamp=${Date.now() - 86400000}&end_timestamp=${Date.now()}`, {}, 4000);
    return { symbol: curr, funding: data?.result || 0 };
  }));

  const fundingMap = new Map();
  for (const f of fundingData) {
    fundingMap.set(f.symbol, parseFloat(f.funding) || 0);
  }

  const result = {};
  for (const list of summaries) {
    for (const s of list) {
      if (!s.instrument_name?.includes('PERPETUAL')) continue;
      const sym = normalizeSymbol(s.instrument_name, 'deribit');
      const price = s.mark_price || s.last_price || 0;
      const oiUsd = s.open_interest || 0;
      const volume24h = s.volume || 0;
      const change24h = s.price_change || 0;

      result[sym] = {
        exchange: 'deribit',
        symbol: sym,
        price,
        change24h,
        volume24h,
        openInterest: 0,
        openInterestUsd: oiUsd,
        fundingRate: fundingMap.get(sym) || 0
      };
    }
  }
  return result;
}

// ---------- Crypto.com ----------
async function fetchCryptoComData() {
  const [tickers, valuations] = await Promise.all([
    fetchJson(`${CRYPTO_COM_BASE}/public/get-tickers`, {}, 5000),
    fetchJson(`${CRYPTO_COM_BASE}/public/get-valuations`, {}, 5000)
  ]);

  const fundingMap = new Map();
  if (valuations?.result?.data) {
    for (const v of valuations.result.data) {
      const sym = normalizeSymbol(v.i, 'cryptocom');
      fundingMap.set(sym, parseFloat(v.r) || 0);
    }
  }

  const result = {};
  if (tickers?.result?.data) {
    for (const t of tickers.result.data) {
      if (!t.i?.includes('PERP')) continue;
      const sym = normalizeSymbol(t.i, 'cryptocom');
      const price = parseFloat(t.a) || 0;
      const change24h = parseFloat(t.c) || 0;
      const volume24h = parseFloat(t.v) || 0;
      const oi = parseFloat(t.oi) || 0;

      result[sym] = {
        exchange: 'cryptocom',
        symbol: sym,
        price,
        change24h,
        volume24h,
        openInterest: 0,
        openInterestUsd: oi,
        fundingRate: fundingMap.get(sym) || 0
      };
    }
  }
  return result;
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
          changes24h: []
        };
      }
      agg[sym].exchanges[data.exchange] = data;
      if (data.price) agg[sym].prices.push(data.price);
      if (data.fundingRate !== undefined) agg[sym].fundingRates.push(data.fundingRate);
      if (data.volume24h) agg[sym].volumes24h.push(data.volume24h);
      if (data.openInterestUsd) agg[sym].oisUsd.push(data.openInterestUsd);
      if (data.change24h !== undefined) agg[sym].changes24h.push(data.change24h);
    }
  }

  for (const sym in agg) {
    const a = agg[sym];
    a.price = a.prices.length ? a.prices.reduce((s, v) => s + v, 0) / a.prices.length : 0;
    a.fundingRate = a.fundingRates.length ? a.fundingRates.reduce((s, v) => s + v, 0) / a.fundingRates.length : 0;
    a.volume24h = a.volumes24h.length ? a.volumes24h.reduce((s, v) => s + v, 0) : 0;
    a.openInterestUsd = a.oisUsd.length ? a.oisUsd.reduce((s, v) => s + v, 0) : 0;
    a.change24h = a.changes24h.length ? a.changes24h.reduce((s, v) => s + v, 0) / a.changes24h.length : 0;

    // Annualized funding (8h → daily × 3 → yearly × 365)
    a.fundingAnnualized = a.fundingRate * 3 * 365;
    a.funding8h = a.fundingRate;

    delete a.prices;
    delete a.fundingRates;
    delete a.volumes24h;
    delete a.oisUsd;
    delete a.changes24h;
  }

  return agg;
}

function computeSignals(agg) {
  const coins = Object.values(agg).filter(c => c.price > 0 && c.volume24h >= 500_000);
  const alerts = [];

  const scored = coins.map(c => {
    let shortScore = 0;
    let longScore = 0;

    const fund = c.fundingRate;
    const fundAnn = c.fundingAnnualized || 0;

    // Funding extremes
    if (fund > 0.0005) shortScore += Math.min(fund * 4000, 35);
    if (fund < -0.0005) longScore += Math.min(Math.abs(fund) * 4000, 35);
    if (fund > 0.001) shortScore += 15; // very extreme
    if (fund < -0.001) longScore += 15;

    // OI fuel
    const oiScore = Math.min(Math.log10(c.openInterestUsd + 1) * 4, 15);
    shortScore += oiScore;
    longScore += oiScore;

    // Divergence
    if (fund > 0.0003 && c.change24h < -1) shortScore += 20;
    if (fund < -0.0003 && c.change24h > 1) longScore += 20;

    // Squeeze candidate
    const isSqueezeCandidate = c.openInterestUsd > 5e7 && Math.abs(fund) > 0.0003;

    // Risk score 0-100 (higher = more risky/overleveraged to the long side)
    let riskScore = 50;
    riskScore += Math.min(fundAnn / 4, 20);
    riskScore += Math.min(Math.log10(c.openInterestUsd + 1) * 2.5, 15);
    riskScore += c.change24h > 5 ? -8 : c.change24h < -5 ? 8 : 0;
    riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));

    return { ...c, shortScore, longScore, isSqueezeCandidate, riskScore };
  });

  scored.sort((a, b) => b.shortScore - a.shortScore);
  const bestShort = scored.find(c => c.shortScore >= 20) || null;
  scored.sort((a, b) => b.longScore - a.longScore);
  const bestLong = scored.find(c => c.longScore >= 20) || null;

  // Alerts
  for (const c of scored) {
    const fundAnn = c.fundingAnnualized;
    if (fundAnn > 100) {
      alerts.push({
        type: 'overleveraged_longs',
        severity: fundAnn > 200 ? 'high' : 'medium',
        symbol: c.symbol,
        message: `${c.symbol}: funding ${fundAnn.toFixed(1)}% annualized — crowded longs, short squeeze risk or good short entry`
      });
    }
    if (fundAnn < -100) {
      alerts.push({
        type: 'overleveraged_shorts',
        severity: fundAnn < -200 ? 'high' : 'medium',
        symbol: c.symbol,
        message: `${c.symbol}: funding ${fundAnn.toFixed(1)}% annualized — crowded shorts, long squeeze risk or good long entry`
      });
    }
    if (c.isSqueezeCandidate) {
      alerts.push({
        type: 'squeeze',
        severity: 'medium',
        symbol: c.symbol,
        message: `${c.symbol}: high OI ($${(c.openInterestUsd/1e6).toFixed(1)}M) with skewed funding — squeeze candidate`
      });
    }
  }

  return {
    coins: scored.slice(0, 20),
    alerts: alerts.slice(0, 12),
    bestShort: bestShort ? {
      symbol: bestShort.symbol,
      confidence: Math.min(bestShort.shortScore / 100, 0.95),
      price: bestShort.price,
      fundingAnnualized: bestShort.fundingAnnualized,
      openInterestUsd: bestShort.openInterestUsd,
      riskScore: bestShort.riskScore,
      reason: `${bestShort.symbol} shows overleveraged longs (funding ${bestShort.fundingAnnualized?.toFixed(1)}% ann.) with $${(bestShort.openInterestUsd/1e6).toFixed(1)}M OI. ${bestShort.change24h < 0 ? 'Price already weakening ('+bestShort.change24h.toFixed(2)+'%).' : 'Price may be due for correction with this much leverage.'}`
    } : null,
    bestLong: bestLong ? {
      symbol: bestLong.symbol,
      confidence: Math.min(bestLong.longScore / 100, 0.95),
      price: bestLong.price,
      fundingAnnualized: bestLong.fundingAnnualized,
      openInterestUsd: bestLong.openInterestUsd,
      riskScore: bestLong.riskScore,
      reason: `${bestLong.symbol} shows overleveraged shorts (funding ${bestLong.fundingAnnualized?.toFixed(1)}% ann.) with $${(bestLong.openInterestUsd/1e6).toFixed(1)}M OI. ${bestLong.change24h > 0 ? 'Price already showing strength ('+bestLong.change24h.toFixed(2)+'%).' : 'Potential short squeeze setup.'}`
    } : null
  };
}

// ---------- Public API ----------
export async function buildLiquidationOverview() {
  const start = Date.now();
  const [okx, hyperliquid, deribit] = await Promise.all([
    fetchOkxData().catch(() => ({})),
    fetchHyperliquidData().catch(() => ({})),
    fetchDeribitData().catch(() => ({}))
  ]);

  const agg = aggregateBySymbol([okx, hyperliquid, deribit]);
  const signals = computeSignals(agg);

  const allCoins = Object.values(agg);
  const totalOi = allCoins.reduce((s, c) => s + (c.openInterestUsd || 0), 0);
  const avgFunding = allCoins.length ? allCoins.reduce((s, c) => s + (c.fundingRate || 0), 0) / allCoins.length : 0;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - start,
    summary: {
      sources: ['okx', 'hyperliquid', 'deribit'],
      totalCoinsTracked: allCoins.length,
      totalOpenInterestUsd: Math.round(totalOi),
      averageFundingRate: avgFunding,
      averageFundingAnnualized: avgFunding * 3 * 365,
      dominantSentiment: avgFunding > 0.0003 ? 'bullish_leverage' : avgFunding < -0.0003 ? 'bearish_leverage' : 'neutral'
    },
    ...signals
  };
}
