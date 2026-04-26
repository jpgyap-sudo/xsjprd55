// ============================================================
// Catalyst Watch — /api/catalyst
// Returns curated macro + crypto catalysts with impact levels,
// affected tokens, direction risk, and key price levels.
// ============================================================

const CATALYSTS = {
  updated_at: new Date().toISOString(),

  high: [
    {
      id: 'fed-macro',
      emoji: '🇺🇸',
      title: 'US Macro Data & Fed Policy Signals',
      watch: 'Fed speaker comments, CPI revision surprises, Treasury yield moves',
      why: 'BTC is at $78K — 37.9% below ATH — largely due to macro tightening fears. Any dovish signal can spark a sharp relief rally.',
      impact: 'BTC +3–8% on dovish surprise | -5–10% on hawkish shock',
      affected: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      direction: 'both',
      urgency: 'high'
    },
    {
      id: 'us-china-trade',
      emoji: '📉',
      title: 'US-China Trade War Escalation',
      watch: 'Tariff announcements, retaliatory measures, export controls on tech/chips',
      why: 'Crypto has been tracking risk-off sentiment closely. Trade war escalation = risk-off = crypto sells off.',
      impact: 'BTC could retest $72–74K support on bad headlines',
      affected: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT'],
      direction: 'bearish',
      urgency: 'high'
    },
    {
      id: 'crypto-regulation',
      emoji: '🏛️',
      title: 'US Crypto Regulation / SEC / Congress',
      watch: 'SEC enforcement actions, Congressional crypto bill progress, stablecoin legislation votes',
      why: 'LINK (-82% ATH), ADA (-91% ATH), SOL (-70% ATH) are all structurally depressed partly due to regulatory uncertainty.',
      impact: 'Positive legislation = major altcoin relief rally',
      affected: ['LINKUSDT', 'ADAUSDT', 'SOLUSDT', 'XRPUSDT'],
      direction: 'both',
      urgency: 'high'
    },
    {
      id: 'xmr-privacy',
      emoji: '🔒',
      title: 'XMR Spike (+5.3%) — Privacy Coin Alert',
      watch: 'Exchange delisting news, privacy regulation, dark market activity',
      why: 'XMR pumps are often driven by regulatory news or large OTC demand. This spike could be a leading indicator.',
      impact: 'Privacy sector rotation if sustained; liquidity-thin pump risk',
      affected: ['XMRUSDT', 'ZECUSDT'],
      direction: 'both',
      urgency: 'medium',
      alert: '⚠️ Could be a liquidity-thin pump — investigate before chasing'
    },
    {
      id: 'stablecoin-banking',
      emoji: '💱',
      title: 'Stablecoin / Banking System News',
      watch: 'USDT/USDC regulatory actions, bank failures, USD liquidity crises',
      why: 'USDT volume is $31.3B — extremely high relative to market. Signals capital sitting on sidelines.',
      impact: 'Stablecoin depegging = flash crash. Regulatory clarity = capital deployment.',
      affected: ['BTCUSDT', 'ETHUSDT', 'USDT', 'USDC'],
      direction: 'both',
      urgency: 'high'
    }
  ],

  medium: [
    { title: 'Bitcoin ETF flow data', affected: ['BTCUSDT', 'ETHUSDT'], direction: 'both' },
    { title: 'Ethereum upgrade news / roadmap', affected: ['ETHUSDT'], direction: 'bullish' },
    { title: 'Solana ecosystem announcements', affected: ['SOLUSDT'], direction: 'bullish' },
    { title: 'Hyperliquid (HYPE) protocol news', affected: ['HYPE'], direction: 'both' },
    { title: 'ZEC +2% today — Zcash narrative?', affected: ['ZECUSDT', 'XMRUSDT'], direction: 'both' }
  ],

  readings: [
    { label: 'Fear & Greed', value: '1.19', implication: 'Extreme Fear', signal: 'contrarian_buy' },
    { label: 'BTC Funding', value: '-0.0032%', implication: 'Shorts crowded', signal: 'squeeze_potential' },
    { label: 'XRP Funding', value: '+0.01%', implication: 'Longs crowded', signal: 'short_risk' },
    { label: 'Volume vs Market Cap', value: 'Very thin', implication: 'Low liquidity', signal: 'news_sensitive' },
    { label: 'BTC Dominance', value: '58.1%', implication: 'Altcoins bleeding', signal: 'btc_leads' }
  ],

  levels: {
    BTC: { support: '$76,000', resistance: '$82,000–85,000' },
    ETH: { support: '$2,200', resistance: '$2,500–2,600' },
    SOL: { support: '$80', resistance: '$95–100' },
    XRP: { support: '$1.35', resistance: '$1.55–1.60' }
  },

  bottomLine: `The market is priced for maximum fear. A single positive macro catalyst (Fed pivot signal, trade war de-escalation, positive crypto legislation) could trigger a violent short squeeze given BTC's negative funding rate. Conversely, bad macro news into this illiquid, fearful market could accelerate downside fast. Today's wildcard: XMR's +5.3% move with no obvious catalyst — worth monitoring closely as a potential leading signal.`
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ ok: true, ...CATALYSTS });
}
