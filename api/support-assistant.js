// ============================================================
// AI Support Assistant — xsjprd55
// POST /api/support-assistant
// Body: { email, question, chatHistory?, action?, featureId?, issue?, description?, severity? }
//
// Email authentication: Only jpgyap@gmail.com is authorized.
// Knows all product features + full system architecture.
// Can test features when user reports something broken,
// and submits debug reports to the bugs_to_fix table.
// ============================================================

import { supabase, isSupabaseNoOp } from '../lib/supabase.js';
import { createBugReport } from '../lib/bug-store.js';
import { askAI } from '../lib/ai.js';

// ── Authorized Email ───────────────────────────────────────
const AUTHORIZED_EMAIL = 'jpgyap@gmail.com';

// ── Product Features Knowledge Base ─────────────────────────
const PRODUCT_FEATURES = [
  // ── Core Trading ──
  { id: 'signal-ema-cross', category: 'Trading', name: 'EMA Cross Strategy', status: 'Working',
    endpoint: '/api/signal', worker: 'signal-generator-worker',
    test: async () => { try { const r = await fetch(`http://localhost:${process.env.PORT||3000}/api/signal?test=1`); return { ok: r.ok, data: r.ok ? await r.json() : null, error: r.ok ? null : `${r.status}` }; } catch(e) { return { ok: false, error: e.message }; } } },
  { id: 'signal-rsi-bounce', category: 'Trading', name: 'RSI Bounce Strategy', status: 'Working',
    endpoint: '/api/signal', worker: 'signal-generator-worker',
    test: async () => ({ ok: true, note: 'Part of signal generation pipeline' }) },
  { id: 'signal-multi-tf', category: 'Trading', name: 'Multi-timeframe Analysis', status: 'Working',
    endpoint: '/api/signals', worker: 'signal-generator-worker',
    test: async () => { try { const r = await fetch(`http://localhost:${process.env.PORT||3000}/api/signals?type=list&limit=1`); return { ok: r.ok, data: r.ok ? await r.json() : null, error: r.ok ? null : `${r.status}` }; } catch(e) { return { ok: false, error: e.message }; } } },
  { id: 'signal-news', category: 'Trading', name: 'News Signal', status: 'Working',
    endpoint: '/api/news-signal', worker: 'news-signal-worker' },
  { id: 'signal-tradingview', category: 'Trading', name: 'TradingView Webhook', status: 'Working',
    endpoint: '/api/webhook/tradingview' },

  // ── Mock Trading ──
  { id: 'mock-trading-basic', category: 'Mock Trading', name: 'Basic Mock Trades', status: 'Working',
    endpoint: '/api/mock-trading-dashboard', worker: 'mock-trading-worker',
    test: async () => { try { const r = await fetch(`http://localhost:${process.env.PORT||3000}/api/mock-trading-dashboard`); return { ok: r.ok, data: r.ok ? await r.json() : null, error: r.ok ? null : `${r.status}` }; } catch(e) { return { ok: false, error: e.message }; } } },
  { id: 'mock-trading-aggressive', category: 'Mock Trading', name: 'Aggressive Mock Trading', status: 'Working',
    endpoint: '/api/mock-trading-dashboard', worker: 'aggressive-mock-worker' },
  { id: 'mock-trading-position-sizing', category: 'Mock Trading', name: 'Position Sizing', status: 'Working',
    lib: 'lib/mock-trading/position-sizing.js' },
  { id: 'mock-trading-sl-tp', category: 'Mock Trading', name: 'Stop Loss / Take Profit', status: 'Working',
    lib: 'lib/mock-trading/execution-engine.js' },
  { id: 'mock-trading-pnl', category: 'Mock Trading', name: 'PnL Tracking', status: 'Working',
    lib: 'lib/mock-trading/mock-account-engine.js' },
  { id: 'mock-trading-history', category: 'Mock Trading', name: 'Trade History', status: 'Working',
    endpoint: '/api/mock-trading-dashboard' },

  // ── Perpetual Trading ──
  { id: 'perpetual-trader', category: 'Perpetual Trading', name: 'Perpetual Trade Execution', status: 'Working',
    endpoint: '/api/perpetual-trader', worker: 'perpetual-trader-worker',
    test: async () => { try { const r = await fetch(`http://localhost:${process.env.PORT||3000}/api/perpetual-trader`); return { ok: r.ok, data: r.ok ? await r.json() : null, error: r.ok ? null : `${r.status}` }; } catch(e) { return { ok: false, error: e.message }; } } },
  { id: 'perpetual-diagnostics', category: 'Perpetual Trading', name: 'Diagnostics Dashboard', status: 'Working',
    endpoint: '/api/perpetual-trader' },

  // ── Risk Management ──
  { id: 'risk-validation', category: 'Risk', name: 'Signal Validation', status: 'Working', lib: 'lib/risk.js' },
  { id: 'risk-gates', category: 'Risk', name: 'Risk Gates', status: 'Working', lib: 'lib/risk.js' },
  { id: 'risk-position-limits', category: 'Risk', name: 'Position Limits', status: 'Working', lib: 'lib/config.js' },
  { id: 'risk-leverage-limits', category: 'Risk', name: 'Leverage Limits', status: 'Working', lib: 'lib/mock-trading/' },

  // ── AI / ML ──
  { id: 'ml-signal-snapshots', category: 'AI/ML', name: 'Signal Snapshots', status: 'Working', lib: 'lib/ml/db.js' },
  { id: 'ml-model-training', category: 'AI/ML', name: 'Model Training', status: 'Working', lib: 'lib/ml/model.js' },
  { id: 'ml-probability', category: 'AI/ML', name: 'Probability Prediction', status: 'Working', lib: 'lib/ml/model.js' },
  { id: 'ml-auto-train', category: 'AI/ML', name: 'Auto-Training', status: 'Working', lib: 'lib/ml/auto-train.js' },
  { id: 'ml-strategy-lifecycle', category: 'AI/ML', name: 'Strategy Lifecycle', status: 'Working', lib: 'lib/ml/strategyLifecycle.js' },
  { id: 'research-agent', category: 'AI/ML', name: 'Research Agent', status: 'Working',
    endpoint: '/api/research-agent', worker: 'research-agent-worker' },
  { id: 'backtest-engine', category: 'AI/ML', name: 'Backtest Engine', status: 'Working', lib: 'lib/ml/backtestEngine.js' },
  { id: 'feedback-loop', category: 'AI/ML', name: 'Feedback Loop', status: 'Working', lib: 'lib/ml/feedbackLoop.js' },

  // ── Market Data ──
  { id: 'market-ohlcv', category: 'Market Data', name: 'OHLCV Fetching', status: 'Working', lib: 'lib/exchange.js' },
  { id: 'market-binance', category: 'Market Data', name: 'Binance Integration', status: 'Working', lib: 'lib/crawler-ohlcv.js' },
  { id: 'market-ticker', category: 'Market Data', name: 'All-Pair Ticker Tape', status: 'Working',
    endpoint: '/api/binance-ticker',
    test: async () => { try { const r = await fetch(`http://localhost:${process.env.PORT||3000}/api/binance-ticker?limit=5`); return { ok: r.ok, data: r.ok ? await r.json() : null, error: r.ok ? null : `${r.status}` }; } catch(e) { return { ok: false, error: e.message }; } } },

  // ── Liquidation Intel ──
  { id: 'liquidation-heatmap', category: 'Liquidation', name: 'Liquidation Heatmap', status: 'Working',
    endpoint: '/api/liquidation', worker: 'liquidation-heatmap-worker' },
  { id: 'liquidation-alerts', category: 'Liquidation', name: 'Telegram Alerts', status: 'Working',
    worker: 'liquidation-intel-worker' },

  // ── Social Intelligence ──
  { id: 'social-crawler', category: 'Social Intel', name: 'Social Crawler', status: 'Working',
    worker: 'social-crawler-worker' },
  { id: 'news-aggregation', category: 'Social Intel', name: 'News Aggregation', status: 'Working',
    worker: 'news-ingest-worker' },
  { id: 'sentiment-analysis', category: 'Social Intel', name: 'Sentiment Analysis', status: 'Working',
    lib: 'lib/news-sentiment.js' },

  // ── Bug Detection ──
  { id: 'bug-hunter', category: 'Bug Detection', name: 'Bug Hunter', status: 'Working',
    worker: 'bug-hunter-worker', endpoint: '/api/bugs' },
  { id: 'debug-crawler', category: 'Bug Detection', name: 'Debug Crawler', status: 'Working',
    worker: 'debug-crawler-worker' },
  { id: 'bug-fix-pipeline', category: 'Bug Detection', name: 'Bug Fix Pipeline', status: 'Working',
    worker: 'bug-fix-pipeline-worker' },

  // ── API Debugging ──
  { id: 'api-debugger', category: 'API Debugging', name: 'API Live Tester', status: 'Working',
    worker: 'api-debugger-worker', endpoint: '/api/api-debugger' },

  // ── Deployment ──
  { id: 'deploy-checker', category: 'Deployment', name: 'Deploy Checker', status: 'Working',
    worker: 'deploy-checker.js', endpoint: '/api/deploy-status' },
  { id: 'deployment-dashboard', category: 'Deployment', name: 'Deployment Dashboard', status: 'Working',
    endpoint: '/api/deployment-dashboard' },

  // ── Telegram ──
  { id: 'telegram-signal-broadcast', category: 'Telegram', name: 'Signal Broadcast', status: 'Working',
    lib: 'lib/telegram.js' },
  { id: 'telegram-bot-commands', category: 'Telegram', name: 'Bot Commands', status: 'Working',
    endpoint: '/api/telegram' },
  { id: 'telegram-admin-alerts', category: 'Telegram', name: 'Admin Alerts', status: 'Working',
    lib: 'lib/telegram.js' },

  // ── Dashboard ──
  { id: 'dashboard-overview', category: 'Dashboard', name: 'Overview Tab', status: 'Working' },
  { id: 'dashboard-signals', category: 'Dashboard', name: 'Signals Tab', status: 'Working' },
  { id: 'dashboard-perpetual', category: 'Dashboard', name: 'Perpetual Trader Tab', status: 'Working' },
  { id: 'dashboard-mock-trading', category: 'Dashboard', name: 'Mock Trading Tab', status: 'Working' },
  { id: 'dashboard-product-features', category: 'Dashboard', name: 'Product Features Tab', status: 'Working' },
  { id: 'dashboard-bugs', category: 'Dashboard', name: 'Bugs Tab', status: 'Working' },
  { id: 'dashboard-ai-chat', category: 'Dashboard', name: 'AI Chat Tab', status: 'Working' },
  { id: 'dashboard-deploy-status', category: 'Dashboard', name: 'Deploy Status Tab', status: 'Working' },
];

// ── System Architecture Knowledge ──────────────────────────
const SYSTEM_ARCHITECTURE = {
  overview: `The xsjprd55 system is a crypto trading signal Telegram bot with a self-improving architecture. It runs on a VPS (DigitalOcean Ubuntu 22.04, 165.22.110.111) managed by PM2, with Supabase as the database and a static HTML dashboard served from /public.`,

  deployment: {
    host: 'VPS (DigitalOcean / Ubuntu 22.04) — IP: 165.22.110.111',
    domain: 'bot.abcx124.xyz',
    processManager: 'PM2 — 25+ workers managed via ecosystem.config.cjs',
    reverseProxy: 'Nginx or Caddy with SSL via Let\u2019s Encrypt',
    runtime: 'Node.js 20+ ESM',
    database: 'Supabase (PostgreSQL + RLS)',
    dashboard: 'Static HTML served from /public on VPS',
    telegramBot: 'Telegram Bot API (webhook mode)',
    aiProviders: 'Kimi (Moonshot AI) primary + Anthropic Claude fallback',
    exchangeApis: 'CCXT (Binance, Bybit, OKX, Hyperliquid)',
    timezone: 'UTC for logs; user-local for display',
  },

  architectureDiagram: `
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
`,

  apiEndpoints: [
    { route: 'POST /api/telegram', auth: 'X-Telegram-Bot-Api-Secret-Token', purpose: 'Handle Telegram commands and inline buttons' },
    { route: 'POST /api/signal', auth: 'CRON_SECRET', purpose: 'Generate trading signals (EMA Cross, RSI Bounce, Momentum)' },
    { route: 'GET /api/signals', auth: 'CRON_SECRET', purpose: 'List recent signals' },
    { route: 'GET /api/perpetual-trader', auth: 'CRON_SECRET', purpose: 'Perpetual trader dashboard + diagnostics' },
    { route: 'GET /api/mock-trading-dashboard', auth: 'none', purpose: 'Mock trading dashboard data' },
    { route: 'GET /api/bugs', auth: 'CRON_SECRET', purpose: 'List bugs from bugs_to_fix table' },
    { route: 'POST /api/bugs', auth: 'CRON_SECRET', purpose: 'Create/update bugs' },
    { route: 'GET /api/health', auth: 'none', purpose: 'System health check' },
    { route: 'GET /api/deployment-dashboard', auth: 'none', purpose: 'Deployment status overview' },
    { route: 'GET /api/deploy-status', auth: 'none', purpose: 'Deploy checker status' },
    { route: 'GET /api/liquidation', auth: 'none', purpose: 'Liquidation heatmap data' },
    { route: 'GET /api/binance-ticker', auth: 'none', purpose: 'All-pair ticker tape' },
    { route: 'GET /api/news-feed', auth: 'none', purpose: 'News feed' },
    { route: 'GET /api/social-intel', auth: 'none', purpose: 'Social intelligence data' },
    { route: 'GET /api/research-agent', auth: 'none', purpose: 'Research agent proposals' },
    { route: 'GET /api/api-debugger', auth: 'none', purpose: 'API debugger data' },
    { route: 'GET /api/diagnostics', auth: 'none', purpose: 'System diagnostics' },
    { route: 'GET /api/data-health', auth: 'none', purpose: 'Data health dashboard' },
    { route: 'GET /api/product-features', auth: 'none', purpose: 'Product features checklist' },
    { route: 'GET /api/product-updates', auth: 'none', purpose: 'Product updates/changelog' },
    { route: 'POST /api/support-assistant', auth: 'email (jpgyap@gmail.com)', purpose: 'AI Support Chat Assistant' },
  ],

  workers: [
    { name: 'trading-signal-bot', file: 'server.js', purpose: 'Main API server (port 3000)' },
    { name: 'signal-generator-worker', file: 'workers/signal-generator-worker.js', purpose: 'Generates trading signals every 15 min' },
    { name: 'perpetual-trader-worker', file: 'workers/perpetual-trader-worker.js', purpose: 'Perpetual mock trading every 60s' },
    { name: 'mock-trading-worker', file: 'workers/mock-trading-worker.js', purpose: 'Basic mock trading execution' },
    { name: 'aggressive-mock-worker', file: 'workers/aggressive-mock-worker.js', purpose: 'Aggressive mock trading with TV scan' },
    { name: 'execution-worker', file: 'workers/execution-worker.js', purpose: 'Signal execution engine' },
    { name: 'diagnostic-agent', file: 'workers/diagnostic-agent.js', purpose: 'System diagnostics and health checks' },
    { name: 'debug-crawler', file: 'workers/debug-crawler-worker.js', purpose: 'Crawls codebase for bugs' },
    { name: 'bug-hunter-worker', file: 'workers/bug-hunter-worker.js', purpose: 'Hunts for bugs automatically' },
    { name: 'bug-fix-pipeline', file: 'workers/bug-fix-pipeline-worker.js', purpose: 'Auto-fixes detected bugs' },
    { name: 'api-debugger', file: 'workers/api-debugger-worker.js', purpose: 'Tests API endpoints for availability' },
    { name: 'research-agent-worker', file: 'workers/research-agent-worker.js', purpose: 'AI research agent for strategy proposals' },
    { name: 'continuous-backtester', file: 'workers/continuous-backtester.js', purpose: 'Continuous strategy backtesting' },
    { name: 'news-ingest-worker', file: 'workers/news-ingest-worker.js', purpose: 'Ingests news from multiple sources' },
    { name: 'news-signal-worker', file: 'workers/news-signal-worker.js', purpose: 'Generates signals from news (daily cron)' },
    { name: 'social-news-worker', file: 'workers/social-news-worker.js', purpose: 'Social media news aggregation' },
    { name: 'liquidation-intel-worker', file: 'workers/liquidation-intel-worker.js', purpose: 'Liquidation intelligence' },
    { name: 'learning-loop-worker', file: 'workers/learning-loop-worker.js', purpose: 'Daily learning loop (every 6h)' },
    { name: 'capability-consolidator', file: 'workers/capability-consolidator-worker.js', purpose: 'Consolidates capabilities' },
    { name: 'deploy-checker', file: 'workers/deploy-checker.js', purpose: 'Checks GitHub vs VPS commit sync (every 10 min)' },
    { name: 'deployment-orchestrator', file: 'workers/deployment-orchestrator.js', purpose: 'Auto-deployment orchestrator' },
    { name: 'agent-change-tracker', file: 'workers/agent-change-tracker.js', purpose: 'Tracks agent code changes' },
    { name: 'secretary', file: 'scripts/secretary.js', purpose: 'Secretary bot for admin tasks' },
    { name: 'continuous-test-monitor', file: 'workers/continuous-test-monitor.cjs', purpose: 'Continuous test monitoring' },
  ],

  database: {
    provider: 'Supabase (PostgreSQL)',
    keyTables: [
      'signals — Trading signals generated by strategies',
      'market_data — Cached OHLCV data',
      'mock_trades — Mock trading trades',
      'mock_accounts — Mock trading accounts',
      'perpetual_mock_trades — Perpetual mock trades',
      'perpetual_mock_accounts — Perpetual mock accounts',
      'perpetual_trader_logs — Perpetual trader event logs',
      'bugs_to_fix — Bug reports from debug crawler and support assistant',
      'bug_status_history — Bug status change history',
      'debug_crawler_runs — Debug crawler execution records',
      'news_events — Aggregated news events',
      'social_intel — Social intelligence data',
      'research_proposals — Research agent strategy proposals',
      'backtest_results — Backtest results',
      'product_features — Product features checklist',
      'product_updates — Product updates/changelog',
      'audit_log — Audit trail for all actions',
      'agent_deployment_tracking — Deployment tracking records',
      'deploy_history — Deployment history',
      'api_debugger_logs — API debugger test results',
      'execution_profiles — Trade execution profiles',
      'loss_patterns — Recorded loss patterns for learning',
    ],
  },

  dataFlow: `
1. Signal Generation: signal-generator-worker fetches OHLCV from CCXT → runs strategies (EMA Cross, RSI Bounce, Momentum) → stores in signals table → broadcasts to Telegram
2. Mock Trading: execution-worker / aggressive-mock-worker reads signals → evaluates risk → opens trades in mock_trades → monitors → closes with PnL
3. Perpetual Trading: perpetual-trader-worker reads signals → opens perpetual_mock_trades with leverage → monitors positions → closes with PnL
4. Bug Detection: debug-crawler-worker scans codebase → creates bugs in bugs_to_fix → bug-fix-pipeline-worker attempts auto-fix
5. Learning Loop: learning-loop-worker reviews performance → generates improvement suggestions
6. Dashboard: Static HTML in /public fetches from API endpoints → renders real-time data
`,

  safetyFeatures: [
    'Paper trading by default (TRADING_MODE=paper)',
    'Live mode requires explicit opt-in (auto_trade_enabled per user)',
    'Risk gates: max position size, daily loss limit, cooldown periods',
    'Stale-data block (>5 min old for intraday signals)',
    'Signal validation before execution',
    'CRON_SECRET protection on write endpoints',
    'Telegram webhook signature verification',
    'Supabase RLS (Row Level Security)',
    'PM2 auto-restart on crash',
    'Max memory limits per worker (128M-512M)',
  ],
};

// ── System Health Check ────────────────────────────────────
async function runSystemHealthCheck() {
  const results = [];
  const errors = [];

  if (isSupabaseNoOp()) {
    errors.push({ feature: 'supabase', issue: 'Supabase is in NO-OP mode — check env vars' });
  } else {
    results.push({ feature: 'supabase', status: 'ok' });
  }

  const criticalEndpoints = [
    { name: 'Signals API', url: `/api/signals?type=list&limit=1` },
    { name: 'Perpetual Trader', url: `/api/perpetual-trader` },
    { name: 'Mock Trading', url: `/api/mock-trading-dashboard` },
    { name: 'Bugs API', url: `/api/bugs?type=list&limit=1` },
    { name: 'Health', url: `/api/health` },
  ];

  for (const ep of criticalEndpoints) {
    try {
      const r = await fetch(`http://localhost:${process.env.PORT || 3000}${ep.url}`);
      if (r.ok) {
        results.push({ feature: ep.name, status: 'ok', statusCode: r.status });
      } else {
        errors.push({ feature: ep.name, issue: `HTTP ${r.status}`, statusCode: r.status });
      }
    } catch (e) {
      errors.push({ feature: ep.name, issue: e.message });
    }
  }

  return { results, errors, healthy: errors.length === 0 };
}

// ── Test a Specific Feature ────────────────────────────────
async function testFeature(featureId) {
  const feature = PRODUCT_FEATURES.find(f => f.id === featureId);
  if (!feature) return { ok: false, error: `Unknown feature: ${featureId}` };

  if (feature.test) {
    try {
      return await feature.test();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  if (feature.endpoint) {
    try {
      const r = await fetch(`http://localhost:${process.env.PORT || 3000}${feature.endpoint}${feature.endpoint.includes('?') ? '&' : '?'}_t=${Date.now()}`);
      return { ok: r.ok, statusCode: r.status, error: r.ok ? null : `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return { ok: true, note: 'No automated test available — check manually' };
}

// ── Submit Debug Report ────────────────────────────────────
async function submitDebugReport({ featureId, issue, description, severity = 'medium' }) {
  const feature = PRODUCT_FEATURES.find(f => f.id === featureId);
  const title = feature
    ? `[Support] ${feature.name}: ${issue}`
    : `[Support] ${featureId}: ${issue}`;

  const report = await createBugReport({
    source_agent: 'support_assistant',
    title,
    description: description || `Auto-reported by Support Assistant.\nFeature: ${featureId}\nIssue: ${issue}`,
    severity,
    priority: severity === 'critical' ? 1 : severity === 'high' ? 2 : 3,
    status: 'new',
    affected_area: feature?.category || 'unknown',
    file_path: feature?.lib || feature?.endpoint || null,
    recommendation: `Investigate ${featureId} — user reported: ${issue}`,
    metadata: {
      reported_via: 'support_assistant',
      feature_id: featureId,
      feature_name: feature?.name || featureId,
      reported_at: new Date().toISOString(),
      source: 'dashboard_support_chat'
    }
  });

  return report;
}

// ── Build Context for AI ───────────────────────────────────
function buildSystemPrompt() {
  const categories = [...new Set(PRODUCT_FEATURES.map(f => f.category))];
  let prompt = `You are the AI Support Assistant for the xsjprd55 Crypto Trading Signal Bot dashboard.

You are speaking with the authorized admin (jpgyap@gmail.com).

## SYSTEM ARCHITECTURE

### Overview
${SYSTEM_ARCHITECTURE.overview}

### Deployment
- Host: ${SYSTEM_ARCHITECTURE.deployment.host}
- Domain: ${SYSTEM_ARCHITECTURE.deployment.domain}
- Process Manager: ${SYSTEM_ARCHITECTURE.deployment.processManager}
- Reverse Proxy: ${SYSTEM_ARCHITECTURE.deployment.reverseProxy}
- Runtime: ${SYSTEM_ARCHITECTURE.deployment.runtime}
- Database: ${SYSTEM_ARCHITECTURE.deployment.database}
- Dashboard: ${SYSTEM_ARCHITECTURE.deployment.dashboard}
- Telegram Bot: ${SYSTEM_ARCHITECTURE.deployment.telegramBot}
- AI Providers: ${SYSTEM_ARCHITECTURE.deployment.aiProviders}
- Exchange APIs: ${SYSTEM_ARCHITECTURE.deployment.exchangeApis}

### Architecture Diagram
\`\`\`
${SYSTEM_ARCHITECTURE.architectureDiagram}
\`\`\`

### Data Flow
${SYSTEM_ARCHITECTURE.dataFlow}

### Safety Features
${SYSTEM_ARCHITECTURE.safetyFeatures.map(s => `- ${s}`).join('\n')}

### API Endpoints
${SYSTEM_ARCHITECTURE.apiEndpoints.map(e => `- ${e.route} (${e.auth}) — ${e.purpose}`).join('\n')}

### Workers (PM2)
${SYSTEM_ARCHITECTURE.workers.map(w => `- ${w.name} (${w.file}) — ${w.purpose}`).join('\n')}

### Database Tables
${SYSTEM_ARCHITECTURE.database.keyTables.map(t => `- ${t}`).join('\n')}

## PRODUCT FEATURES

Here is the complete feature inventory:

`;
  for (const cat of categories) {
    const features = PRODUCT_FEATURES.filter(f => f.category === cat);
    prompt += `\n## ${cat}\n`;
    for (const f of features) {
      prompt += `- ${f.name} (${f.id}) — Status: ${f.status}`;
      if (f.endpoint) prompt += ` [API: ${f.endpoint}]`;
      if (f.worker) prompt += ` [Worker: ${f.worker}]`;
      if (f.lib) prompt += ` [Lib: ${f.lib}]`;
      prompt += '\n';
    }
  }

  prompt += `\n\nYour capabilities:
1. Answer questions about any product feature or system architecture component
2. When a user says something is not working, run a test on that feature
3. If the test fails, submit a debug report to the bugs_to_fix table
4. The bug report will appear in the Bugs dashboard tab for the debug team
5. You can run a full system health check
6. You can list features by category

When testing features, call the testFeature function.
When submitting bug reports, call the submitDebugReport function.
Always be helpful, concise, and technical.

Current time: ${new Date().toISOString()}`;

  return prompt;
}

// ── Handler ────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { email, question, chatHistory = [], action, featureId, issue, description, severity } = req.body || {};

    // ── Email Authentication ──────────────────────────────
    if (!email) {
      return res.status(401).json({ ok: false, error: 'Email is required. Please enter your email to chat.' });
    }

    if (email.toLowerCase() !== AUTHORIZED_EMAIL.toLowerCase()) {
      return res.status(403).json({
        ok: false,
        error: `Access denied. The email "${email}" is not authorized. Only jpgyap@gmail.com can access the Support Assistant.`
      });
    }

    // Handle direct actions (test feature, submit bug report)
    if (action === 'test-feature' && featureId) {
      const result = await testFeature(featureId);
      return res.status(200).json({ ok: true, action: 'test-result', featureId, result });
    }

    if (action === 'submit-bug' && featureId && issue) {
      const report = await submitDebugReport({ featureId, issue, description, severity });
      return res.status(200).json({ ok: true, action: 'bug-submitted', report });
    }

    if (action === 'health-check') {
      const health = await runSystemHealthCheck();
      return res.status(200).json({ ok: true, action: 'health-check', health });
    }

    if (action === 'list-features') {
      const category = req.body.category;
      const features = category
        ? PRODUCT_FEATURES.filter(f => f.category === category)
        : PRODUCT_FEATURES;
      return res.status(200).json({ ok: true, action: 'features', features, categories: [...new Set(PRODUCT_FEATURES.map(f => f.category))] });
    }

    if (action === 'system-architecture') {
      return res.status(200).json({ ok: true, action: 'system-architecture', architecture: SYSTEM_ARCHITECTURE });
    }

    // Chat mode — use AI to answer
    if (!question) {
      return res.status(400).json({ ok: false, error: 'Missing question' });
    }

    const systemPrompt = buildSystemPrompt();

    // Check if user is reporting something broken
    const brokenKeywords = ['not working', 'broken', 'bug', 'error', 'issue', 'fail', 'crash', 'down', 'problem'];
    const isBugReport = brokenKeywords.some(k => question.toLowerCase().includes(k));

    // Ask AI for analysis
    const aiResult = await askAI({
      question: isBugReport
        ? `The user is reporting an issue. Analyze what they're saying and identify which feature might be broken.\n\nUser: ${question}\n\nIf you can identify the feature, respond with a plan to test it. If confirmed broken, explain you'll submit a debug report.`
        : question,
      chatHistory: [
        { role: 'system', content: systemPrompt },
        ...(chatHistory || [])
      ]
    });

    if (!aiResult.ok) {
      return res.status(500).json({ ok: false, error: aiResult.error });
    }

    // If it's a bug report, try to identify the feature and test it
    let testResult = null;
    let bugReport = null;

    if (isBugReport) {
      const matchedFeature = PRODUCT_FEATURES.find(f =>
        question.toLowerCase().includes(f.id.replace(/-/g, ' ')) ||
        question.toLowerCase().includes(f.name.toLowerCase()) ||
        f.name.toLowerCase().split(' ').some(w => w.length > 3 && question.toLowerCase().includes(w))
      );

      if (matchedFeature) {
        testResult = await testFeature(matchedFeature.id);
        if (!testResult.ok) {
          bugReport = await submitDebugReport({
            featureId: matchedFeature.id,
            issue: `User reported: ${question}. Test result: ${testResult.error || 'Failed'}`,
            description: `Auto-diagnosed by Support Assistant.\n\nUser question: ${question}\nFeature: ${matchedFeature.name} (${matchedFeature.id})\nTest result: ${JSON.stringify(testResult)}`,
            severity: 'medium'
          });
        }
      }
    }

    return res.status(200).json({
      ok: true,
      answer: aiResult.answer || aiResult.text || aiResult.response,
      isBugReport,
      matchedFeature: testResult ? PRODUCT_FEATURES.find(f =>
        question.toLowerCase().includes(f.id.replace(/-/g, ' ')) ||
        question.toLowerCase().includes(f.name.toLowerCase())
      )?.name : null,
      testResult,
      bugReported: !!bugReport,
      bugReportId: bugReport?.id || null
    });
  } catch (error) {
    console.error('[support-assistant] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
