# Codex API Wiring Plan — Remaining 25 Backend APIs

## Overview
Wire 25 remaining backend APIs (no frontend UI) into 4 new dashboard tabs.

## Tab 1: Operations Center
| API | Method | UI Component |
|-----|--------|-------------|
| /api/config | GET | Config card (deployment_target, trading_mode, features) |
| /api/dashboard-health | GET | Health metrics (uptime, memory, nodeVersion, apiCount) |
| /api/data-health | GET | Data freshness table (exchanges, freshness, alerts) |
| /api/pm2-status | GET | PM2 process table (processes, memory, CPU, restarts) |
| /api/deployment-dashboard | GET | Deploy status (commits, git status, deploy queue) |
| /api/learning | GET | Learning loop status (pending_suggestions, last_loop) |

## Tab 2: Analytics Engine
| API | Method | UI Component |
|-----|--------|-------------|
| /api/analyze | GET | Symbol analysis (bias, confidence, scores) |
| /api/backtest | POST | Backtest runner (trades, winRate, profitFactor) |
| /api/weekly-analysis | POST | Weekly report (PnL, winRate, strategyStats) |
| /api/mock-feedback | GET | Feedback table (strategy feedback, promoted) |
| /api/research-agent | GET | Research output (promotedStrategies, rankings) |

## Tab 3: AI Lab
| API | Method | UI Component |
|-----|--------|-------------|
| /api/advisor | POST | Trading advisor (recommendation, risk, reasoning) |
| /api/ask | POST | Q&A chat (AI answer to trading questions) |
| /api/openclaw | GET/POST | Code analysis (analysis types, repo analysis) |
| /api/openclaw-telegram | GET/POST | Trading Q&A context |
| /api/ml-predict | POST | ML prediction (prediction, confidence) |

## Tab 4: Bot Control
| API | Method | UI Component |
|-----|--------|-------------|
| /api/bot | GET | Bot dashboard (suggestions, sources, patterns) |
| /api/agent-improvement | GET | Improvement ideas (ideas, summary) |

## Read-Only Status Displays (Cron Protected)
- /api/news-ingest — Last ingest time, bridged count
- /api/news-signal — Scan status, last signal
- /api/mock-inject — Inject config, test signals
- /api/signals — Signal generation status
- /api/telegram — Bot info, command list

## Implementation Order
1. Add 4 new tab HTML panels to index.html
2. Add nav buttons for new tabs
3. Add JavaScript loader functions
4. Update switchTab() with new loaders
5. Commit, push, deploy via Tailscale
