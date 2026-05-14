# Coder Prompt: Implement Advisor-Only AI Trading Consultant

You are improving `jpgyap-sudo/xsjprd55`.

Goal: Convert the app into an AI Trading Consultant and simulation-learning lab. It must not perform automatic trading.

## Must implement

1. Apply SQL migration:
   `supabase/migrations/20260515_ai_consultant_mode.sql`

2. Add advisor modules:
   - `lib/safety/advisorModeGuard.js`
   - `lib/advisor/marketContext.js`
   - `lib/advisor/strategyScorer.js`
   - `lib/advisor/riskGate.js`
   - `lib/advisor/reportBuilder.js`
   - `lib/advisor/saveAdvisorReport.js`
   - `lib/advisor/runAdvisor.js`

3. Add API:
   - `api/advisor.js`

4. Add Telegram commands:
   - `/ask SYMBOL [timeframe]`
   - `/strategy SYMBOL [timeframe]`
   - `/risk SYMBOL`
   - `/backtest SYMBOL`

5. Wire `buildAdvisorContext()` to existing data functions:
   - OHLCV/price cache
   - liquidation context
   - funding/OI
   - news/social sentiment
   - strategy backtest results
   - simulation learning memory

6. Security:
   - App must default to `APP_MODE=advisor`
   - `ALLOW_LIVE_TRADING=false`
   - `TRADING_MODE=paper`
   - Protect `/api/brain`, `/api/advisor`, `/api/consultant`, `/api/trader`, `/api/execution`, `/api/webhook`
   - Remove or disable live order execution path

7. Add simulation learning:
   - Mock/perp traders write to `simulated_trades`
   - Learning worker summarizes closed simulated trades into `advisor_learning_memory`

8. Add tests:
   - `npm run test:advisor`

## Acceptance criteria

- `/api/advisor` returns long/short/neutral/avoid with confidence, risk, strategy, warnings
- Telegram `/ask BTCUSDT today` returns a readable advisor report
- No endpoint can place real orders
- Mock/perp simulation results are saved and learned from
- Advisor report always includes disclaimer and `execution_allowed: false`
