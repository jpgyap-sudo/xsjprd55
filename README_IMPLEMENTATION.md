# xsjprd55 AI Trading Consultant Fix Pack

Goal: convert xsjprd55 into an **AI trading consultant / intelligence lab**, not an automatic trading bot.

This pack adds:
- Advisor-only token consultant API
- Telegram commands for `/ask`, `/strategy`, `/risk`, `/backtest`
- Simulation learning tables for mock/perp traders
- Research/backtest memory
- Strict safety guards to block live execution
- Docker container split for web, Telegram, workers, consultant, Redis
- Coder handoff prompt

## Install order

1. Copy files into repo root.
2. Run SQL in Supabase:
   - `supabase/migrations/20260515_ai_consultant_mode.sql`
3. Apply server security patch:
   - Either replace `server.js` protected routes with `patches/server.PROTECTED_ROUTES.patch.md`
   - Or manually add `brain`, `advisor`, `consultant`, `trader`, `execution`, `webhook`.
4. Add env vars from `.env.ai-consultant.example`.
5. Add imports/routes if your existing Telegram bot uses a different entry file.
6. Run:
   ```bash
   npm install
   npm run test:advisor
   npm run start
   ```

## Recommended app mode

```env
APP_MODE=advisor
ALLOW_LIVE_TRADING=false
TRADING_MODE=paper
```

Never give API keys with withdrawal or real trade permission.
