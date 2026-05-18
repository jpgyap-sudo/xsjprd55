# TLL & Trading Bot — Future Pipeline

> **Purpose:** Track all unimplemented improvements, features, and optimizations for future sessions.
> Last updated: 2026-05-18

---

## ✅ Recently Completed

| # | Feature | Status | Commit |
|---|---------|--------|--------|
| 1 | TLL Ecosystem — Bridge mock trade, perpetual trade, research agent, signal agent data | ✅ Done | `7c397e9` |
| 2 | TLL Explainability Dashboard (`/tll-explain.html`) — 7-tab static HTML/JS | ✅ Done | *(pending)* |
| 3 | Risk-Adjusted Scoring — Sharpe, Sortino, Max DD, Calmar, Win Rate Consistency | ✅ Done | *(pending)* |
| 4 | Strategy Tournament — Round-robin Elo comparison inside TLL pipeline | ✅ Done | *(pending)* |
| 5 | Daily TLL Summary — Telegram report via `tll-notification-worker.js` | ✅ Done | *(pending)* |

---

## 📋 Future Pipeline (Unimplemented)

### Priority: High

#### 1. 🧪 Real-Time Signal Backtesting Dashboard
- **What:** Live backtesting UI that shows how signals would have performed in real-time
- **Why:** Traders need to see signal accuracy as it happens, not just in batch reports
- **How:** Wire `continuous-backtester.js` data to a new dashboard tab with real-time charts
- **Files involved:** `workers/continuous-backtester.js`, `public/index.html`, new API endpoint
- **Estimated effort:** 4-6 hours

#### 2. 🔔 Telegram Alert Preferences UI
- **What:** Dashboard UI to configure which Telegram alerts the user receives (signal alerts, TLL summaries, error notifications, deploy status)
- **Why:** Users want control over notification frequency without editing `.env`
- **How:** Store preferences in a new `user_preferences` table, expose via API, add settings panel to dashboard
- **Files involved:** New `api/user-preferences.js`, `public/index.html`, new Supabase table
- **Estimated effort:** 3-5 hours

#### 3. 📊 Advanced Portfolio Tracker
- **What:** Track portfolio PnL across mock trading, perpetual trading, and signal recommendations in a unified view
- **Why:** Users need a single pane of glass for all trading activity
- **How:** Aggregate data from `mock_trades`, `perpetual_mock_trades`, `signal_memory` into a new portfolio API
- **Files involved:** New `api/portfolio.js`, `public/index.html` new tab
- **Estimated effort:** 5-8 hours

---

### Priority: Medium

#### 4. 🤖 AI Trading Advisor Chat Enhancement
- **What:** Upgrade the AI chat panel with context-aware trading advice, strategy suggestions, and risk analysis
- **Why:** The current chat is basic — it should leverage TLL patterns and brain data for informed responses
- **How:** Feed TLL patterns, skills, and regime data into the AI chat context; add `/analyze` and `/suggest` commands
- **Files involved:** `api/advisor.js`, `public/index.html` AI tab, `lib/agent-signal-bus.js`
- **Estimated effort:** 4-6 hours

#### 5. 🔄 Automated Strategy Parameter Optimization
- **What:** Auto-tune strategy parameters (EMA periods, RSI thresholds, stop-loss levels) based on TLL pattern discovery
- **Why:** Static parameters underperform in changing market conditions
- **How:** Extend TLL learning engine to suggest parameter adjustments; store in `brain_strategy_weights` metadata
- **Files involved:** `lib/learning-layer/learning-engine.js`, `lib/learning-layer/weight-tuner.js`
- **Estimated effort:** 6-8 hours

#### 6. 📈 Market Regime Visualization
- **What:** Visual chart showing market regime transitions over time (trending → choppy → ranging → quiet)
- **Why:** Understanding regime history helps traders anticipate strategy performance
- **How:** Add a regime timeline chart using Canvas or Chart.js in the TLL dashboard
- **Files involved:** `public/tll-dashboard.html`, `public/tll-explain.html`
- **Estimated effort:** 3-4 hours

#### 7. 🧹 Data Retention & Cleanup Worker
- **What:** Automated cleanup of old signal data, stale patterns, and expired skills
- **Why:** `brain_signal_memory` and `tll_patterns` tables grow unbounded — will slow queries over time
- **How:** New worker that deletes records older than configurable TTL; runs daily
- **Files involved:** New `workers/data-retention-worker.js`, `ecosystem.config.cjs`
- **Estimated effort:** 2-3 hours

---

### Priority: Low

#### 8. 🌐 Multi-Language Telegram Reports
- **What:** Support for localized Telegram reports (English, Chinese, Japanese, Korean)
- **Why:** Trading is global — users in different timezones prefer different languages
- **How:** Add language preference to user settings; use translation map for report templates
- **Files involved:** `workers/tll-notification-worker.js`, `lib/telegram.js`
- **Estimated effort:** 3-5 hours

#### 9. 🎮 Gamification — Strategy Leaderboard
- **What:** Public leaderboard showing top-performing strategies with badges, streaks, and achievement system
- **Why:** Gamification increases engagement and encourages strategy experimentation
- **How:** Add `strategy_achievements` table; calculate streaks from `brain_signal_memory`; render leaderboard in dashboard
- **Files involved:** New `api/leaderboard.js`, `public/index.html`, new Supabase table
- **Estimated effort:** 4-6 hours

#### 10. 🔌 External Webhook Integration
- **What:** Allow users to configure webhooks that fire on specific TLL events (new pattern discovered, strategy quarantined, regime shift)
- **Why:** Enables integration with Discord, Slack, custom dashboards, or trading bots
- **How:** New `webhook_configs` table; webhook dispatcher in TLL pipeline; UI for managing webhooks
- **Files involved:** New `lib/webhook-dispatcher.js`, `api/webhooks.js`, `public/index.html`
- **Estimated effort:** 5-7 hours

#### 11. 📱 Mobile-Friendly Dashboard
- **What:** Responsive redesign of the main dashboard for mobile browsers
- **Why:** Traders check positions on-the-go; current layout breaks on small screens
- **How:** CSS media queries, collapsible sections, touch-friendly controls
- **Files involved:** `public/index.html` CSS section
- **Estimated effort:** 3-5 hours

#### 12. 🔐 Multi-User Support
- **What:** Allow multiple users with separate dashboards, preferences, and trading profiles
- **Why:** The bot currently supports a single user; multi-user enables team trading
- **How:** Add `users` table with auth; scope all queries by `user_id`; add login/signup flow
- **Files involved:** New `api/auth.js`, `lib/auth.js`, all API files, `public/index.html`
- **Estimated effort:** 10-15 hours (significant)

---

## 🏗️ Infrastructure & DevOps

| # | Item | Priority | Notes |
|---|------|----------|-------|
| 1 | **VPS Upgrade** — 2vCPU/4GB RAM | 🔴 Critical | Current 1vCPU/2GB is at 89% RAM, load avg 4.92 |
| 2 | **Ollama Optimization** — Reduce RAM/CPU usage | 🟡 High | 687MB RAM, 70% CPU — consider smaller model or offload |
| 3 | **Database Indexing** — Add indexes on `brain_signal_memory` | 🟡 High | Queries will slow as table grows |
| 4 | **PM2 Log Rotation** — Auto-rotate logs | 🟢 Medium | Prevent disk full from logs |
| 5 | **Docker Compose** — Containerize all services | 🟢 Low | Currently mixed Docker + PM2 |
| 6 | **CI/CD Pipeline** — GitHub Actions auto-deploy | 🟢 Low | Currently manual deploy via SSH |

---

## 🧠 TLL-Specific Improvements

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Bridge perpetual trader data → TLL | ✅ Done | `perpetual-trader-bridge.js` |
| 2 | Bridge research agent data → TLL | ✅ Done | `research-agent-bridge.js` |
| 3 | Bridge signal agent data → TLL | ✅ Done | `signal-agent-bridge.js` |
| 4 | Daily TLL Telegram summary | ✅ Done | `tll-notification-worker.js` |
| 5 | Risk-adjusted scoring in weight tuner | ✅ Done | `weight-tuner.js` |
| 6 | Strategy tournament (Elo ranking) | ✅ Done | `strategy-tournament.js` |
| 7 | TLL Explainability Dashboard | ✅ Done | `tll-explain.html` |
| 8 | **Multi-timeframe pattern analysis** | ⬜ Pending | Compare patterns across 15m/1h/4h |
| 9 | **Cross-symbol correlation patterns** | ⬜ Pending | BTC patterns affecting ETH, etc. |
| 10 | **Real-time pattern alerts via Telegram** | ⬜ Pending | Notify when high-confidence pattern emerges |
| 11 | **Backtest integration with TLL** | ⬜ Pending | Feed backtest results into pattern discovery |
| 12 | **Strategy cloning from top performers** | ⬜ Pending | Auto-generate new strategies from winning patterns |

---

## How to Use This Document

When starting a new session:
1. Scan the **Future Pipeline** sections above
2. Pick a feature based on current priority and available time
3. Create a detailed implementation plan in `plans/`
4. Implement, test, commit, push, and deploy
5. Update this document — move completed items to "Recently Completed"

---

*Maintained by SuperRoo — Last updated: 2026-05-18*
