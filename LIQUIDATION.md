# Liquidation Intelligence Module

## Overview

The Liquidation Intelligence Module aggregates open interest (OI), funding rates, and market data across multiple perpetual futures exchanges to detect:

- **Crowded longs** → good short opportunities
- **Crowded shorts** → long squeeze setups
- **Squeeze candidates** → high OI + skewed funding
- **Divergence** → price vs funding misalignment

## Data Sources

| Exchange | API Type | Data Provided | Endpoint |
|---|---|---|---|
| OKX | REST | Tickers, OI, funding | `api/v5/market/tickers`, `api/v5/public/open-interest`, `api/v5/public/funding-rate` |
| Hyperliquid | POST REST | Perp meta + asset ctxs | `/info` (type: `perpMetaAndAssetCtxs`) |
| Deribit | REST | Book summaries, funding | `/api/v2/public/get_book_summary_by_currency` |
| Crypto.com | REST | Tickers, valuations | `/public/get-tickers`, `/public/get-valuations` |

> ⚠️ **Binance & Bybit** are geo-blocked from Vercel US IPs (451/403), so they are not used server-side.

## Signal Logic

### Short Setup (Bearish)
- High positive funding rate (>0.05% / 8h, >50% annualized)
- Large open interest (>$50M)
- Price weakening or flat while funding stays elevated
- **Rationale**: Crowded longs pay high funding; any pullback triggers liquidations

### Long Setup (Bullish)
- High negative funding rate (<-0.05% / 8h, <-50% annualized)
- Large open interest
- Price stable or rising while funding stays negative
- **Rationale**: Crowded shorts pay funding to longs; any rally triggers short squeeze

### Squeeze Candidate
- Open interest > $50M
- Absolute funding > 0.03% / 8h
- Price relatively flat (coiled spring)
- **Rationale**: Large positions + skewed funding = explosive move when it breaks

## Scoring Algorithm

```
shortScore = funding_long_penalty + oi_fuel + divergence_penalty + extreme_bonus
longScore  = funding_short_penalty + oi_fuel + divergence_penalty + extreme_bonus
riskScore  = 50 + (funding_annualized / 4) + (log10(oi) * 2.5) + price_direction_adjustment
```

- Funding extremes: ±0.1% / 8h adds 20+ points
- OI fuel: log10(OI) × 4, capped at 15
- Divergence: wrong-direction price adds 20 points
- Risk score: 0 = oversold/short-heavy, 100 = overbought/long-heavy

## API Endpoint

### GET `/api/liquidation`

```json
{
  "ok": true,
  "generatedAt": "2026-04-26T17:30:00Z",
  "latencyMs": 1200,
  "summary": {
    "sources": ["okx", "hyperliquid", "deribit"],
    "totalCoinsTracked": 42,
    "totalOpenInterestUsd": 42000000000,
    "averageFundingRate": 0.00012,
    "averageFundingAnnualized": 131.4,
    "dominantSentiment": "bullish_leverage"
  },
  "coins": [
    {
      "symbol": "BTC",
      "price": 94500,
      "change24h": 1.2,
      "volume24h": 28000000000,
      "openInterestUsd": 18000000000,
      "fundingRate": 0.00015,
      "fundingAnnualized": 164.25,
      "funding8h": 0.00015,
      "riskScore": 72,
      "shortScore": 85,
      "longScore": 30,
      "isSqueezeCandidate": false
    }
  ],
  "alerts": [
    {
      "type": "overleveraged_longs",
      "severity": "high",
      "symbol": "PEPE",
      "message": "PEPE: funding 312.5% annualized — crowded longs, short squeeze risk or good short entry"
    }
  ],
  "bestShort": {
    "symbol": "PEPE",
    "confidence": 0.92,
    "price": 0.0000123,
    "fundingAnnualized": 312.5,
    "openInterestUsd": 85000000,
    "riskScore": 94,
    "reason": "PEPE shows overleveraged longs (funding 312.5% ann.) with $85.0M OI. Price already weakening (-2.3%)."
  },
  "bestLong": {
    "symbol": "ETH",
    "confidence": 0.78,
    "price": 3450,
    "fundingAnnualized": -45.6,
    "openInterestUsd": 5200000000,
    "riskScore": 32,
    "reason": "ETH shows overleveraged shorts (funding -45.6% ann.) with $5.2B OI. Potential short squeeze setup."
  }
}
```

## Caching

- Server-side: `s-maxage=60, stale-while-revalidate=300`
- Dashboard polls every 60 seconds
- AI advisor fetches fresh data on every question

## Safety Filters

1. **Low volume ignored**: Coins with < $1M 24h volume excluded from recommendations
2. **Isolated spikes ignored**: Single-exchange anomalies cross-checked against others
3. **News blackout**: Avoid signals during major macro events (manual override)

## Integration Points

| Consumer | How it uses liquidation data |
|---|---|
| Dashboard (`/`) | Displays best short/long + alerts in side panel |
| AI Advisor (`/api/ask`) | Injects `liquidationIntel` into Claude context for short/long recommendations |
| Telegram Bot | Future: `/liquidation` command to broadcast alerts |

## Future Enhancements

- [ ] Binance/Bybit via proxy or edge function in non-US region
- [ ] Historical funding trend (last 7 days) for mean-reversion signals
- [ ] Liquidation heatmap visualization (notional liquidated per price level)
- [ ] Telegram `/liquidation` command
- [ ] Supabase persistence for backtesting signal accuracy
