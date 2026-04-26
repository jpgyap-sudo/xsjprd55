// ============================================================
// AI Crypto Trading Advisor — /api/ask
// POST { question, chatHistory? } → Claude-powered analysis
// Fetches live market data from CoinGecko + OKX to enrich context
// ============================================================

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SYSTEM_PROMPT = `You are a crypto market analysis assistant focused on trading, liquidity pools, and token research.

Your job is to help users evaluate:
- spot and swing trading opportunities
- liquidity pool opportunities on Meteora
- token accumulation opportunities during bear markets
- organic meme coins with strong real communities
- undervalued real projects with long-term upside

Priority sources: jup.ag, birdeye.so, coinmarketcap.com, meteora.ag, x.com for social mentions

Liquidity pool analysis: evaluate TVL, 24h volume, volume-to-TVL ratio, fees/yield quality, token volatility, impermanent loss risk, concentration risk, holder quality, whether activity appears organic or manipulated.

Detect suspicious/manipulated pools: flag when volume, price action, and social activity look inorganic, unusually high volume with weak community, low-quality token fundamentals, shallow holder base, sudden spikes with no narrative, bot-like engagement, abnormal yield inconsistent with token quality.

Token recommendation categories: safer accumulation candidates, undervalued real projects, higher-risk organic meme tokens, avoid/suspicious tokens.

Prefer: established credible projects during bear markets, strong communities, organic growth, sustainable narratives, reasonable liquidity, healthy volume, real usage/ecosystem relevance.

Output format for each token/pool: summary, bullish case, risks, liquidity quality, social momentum quality, organic vs manipulated, suitable for trading/LP/accumulation/avoid, confidence level (low/medium/high).

Safety rules: never claim guaranteed profits, never present speculation as fact, clearly separate facts/estimates/opinion, state when data is incomplete, always include downside risks, be cautious with illiquid/new/easily manipulated tokens.`;

async function fetchCoinGecko() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=30&page=1&sparkline=false&price_change_percentage=24h');
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(c => ({
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price: c.current_price,
      change24h: c.price_change_percentage_24h,
      marketCap: c.market_cap,
      volume24h: c.total_volume,
      ath: c.ath,
      ath_change: c.ath_change_percentage
    }));
  } catch (e) {
    return [];
  }
}

async function fetchGlobalData() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/global');
    if (!res.ok) return null;
    const data = await res.json();
    return data.data;
  } catch (e) {
    return null;
  }
}

async function fetchOkxFunding(symbols) {
  try {
    const results = {};
    for (const sym of symbols.slice(0, 10)) {
      const pair = sym.replace('/', '-');
      const res = await fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${pair}-SWAP`);
      if (res.ok) {
        const data = await res.json();
        if (data.data?.[0]) {
          results[sym] = {
            fundingRate: parseFloat(data.data[0].fundingRate),
            nextFundingTime: data.data[0].nextFundingTime
          };
        }
      }
    }
    return results;
  } catch (e) {
    return {};
  }
}

async function fetchRecentSignals(supabase) {
  try {
    const { data } = await supabase
      .from('signals')
      .select('*')
      .order('generated_at', { ascending: false })
      .limit(10);
    return data || [];
  } catch (e) {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { question, chatHistory = [] } = req.body || {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Missing question' });
  }

  // Fetch live market context
  const [coins, globalData, funding] = await Promise.all([
    fetchCoinGecko(),
    fetchGlobalData(),
    fetchOkxFunding(['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','XRP/USDT'])
  ]);

  const marketContext = {
    global: globalData ? {
      totalMarketCap: globalData.total_market_cap?.usd,
      totalVolume: globalData.total_volume?.usd,
      btcDominance: globalData.market_cap_percentage?.btc,
      ethDominance: globalData.market_cap_percentage?.eth,
      fearGreed: globalData.market_cap_change_percentage_24h_usd
    } : null,
    topCoins: coins,
    okxFunding: funding
  };

  const messages = [
    ...chatHistory.slice(-6),
    {
      role: 'user',
      content: `Current market context (CoinGecko + OKX):\n${JSON.stringify(marketContext, null, 2)}\n\nUser question: ${question}`
    }
  ];

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages
      })
    });

    const anthropicData = await anthropicRes.json();

    if (!anthropicRes.ok) {
      return res.status(500).json({ error: 'AI service error', details: anthropicData });
    }

    const answer = anthropicData.content?.[0]?.text || 'No response from AI';

    return res.status(200).json({
      ok: true,
      answer,
      model: anthropicData.model,
      usage: anthropicData.usage,
      marketSnapshot: {
        btcPrice: coins.find(c => c.symbol === 'BTC')?.price,
        btcChange: coins.find(c => c.symbol === 'BTC')?.change24h,
        ethPrice: coins.find(c => c.symbol === 'ETH')?.price,
        ethChange: coins.find(c => c.symbol === 'ETH')?.change24h
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
