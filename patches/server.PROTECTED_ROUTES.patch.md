# Manual server.js security patch

Your repo currently protects selected `/api/:routeName` names via `PROTECTED_ROUTES`.

Replace the `PROTECTED_ROUTES` Set with this safer version:

```js
const PROTECTED_ROUTES = new Set([
  'signals',
  'market',
  'weekly-analysis',
  'bot',
  'news-ingest',
  'news-signal',
  'learning',
  'perpetual-trader',

  // AI consultant / brain routes
  'brain',
  'advisor',
  'consultant',

  // Anything that could mutate simulated or real trading state
  'trader',
  'execution',
  'webhook',
  'orders',
  'positions',
]);
```

Also remove any code that allows live exchange order placement unless it is behind a separate manual admin flow.

Required production env:

```env
APP_MODE=advisor
ALLOW_LIVE_TRADING=false
TRADING_MODE=paper
CRON_SECRET=long-random-secret
```
