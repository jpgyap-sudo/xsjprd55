# Trading Signal Telegram Bot — xsjprd55

AI-powered crypto trading signal alerts delivered via Telegram. Built for **paper trading by default** with explicit opt-in for live mode.

> ⚠️ **Isolated Project** — This repo (`xsjprd55`) is completely separate from any other trading bot. It has its own Vercel deployment, Supabase database, and Telegram bot token.

---

## Features

| Feature | Description |
|---|---|
| **Auto Signal Scan** | Every 15 min: BTC, ETH, SOL, BNB, XRP on 15m/1h/4h |
| **Strategies** | EMA Cross (9/21), RSI Bounce (30/70), Volume Filter confirmation |
| **Manual Signals** | `/signal BTCUSDT LONG 65000 SL:64000 TP:67000,69000` |
| **Market Cache** | Hourly OHLCV fetch + Supabase cache |
| **Risk Gates** | Max position, daily loss limit, cooldown, stale-data block |
| **Paper/Live Modes** | `TRADING_MODE=paper` default; live requires `auto_trade_enabled` per user |
| **Weekly Report** | Sunday PnL + win-rate summary to Telegram |
| **Audit Trail** | Every signal, trade, and command logged to `audit_log` |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | [Vercel](https://vercel.com) (serverless functions + cron) |
| Database | [Supabase](https://supabase.com) (PostgreSQL + RLS) |
| Exchange API | [CCXT](https://github.com/ccxt/ccxt) (Binance, Bybit, OKX) |
| Bot | Telegram Bot API (webhook mode) |
| AI | Anthropic Claude (optional, future NLP features) |
| Timezone | UTC for logs; user-local for display |
| Runtime | Node.js 20+ ESM |

---

## API Endpoints

| Endpoint | Trigger | Purpose |
|---|---|---|
| `POST /api/telegram` | Telegram webhook | Handle commands and inline buttons |
| `GET /api/signal` | Cron every 15 min | Auto-scan and generate signals |
| `POST /api/signal` | Manual / admin | Trigger scan on demand with overrides |
| `GET/POST /api/market` | Cron hourly / manual | Fetch & cache OHLCV market data |
| `GET /api/weekly-analysis` | Cron Sunday 4am UTC | Weekly PnL & performance report |
| `GET /api/health` | Cron every 30 min | Health check: env, Supabase, exchange, Telegram |

---

## Database Tables

| Table | Purpose |
|---|---|
| `signals` | Every generated signal broadcast to Telegram |
| `trades` | Paper & live trade executions |
| `bot_users` | Subscribers with risk profiles |
| `audit_log` | Compliance trail of every signal, trade, and command |
| `market_data` | Cached OHLCV for fast signal checks |
| `exchange_credentials` | Read-only API keys (user-scoped, encrypted at rest by Supabase) |

> Run `supabase/schema.sql` in the Supabase SQL Editor to create tables, indexes, and RLS policies.

---

## Setup & Deployment

### 1. Prerequisites

- [Vercel](https://vercel.com) account (Pro required for 15-min cron)
- [Supabase](https://supabase.com) project
- [Telegram bot](https://t.me/BotFather) token and a group chat ID
- [Binance](https://www.binance.com) account + **read-only** API key (recommended)
- Optional: Bybit and OKX read-only keys for multi-exchange fallback

### 2. Clone and install

```bash
git clone https://github.com/jpgyap-sudo/xsjprd55.git
cd xsjprd55
npm install
```

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in your secrets:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_GROUP_CHAT_ID=your-group-chat-id
BINANCE_API_KEY=your-binance-api-key
BINANCE_API_SECRET=your-binance-api-secret
TRADING_MODE=paper
VERCEL_PRODUCTION_URL=https://your-app.vercel.app
```

Add the same variables to your **Vercel project** under Settings → Environment Variables.

### 4. Deploy to Vercel

```bash
npm run dev       # local development
vercel deploy     # deploy to preview
vercel --prod     # deploy to production
```

### 5. Set Telegram webhook

After deploying, register the webhook:

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-app.vercel.app/api/telegram
```

### 6. Run database schema

Open the Supabase SQL Editor for **this project**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it.

---

## Telegram Commands

| Command | Description |
|---|---|
| `/signal SYMBOL SIDE ENTRY [SL:price] [TP:price1,price2]` | Submit a manual signal |
| `/market [SYMBOL]` | Show last cached price |
| `/status` | Active signals & open trades |
| `/scan` | Trigger signal scan now |
| `/close SYMBOL` | Close open trades for a symbol |
| `/test` | Bot health check |
| `/help` | Command list |

Every auto-generated signal includes inline buttons:
- **✅ Confirm** — marks signal as confirmed
- **❌ Dismiss** — marks signal as dismissed

---

## Cron Jobs

Configured in [`vercel.json`](vercel.json):

| Endpoint | Schedule | Purpose |
|---|---|---|
| `/api/signal` | `*/15 * * * *` | Signal scan every 15 minutes |
| `/api/market` | `0 * * * *` | Market data cache every hour |
| `/api/weekly-analysis` | `0 4 * * 0` | Weekly report (Sunday 4am UTC) |
| `/api/health` | `*/30 * * * *` | Health check every 30 minutes |

> 15-minute cron requires Vercel Pro or higher.

---

## Safety & Risk

- **Default mode is `paper`.** No real money is at risk unless you explicitly set `TRADING_MODE=live` AND enable `auto_trade_enabled` per user.
- **Read-only exchange keys are strongly recommended** for signal generation. The bot does not need trade permissions to scan and broadcast.
- **Row Level Security (RLS)** is enabled on `bot_users`, `trades`, and `exchange_credentials`.
- **Daily loss limits, max position sizes, and cooldowns** are enforced before any signal is saved or broadcast.

---

## Project Structure

```
xsjprd55/
├── api/
│   ├── signal.js            # Auto-scan + manual trigger
│   ├── telegram.js          # Webhook handler
│   ├── market.js            # OHLCV fetch & cache
│   ├── weekly-analysis.js   # Sunday PnL report
│   └── health.js            # Connectivity health check
├── lib/
│   ├── supabase.js          # Supabase client
│   ├── exchange.js          # CCXT multi-exchange wrapper
│   ├── signal-engine.js     # EMA, RSI, Volume strategies
│   ├── risk.js              # Risk gates & validation
│   └── telegram.js          # Telegram API helpers
├── supabase/
│   └── schema.sql           # Full DB schema + RLS
├── .env.example             # Environment variables
├── vercel.json              # Serverless + cron config
└── README.md                # This file
```

---

## Documentation

| File | Contents |
|---|---|
| [`SECURITY.md`](SECURITY.md) | Threat model, secret handling, and RLS policies |
| [`.env.example`](.env.example) | Required environment variables |
| [`supabase/schema.sql`](supabase/schema.sql) | Database schema & RLS policies |

---

*Project: xsjprd55 — Isolated Trading Signal Bot*  
*Last updated: 2026-04-26*
