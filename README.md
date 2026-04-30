# Trading Signal Telegram Bot — xsjprd55

AI-powered crypto trading signal alerts delivered via Telegram. Built for **paper trading by default** with explicit opt-in for live mode.

> ⚠️ **Isolated Project** — This repo (`xsjprd55`) is completely separate from any other trading bot. It has its own VPS deployment, Supabase database, and Telegram bot token.

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
| **Self-Improving Bot** | Daily learning loop analyzes patterns, identifies weaknesses, and suggests improvements |
| **Auto-Discovery** | Bot constantly scans for new data sources and APIs to improve signal accuracy |
| **App Suggestions** | Bot generates actionable improvement ideas with voting and implementation tracking |
| **Data Health Dashboard** | Real-time exchange API, news, liquidation freshness + crawler fallback tracking |

## Self-Improving Architecture

This bot is designed to **grow and improve itself over time**:

1. **Pattern Learning** — Every signal snapshots market conditions (price, funding, news sentiment, global metrics). When signals close, outcomes are recorded to build a performance database.

2. **Daily Learning Loop** (4 AM UTC) — Automatically:
   - Resolves outcomes for expired signals
   - Rolls up strategy performance by timeframe and symbol
   - Generates improvement suggestions based on statistical analysis
   - Health-checks all data sources and flags degraded ones
   - Discovers new APIs and data sources to integrate

3. **Suggestion Engine** — Four analyzers continuously evaluate:
   - **Strategy Performance** — Flags underperforming strategies and proposes parameter tweaks
   - **Data Source Gaps** — Recommends new sources (on-chain, social sentiment, macro data)
   - **Feature Correlations** — Identifies which market conditions predict signal success
   - **AI Meta-Suggestions** — Uses Claude/Kimi to review performance stats and recommend high-level improvements

4. **Continuous Improvement** — As new data sources are added and new strategies implemented, the bot re-analyzes everything and proposes further optimizations. The system is designed so that **the more it runs, the smarter it gets**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | **VPS** (DigitalOcean / Ubuntu 22.04) — PM2 + Node.js 20+ |
| Reverse Proxy | Nginx or Caddy (SSL via Let's Encrypt) |
| Database | [Supabase](https://supabase.com) (PostgreSQL + RLS) |
| Exchange API | [CCXT](https://github.com/ccxt/ccxt) (Binance, Bybit, OKX, Hyperliquid) |
| Bot | Telegram Bot API (webhook mode) |
| AI | Kimi (Moonshot AI) primary + Anthropic Claude fallback |
| Timezone | UTC for logs; user-local for display |
| Runtime | Node.js 20+ ESM |

---

## Deployment Architecture

```
[Telegram]  <--webhook-->  [VPS 165.22.110.111 / bot.abcx124.xyz]
                                  |
              +-------------------+-------------------+
              |                   |                   |
         [API Server]      [Background Workers]   [Playwright]
         Port 3000         (OI, liquidation,      (crawler)
         /api/telegram      backtest, health,
         /api/signal        mock trading, wallet
         /api/data-health   tracker, social sentiment)
              |
         [Supabase]  <--data-->  [Dashboard]
         (signals, trades,        (static HTML served
          health logs)            from /public on VPS)
```

### Why VPS over Vercel?

| | VPS | Vercel Hobby |
|---|---|---|
| Background workers | ✅ 24/7 via PM2 | ❌ Functions timeout after 10s |
| Cron jobs | ✅ node-cron / system cron | ❌ Limited to 12 functions |
| Playwright crawler | ✅ Native install | ❌ Browser binaries too large |
| WebSocket support | ✅ | ❌ |
| Cost | $18/mo (2GB DO) | $0 (blocked by limits) |

Vercel is **not recommended** for this project. The VPS handles everything: API, workers, Telegram webhook, and dashboard.

---

## API Endpoints

| Endpoint | Trigger | Auth | Purpose |
|---|---|---|---|
| `POST /api/telegram` | Telegram webhook | `X-Telegram-Bot-Api-Secret-Token` | Handle commands and inline buttons |
| `GET /api/signal` | Cron every 15 min | `x-cron-secret` | Auto-scan and generate signals |
| `POST /api/signal` | Manual / admin | None (POST exempt) | Trigger scan on demand with overrides |
| `GET/POST /api/market` | Cron hourly / manual | `x-cron-secret` (GET only) | Fetch & cache OHLCV market data |
| `GET /api/weekly-analysis` | Cron Sunday 4am UTC | `x-cron-secret` | Weekly PnL & performance report |
| `GET /api/health` | Any | None | Connectivity health check |
| `GET /api/data-health` | Any | None | **Data quality dashboard** |
| `GET /api/bot?type=suggestions` | Dashboard / Telegram | None | List and vote on improvement ideas |
| `GET /api/bot?type=sources` | Dashboard / Telegram | None | View connected data sources |
| `GET /api/bot?type=patterns` | Dashboard / Telegram | None | Signal pattern stats |
| `GET /api/bot?type=learn` | Cron daily 4am UTC | `x-cron-secret` | Run learning loop |

> **Cron protection:** All `GET` endpoints that trigger scans, learning, or reports require the `x-cron-secret` header matching `CRON_SECRET` in `.env`. Manual `POST` requests to `/api/signal` and `/api/market` are exempt.

---

## Database Tables

| Table | Purpose |
|---|---|
| `signals` | Every generated signal broadcast to Telegram |
| `trades` | Paper & live trade executions |
| `bot_users` | Subscribers with risk profiles |
| `audit_log` | Compliance trail of every signal, trade, and command |
| `market_data` | Cached OHLCV for fast signal checks |
| `exchange_credentials` | Read-only API keys (user-scoped, encrypted at rest) |
| `signal_patterns` | Feature snapshots at signal time for ML analysis |
| `app_suggestions` | Bot-generated improvement ideas with voting & status |
| `data_source_registry` | All connected APIs/exchanges with reliability scoring |
| `data_source_health` | Real-time health status of every data feed |
| `learning_feedback_log` | Audit trail of every learning event |
| `strategy_performance` | Rolling performance windows by strategy + timeframe |

> Run `supabase/schema.sql` and `supabase/schema_additions.sql` in the Supabase SQL Editor to create tables, indexes, and RLS policies.

---

## Setup & Deployment

### 1. Prerequisites

- **VPS**: Ubuntu 22.04+, 2 vCPU / 2GB RAM minimum, public IP
- [Supabase](https://supabase.com) project
- [Telegram bot](https://t.me/BotFather) token and a group chat ID
- Exchange API keys are optional for paper/mock monitoring. Public price feeds use `PRICE_SOURCE_ORDER=hyperliquid,binance,bybit,okx` by default.
- Optional: Binance, Bybit, or OKX **read-only** keys for higher rate limits and exchange-specific data. Never enable trading permissions unless live trading is explicitly intended.

### 2. Clone and install on VPS

```bash
ssh root@165.22.110.111
git clone https://github.com/jpgyap-sudo/xsjprd55.git /opt/trading-bot
cd /opt/trading-bot

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install dependencies
npm install
npx playwright install chromium
```

### 3. Environment variables

Copy `.env.example` to `.env` and fill in **real** secrets:

```bash
cp .env.example .env
nano .env
```

Key variables:
```bash
# Deployment
APP_URL=https://bot.abcx124.xyz
DEPLOYMENT_TARGET=vps

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Telegram
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)
TELEGRAM_GROUP_CHAT_ID=your-group-chat-id

# AI (Kimi primary, Claude fallback)
AI_PROVIDER=kimi
KIMI_API_KEY=sk-your-kimi-key
ANTHROPIC_API_KEY=your-claude-key

# Exchange (read-only keys)
BINANCE_API_KEY=your-binance-api-key
BINANCE_API_SECRET=your-binance-secret

# Security
CRON_SECRET=$(openssl rand -hex 32)
TRADING_MODE=paper
```

> ⚠️ **Never commit `.env` to Git.** `.env.example` is the only env file tracked.

### 4. Deploy with PM2

```bash
cd /opt/trading-bot
bash scripts/deploy-vps.sh
```

This will:
1. Check Node.js version
2. Verify `.env` exists
3. Install dependencies
4. Start the bot with PM2
5. Save PM2 process list & auto-start on boot

Verify:
```bash
pm2 status
pm2 logs trading-signal-bot
```

### 5. Set Telegram webhook

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://bot.abcx124.xyz/api/telegram&secret_token=<YOUR_WEBHOOK_SECRET>"
```

> The webhook path is `/api/telegram` (not `/api/bot`).

### 6. Verify everything works

```bash
# Server health
curl http://localhost:3000/api/health

# Data quality dashboard
curl http://localhost:3000/api/data-health

# Telegram webhook status
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

### 7. (Optional) Nginx reverse proxy + SSL

```bash
apt-get install -y nginx certbot python3-certbot-nginx

# Create nginx config
nano /etc/nginx/sites-available/trading-bot
```

```nginx
server {
    listen 80;
    server_name bot.abcx124.xyz;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

Enable and get SSL:
```bash
ln -s /etc/nginx/sites-available/trading-bot /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
certbot --nginx -d bot.abcx124.xyz
```

---

## Telegram Commands

| Command | Description |
|---|---|
| `/signal SYMBOL SIDE ENTRY [SL:price] [TP:price1,price2]` | Submit a manual signal |
| `/market [SYMBOL]` | Show last cached price |
| `/status` | Active signals & open trades |
| `/scan` | Trigger signal scan now |
| `/news` | Latest crypto headlines with sentiment |
| `/newsscan` | Scan news for trade signals |
| `/catalysts` | Key macro events & price levels |
| `/close SYMBOL` | Close open trades for a symbol |
| `/suggestions` | View bot-generated improvement ideas |
| `/learn` | Trigger the learning loop manually |
| `/sources` | View connected data sources and health |
| `/patterns [strategy]` | View pattern stats for a strategy |
| `/test` | Bot health check |
| `/help` | Command list |

Every auto-generated signal includes inline buttons:
- **✅ Confirm** — marks signal as confirmed
- **❌ Dismiss** — marks signal as dismissed

---

## Cron Jobs

On the VPS, cron jobs are handled by **node-cron inside workers** or system `crontab`:

| Endpoint | Schedule | Purpose |
|---|---|---|
| `GET /api/signal` | `*/15 * * * *` | Signal scan every 15 minutes |
| `GET /api/market` | `0 * * * *` | Market data cache every hour |
| `GET /api/weekly-analysis` | `0 4 * * 0` | Weekly report (Sunday 4am UTC) |
| `GET /api/bot?type=learn` | `0 4 * * *` | Daily learning loop (4am UTC) |
| `GET /api/bot?type=ingest-news` | `0 0 * * *` | News ingestion (midnight UTC) |

Example crontab entry:
```bash
# Edit crontab
crontab -e

# Add line (replace YOUR_SECRET)
*/15 * * * * curl -H "x-cron-secret: YOUR_SECRET" http://localhost:3000/api/signal
```

---

## Safety & Risk

- **Default mode is `paper`.** No real money is at risk unless you explicitly set `TRADING_MODE=live` AND enable `auto_trade_enabled` per user.
- **Read-only exchange keys are strongly recommended** for signal generation. The bot does not need trade permissions to scan and broadcast.
- **Row Level Security (RLS)** is enabled on `bot_users`, `trades`, and `exchange_credentials`.
- **Daily loss limits, max position sizes, and cooldowns** are enforced before any signal is saved or broadcast.
- **Cron secret protection** prevents unauthorized scans. Always set `CRON_SECRET` in production.
- **Webhook secret validation** rejects spoofed Telegram updates.

---

## Data Health Dashboard

The `/api/data-health` endpoint returns real-time status:

| Check | What it monitors |
|---|---|
| **Exchange APIs** | Binance, Bybit, OKX, Hyperliquid connectivity + latency |
| **Market Data Freshness** | How old is the latest OHLCV cache |
| **News Freshness** | Age of latest news ingestion |
| **Liquidation Freshness** | Age of latest liquidation heatmap |
| **Crawler Fallback** | How many times fallback was used in last 24h |
| **Alerts** | Auto-generated warnings for stale data or API errors |

Access it:
```bash
curl http://localhost:3000/api/data-health
```

---

## Project Structure

```
xsjprd55/
├── api/
│   ├── signal.js            # Auto-scan + manual trigger
│   ├── telegram.js          # Webhook handler (commands + AI chat)
│   ├── market.js            # OHLCV fetch & cache
│   ├── weekly-analysis.js   # Sunday PnL report
│   ├── health.js            # Connectivity health check
│   ├── data-health.js       # Data quality dashboard
│   ├── liquidation.js       # Multi-exchange liquidation intel
│   └── bot.js               # Unified self-improving bot API
├── lib/
│   ├── supabase.js          # Supabase client
│   ├── exchange.js          # CCXT multi-exchange wrapper
│   ├── signal-engine.js     # EMA, RSI, Volume strategies
│   ├── risk.js              # Risk gates & validation
│   ├── telegram.js          # Telegram API helpers
│   ├── ai.js                # Kimi + Claude AI integration
│   ├── config.js            # Centralized env config
│   ├── liquidation.js       # OI, funding, squeeze signals
│   ├── pattern-learner.js   # Signal feature extraction
│   ├── suggestion-engine.js # Improvement idea generator
│   ├── data-source-manager.js # API registry & discovery
│   ├── data-health.js       # Data source health tracker
│   └── learning-loop.js     # Daily self-improvement orchestrator
├── workers/                 # Background worker scripts (PM2)
├── supabase/
│   ├── schema.sql           # Full DB schema + RLS
│   └── schema_additions.sql # Self-improving bot tables
├── public/
│   └── index.html           # Dashboard
├── scripts/
│   └── deploy-vps.sh        # One-click VPS deploy
├── .env.example             # Environment variables (safe template)
├── server.js                # Express entry point
└── README.md                # This file
```

---

## Documentation

| File | Contents |
|---|---|
| [`SECURITY.md`](SECURITY.md) | Threat model, secret handling, and RLS policies |
| [`DEPLOY-VPS.md`](DEPLOY-VPS.md) | Detailed VPS deployment guide |
| [`.env.example`](.env.example) | Required environment variables |
| [`supabase/schema.sql`](supabase/schema.sql) | Database schema & RLS policies |

---

## How the Bot Improves Itself

The bot follows a **continuous improvement cycle**:

1. **Collect** — Every signal captures market context (price, funding rates, news sentiment, global metrics)
2. **Learn** — Daily cron analyzes which conditions led to wins vs losses
3. **Suggest** — The bot proposes specific improvements: new data sources, strategy tweaks, risk adjustments
4. **Vote** — You review suggestions in the dashboard and upvote/downvote them
5. **Implement** — Approved suggestions are built into the code; the bot then re-evaluates with the new logic
6. **Repeat** — The cycle continues, with the bot getting smarter and more accurate over time

**The longer the bot runs, the more data it accumulates, and the better its recommendations become.**

---

*Project: xsjprd55 — Isolated Trading Signal Bot*
*Last updated: 2026-04-28*
