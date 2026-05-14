# 🕷️ Dashboard Crawl & Feature Audit Report

**Date:** 2026-05-07 12:04 SGT  
**Scope:** Full dashboard tab crawl, API endpoint testing, feature verification  
**Server:** Local (localhost:3000)  
**Mode:** Paper trading  

---

## 📋 Executive Summary

The dashboard contains **16 tabs** across 4 categories (Trading, Intelligence, System, Development). All tabs render their UI shells, but **6 of 16 tabs show data loading failures**, **3 critical backend services are down**, and **multiple API endpoints return errors**. The system is operational but degraded.

---

## 🧭 Tab-by-Tab Audit Results

### Trading Category

| # | Tab | Status | Issues Found |
|---|-----|--------|-------------|
| 1 | **Overview** | ⚠️ Partial | TradingView ticker tape loads. Research Agent widget shows repeated Supabase warnings. Scorecard fails (Supabase ENOTFOUND). |
| 2 | **Signals** | ⚠️ Empty | "No signals yet" displayed. API `/api/signals` returns 401 Unauthorized (requires CRON_SECRET). No signal data visible. |
| 3 | **Perpetual Trader** | ❌ Failed | "Perpetual trader diagnostics failed." API returns errors. Diagnostics section broken. |
| 4 | **Mock Trading** | ✅ Working | Account balance ($10,000) shows. 0 trades (expected for fresh start). API returns valid data. |
| 5 | **Catalyst** | ❌ Failed | "Failed to load catalysts" error visible. However, direct API call to `/api/catalyst` returns rich data — **frontend rendering bug**. |

### Intelligence Category

| # | Tab | Status | Issues Found |
|---|-----|--------|-------------|
| 6 | **Research Agent** | ⚠️ Degraded | Stats show but Supabase-dependent data fails. Repeated `[research-agent-dashboard] Model load failed: logger is not defined`. Scorecard fails. |
| 7 | **News & Intel** | ❌ Failed | "Failed to load news" error visible. News store DB empty/stale, falling back to live RSS. |
| 8 | **AI Chat** | ✅ Working | Chat UI renders. However, backend AI providers (Kimi + Claude) both return 401 auth errors — chat will fail on send. |

### System Category

| # | Tab | Status | Issues Found |
|---|-----|--------|-------------|
| 9 | **Diagnostics** | ❌ Failed | "Failed to load diagnostics." Error elements visible. |
| 10 | **API Status** | ⚠️ Degraded | Shows "Failed to load status. The backend health endpoint may be unreachable." But `/api/health` works — **frontend rendering bug**. |

### Development Category

| # | Tab | Status | Issues Found |
|---|-----|--------|-------------|
| 11 | **Bugs** | ✅ Working | Bug list loads from API. Shows bug-fix pipeline stats. |
| 12 | **API Debugger** | ✅ Working | API debugger dashboard loads. Worker is running (interval: 600000ms). |
| 13 | **Product Features** | ✅ Working | Feature inventory loads. Health checks run. |
| 14 | **App Dev Proposals** | ✅ Working | Proposals and dev pipeline load. |
| 15 | **Product Updates** | ✅ Working | Update history loads. |
| 16 | **Deploy Status** | ✅ Working | Deployment status loads. |
| 17 | **Autonomous** | ✅ Working | Autonomous session data loads. |

---

## 🐛 Critical Bugs Found

### B1 — Supabase Connection Broken (CRITICAL)
```
[Scorecard] GetAll error: TypeError: fetch failed
Caused by: Error: getaddrinfo ENOTFOUND your-project.supabase.co
```
**Root Cause:** `SUPABASE_URL` in `.env` is still set to `your-project.supabase.co` (placeholder). No real Supabase project configured.  
**Impact:** All Supabase-dependent features fail: Research Agent data, Scorecard, signal persistence, trade history storage.  
**Affected Tabs:** Overview, Research Agent, Signals, Perpetual Trader, Mock Trading (scorecard)

### B2 — AI Provider Authentication Failure (CRITICAL)
```
[AI] kimi failed, falling back to claude: 401 Invalid Authentication
[AI] claude fallback also failed: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}
```
**Root Cause:** Both KIMI_API_KEY and ANTHROPIC_API_KEY are invalid/expired.  
**Impact:** AI Chat tab cannot respond. Research Agent neural review fails. API Debugger neural review fails. Strategy evaluation AI features broken.  
**Affected Tabs:** AI Chat, Research Agent, API Debugger

### B3 — Frontend Data Loading Failures (HIGH)
Multiple tabs show "Failed to load" messages despite their backend APIs working correctly:
- **Catalyst tab:** Shows "Failed to load catalysts" but `/api/catalyst` returns 200 with rich data
- **API Status tab:** Shows "Failed to load status" but `/api/health` returns 200 OK
- **Diagnostics tab:** Shows "Failed to load diagnostics" — API may need investigation

**Root Cause:** Likely frontend JavaScript errors preventing data from rendering, or incorrect API URL construction in the dashboard JS.

### B4 — Research Agent Model Load Failure (MEDIUM)
```
[research-agent-dashboard] Model load failed: logger is not defined
```
**Root Cause:** `logger` is referenced but not imported/defined in the research agent dashboard module.  
**Impact:** Research agent dashboard data partially loads but model evaluation fails.

### B5 — API Debugger Worker Cycle Error (MEDIUM)
```
[api-debugger-worker] Cycle error: Cannot read properties of null (reading 'id')
```
**Root Cause:** Null reference when trying to read `id` property from an undefined object in the debugger worker cycle.  
**Impact:** API debugger worker runs but fails to persist results.

### B6 — Protected Routes Block Dashboard Data (MEDIUM)
`/api/signals`, `/api/market`, `/api/bot`, `/api/learning`, `/api/weekly-analysis` are all protected by `CRON_SECRET`. The dashboard frontend calls these without the secret header, causing 401 errors.  
**Impact:** Signals tab shows empty data. Market data doesn't auto-refresh.

### B7 — Telegram Bot Unconfigured (LOW)
```
"telegram": {"ok": false, "username": null}
```
**Root Cause:** `TELEGRAM_BOT_TOKEN` not configured or invalid.  
**Impact:** No Telegram notifications for signals.

### B8 — LunarCrush Data Feed Failing (LOW)
```
"lunarcrush": {"ok": false, "configured": true}
```
**Root Cause:** LunarCrush API key missing or expired.  
**Impact:** Social sentiment data unavailable.

---

## ✅ Working Features (Verified)

| Feature | Status | Notes |
|---------|--------|-------|
| Exchange API Connections (Binance, Bybit, OKX, Hyperliquid) | ✅ | All 4 exchanges respond with valid latency |
| CoinGecko Price Feed | ✅ | 381ms latency |
| OKX Funding Rate | ✅ | 200ms latency |
| Mock Trading Engine | ✅ | Account created, balance tracking works |
| Bug Tracking System | ✅ | Bugs tab loads and displays data |
| API Debugger Worker | ✅ | Running on 10-min cycle |
| Product Features Inventory | ✅ | Feature list and health checks work |
| App Dev Proposals | ✅ | Proposals and pipeline load |
| Product Updates | ✅ | Update history available |
| Deploy Status | ✅ | Deployment tracking works |
| Autonomous Session Tracking | ✅ | Session data loads |
| Catalyst Data API | ✅ | Rich market intelligence data available |
| Version/Commit Info | ✅ | `/api/version` returns full git info |
| System Health API | ✅ | `/api/system-health` responds |

---

## 💡 Improvement Suggestions

### S1 — Fix Supabase Configuration (P0)
Replace placeholder `SUPABASE_URL` and keys with real Supabase project credentials. This unblocks ~40% of dashboard features.

### S2 — Fix AI API Keys (P0)
Update `KIMI_API_KEY` and `ANTHROPIC_API_KEY` with valid credentials. Consider adding OpenAI as a third fallback provider.

### S3 — Fix Frontend Data Binding (P1)
Investigate why Catalyst and API Status tabs show "Failed to load" despite their APIs working. Likely issues:
- Check `fetch()` error handling in dashboard JS — may be catching network errors incorrectly
- Verify the JS constructs correct API URLs (check for path mismatches)
- Add console.error logging in catch blocks for debugging

### S4 — Add CRON_SECRET to Dashboard Requests (P1)
The dashboard frontend should include `?secret=` query param or `x-cron-secret` header when calling protected routes. Either:
- Store CRON_SECRET in a server-side session and inject into page
- Or make protected routes accessible via a proxy endpoint that adds the secret server-side

### S5 — Fix `logger is not defined` Error (P1)
In [`api/research-agent-dashboard.js`](api/research-agent-dashboard.js), add `import logger from '../lib/logger.js'` (or define a local logger).

### S6 — Fix API Debugger Worker Null Reference (P2)
In [`workers/api-debugger-worker.js`](workers/api-debugger-worker.js), add null checks before accessing `.id` on objects.

### S7 — Add Loading States & Error Boundaries (P2)
Many tabs show permanent "Failed to load" messages with no retry mechanism. Add:
- Retry buttons on failed sections
- Skeleton loading states during data fetch
- Toast notifications for transient errors

### S8 — Implement Signal Generation (P2)
Signals tab shows "No signals yet" because no signal workers are actively generating. Either:
- Run the signal generator worker manually
- Or trigger signal generation via the API with CRON_SECRET

### S9 — Add News Store Seeding (P2)
News store DB is empty/stale. Run the news ingestion pipeline to populate it, or seed with historical data.

### S10 — Add Dashboard Health Check Endpoint (P3)
Create a `/api/dashboard-health` endpoint that the frontend can poll to verify all backend services are reachable, rather than showing generic "Failed to load" messages.

### S11 — Implement PWA Offline Support (P3)
The `sw.js` service worker exists but may not be fully functional. Test and complete offline caching for dashboard assets.

### S12 — Add Tab Usage Analytics (P3)
Track which tabs users visit most frequently to optimize the tab ordering and "More" menu placement.

---

## 📊 System Health Summary

| Service | Status | Latency |
|---------|--------|---------|
| Express Server | ✅ Running | — |
| Binance API | ✅ OK | 925ms |
| Bybit API | ✅ OK | 1633ms |
| OKX API | ✅ OK | 1014ms |
| Hyperliquid API | ✅ OK | 166ms |
| CoinGecko | ✅ OK | 381ms |
| OKX Funding | ✅ OK | 200ms |
| **Supabase** | ❌ ENOTFOUND | — |
| **Telegram Bot** | ❌ Invalid Token | 921ms |
| **Kimi AI** | ❌ 401 Auth | 1790ms |
| **Claude AI** | ❌ 401 Auth | 379ms |
| **LunarCrush** | ❌ Failed | 445ms |

---

## 🚀 Action Items (Priority Order)

1. **🔴 P0:** Configure real Supabase project credentials
2. **🔴 P0:** Fix AI provider API keys (Kimi + Claude)
3. **🟠 P1:** Debug frontend data loading for Catalyst & API Status tabs
4. **🟠 P1:** Add CRON_SECRET to dashboard API calls for protected routes
5. **🟠 P1:** Fix `logger is not defined` in research-agent-dashboard
6. **🟡 P2:** Fix API debugger worker null reference
7. **🟡 P2:** Add retry mechanisms and loading states to dashboard
8. **🟡 P2:** Seed news store and trigger signal generation
9. **🟢 P3:** Add dashboard health endpoint
10. **🟢 P3:** Complete PWA offline support

---

*Report generated by autonomous dashboard crawl on 2026-05-07T04:16:00Z*
