# Security Policy — xsjprd55

This document outlines the threat model, secret handling practices, and Row Level Security (RLS) policies for the isolated `xsjprd55` trading signal bot.

---

## Threat Model

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| API key leakage | Medium | Critical | Keys stored only in Vercel env vars; never committed |
| Unauthorized Telegram commands | Low | Medium | Webhook secret validation; admin ID checks |
| Database injection | Low | High | Parameterized queries via Supabase client |
| Signal spoofing / stale data | Medium | High | Stale-data gate (>5 min); schema validation |
| Live trading triggered by mistake | Low | Critical | `TRADING_MODE=paper` default; `auto_trade_enabled` per-user gate |
| Exchange API rate limits | Medium | Low | CCXT `enableRateLimit`; cooldown enforcement |
| Replay of old signals | Low | Medium | `valid_until` TTL on every signal; expired signals ignored |

---

## Secret Handling

1. **Never commit secrets.** `.env.example` contains only placeholder values.
2. **Production secrets live in Vercel Environment Variables** only.
3. **Supabase Service Role Key** is required for serverless functions (bypasses RLS). Keep it confidential.
4. **Telegram Bot Token** — rotate immediately if leaked via BotFather.
5. **Exchange API Keys** — use **read-only** keys. The bot does not need trade permissions for signal generation.
6. **Webhook Secret** — optional but recommended. Validate `X-Telegram-Bot-Api-Secret-Token` header in production.

---

## Row Level Security (RLS)

RLS is enabled on all user-scoped tables. The serverless functions use the **Service Role Key** for admin operations (inserting signals, writing audit logs). User-scoped reads are filtered via RLS policies using `app.current_telegram_user_id`.

### Policies Summary

| Table | Policy | Effect |
|---|---|---|
| `bot_users` | `bot_users_self_select` | Users can read their own profile |
| `bot_users` | `bot_users_self_update` | Users can update their own profile |
| `trades` | `trades_self_select` | Users can see only their own trades |
| `exchange_credentials` | `exch_cred_self_all` | Users can manage only their own credentials |

### Service Role Usage

The Service Role Key is used **only** in serverless functions for:
- Inserting signals and trades
- Writing audit logs
- Reading all signals for `/status` and `/scan`
- Running cron jobs (no Telegram user context exists)

---

## Trading Safety Gates

Before any signal is saved or broadcast, the following gates are checked in [`lib/risk.js`](lib/risk.js):

1. **Schema validation** — required fields, valid side, numeric prices, confidence range
2. **Stale data block** — signals older than 5 minutes are rejected
3. **Max position size** — configurable per-user or env var
4. **Daily loss limit** — blocks new signals if limit exceeded
5. **Cooldown** — prevents spam per symbol
6. **Live mode gate** — live signals blocked unless `auto_trade_enabled=true`
7. **Duplicate active signal** — same symbol+side already active → skip

---

## Incident Response

| Incident | Action |
|---|---|
| API key leaked | Rotate key immediately; check audit_log for unauthorized usage |
| Unauthorized signal broadcast | Review `audit_log` for source; revoke webhook if compromised |
| Supabase breach | Rotate `SUPABASE_SERVICE_ROLE_KEY`; review RLS policies |
| Bot spam loop | Check cooldown config; verify no infinite callback loops in `/api/telegram` |

---

*Last updated: 2026-04-26*
