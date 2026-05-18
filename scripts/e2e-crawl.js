// ============================================================
// E2E Crawl — Check all frontend pages + API endpoints
// ============================================================
const BASE = 'https://bot.abcx124.xyz';

async function check(path) {
  const url = BASE + path;
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const ms = Date.now() - start;
    let body = '';
    try {
      const json = await res.json();
      body = JSON.stringify(json).substring(0, 200);
    } catch {
      body = (await res.text()).substring(0, 200).replace(/\n/g, ' ');
    }
    return { path, status: res.status, ms, ok: res.ok, body };
  } catch (e) {
    return { path, status: 'ERR', ms: Date.now() - start, ok: false, error: e.message };
  }
}

async function main() {
  const results = [];

  // ── Frontend Pages ──
  const pages = [
    '/',
    '/pm2-dashboard.html',
    '/tll-dashboard.html',
    '/research-agent-dashboard.html',
    '/social-intelligence-dashboard.html',
    '/api-debugger-dashboard.html',
    '/perpetual-trader-history.html',
    '/perpetual-trader-trade-detail.html',
    '/manifest.json',
    '/sw.js',
    '/icon-192.svg',
    '/icon-512.svg',
  ];

  console.log('=== FRONTEND PAGES ===');
  for (const p of pages) {
    const r = await check(p);
    results.push(r);
    const statusStr = typeof r.status === 'number' ? r.status : 'ERR';
    const size = r.body ? r.body.length : 0;
    console.log(`  ${statusStr} ${r.ms}ms  ${p}  [${size} chars]`);
  }

  // ── API Endpoints ──
  const apis = [
    '/api',
    '/api/health',
    '/api/version',
    '/api/config',
    '/api/brain',
    '/api/brain/health',
    '/api/learning-layer',
    '/api/signals',
    '/api/signal',
    '/api/market',
    '/api/liquidation',
    '/api/news-feed',
    '/api/news-signal',
    '/api/news-ingest',
    '/api/social-intel',
    '/api/social-sentiment',
    '/api/mock-trading-dashboard',
    '/api/system-health',
    '/api/dashboard-health',
    '/api/pm2-status',
    '/api/deploy-status',
    '/api/research-agent',
    '/api/research-agent-dashboard',
    '/api/bugs',
    '/api/bug-fix-pipeline',
    '/api/backtest',
    '/api/ml-health',
    '/api/ml-predict',
    '/api/ml-rl',
    '/api/analyze',
    '/api/advisor',
    '/api/agent-improvement',
    '/api/app-development-proposals',
    '/api/product-features',
    '/api/product-updates',
    '/api/support-assistant',
    '/api/openclaw',
    '/api/openclaw-telegram',
    '/api/strategy-labs',
    '/api/catalyst',
    '/api/data-health',
    '/api/diagnostics',
    '/api/deployment-dashboard',
    '/api/debug',
    '/api/debug-crawler',
    '/api/perpetual-trader',
    '/api/wallet-tracker',
    '/api/weekly-analysis',
    '/api/learning',
    '/api/ask',
    '/api/bot',
    '/api/telegram',
    '/api/binance-ticker',
    '/api/lunarcrush',
    '/api/mock-feedback',
    '/api/mock-inject',
  ];

  console.log('\n=== API ENDPOINTS ===');
  for (const a of apis) {
    const r = await check(a);
    results.push(r);
    const statusStr = typeof r.status === 'number' ? r.status : 'ERR';
    const bodyPreview = r.body ? r.body.substring(0, 120) : (r.error || '');
    console.log(`  ${statusStr} ${r.ms}ms  ${a}`);
    if (bodyPreview) console.log(`       ${bodyPreview}`);
  }

  // ── Summary ──
  console.log('\n=== SUMMARY ===');
  const ok = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok && r.status !== 'ERR').length;
  const err = results.filter(r => r.status === 'ERR').length;
  const total = results.length;
  console.log(`  Total: ${total} | OK: ${ok} | HTTP Errors: ${fail} | Connection Errors: ${err}`);

  // ── Gaps Analysis ──
  console.log('\n=== GAPS & ISSUES ===');
  for (const r of results) {
    if (!r.ok) {
      if (r.status === 'ERR') {
        console.log(`  ❌ CONNECTION FAILED: ${r.path} — ${r.error}`);
      } else if (r.status === 401 || r.status === 403) {
        console.log(`  🔒 AUTH REQUIRED: ${r.path} — ${r.status} (needs secret)`);
      } else if (r.status === 404) {
        console.log(`  ❌ NOT FOUND: ${r.path} — ${r.status}`);
      } else if (r.status >= 500) {
        console.log(`  💥 SERVER ERROR: ${r.path} — ${r.status}`);
      } else {
        console.log(`  ⚠️  ${r.status}: ${r.path}`);
      }
    }
  }
}

main().catch(console.error);
