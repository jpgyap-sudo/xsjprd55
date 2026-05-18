// ============================================================
// E2E Gap Analysis — Backend APIs vs Frontend references
// ============================================================
const FE_APIS = new Set([
  '/api/binance-ticker','/api/signal','/api/liquidation','/api/news-feed',
  '/api/research-agent-chat','/api/support-assistant','/api/catalyst',
  '/api/research-agent-dashboard','/api/ml-health','/api/mock-trading-dashboard',
  '/api/ml-rl','/api/health','/api/diagnostics','/api/bugs','/api/api-debugger',
  '/api/app-development-proposals','/api/product-updates','/api/bug-fix-pipeline',
  '/api/perpetual-trader','/api/debug','/api/version','/api/deploy-status',
  '/api/product-features'
]);

const BE_APIS = new Set([
  '/api/advisor','/api/agent-improvement','/api/analyze','/api/api-debugger',
  '/api/app-development-proposals','/api/ask','/api/backtest','/api/binance-ticker',
  '/api/bot','/api/brain','/api/brain/health','/api/bug-fix-pipeline','/api/bugs',
  '/api/catalyst','/api/config','/api/dashboard-health','/api/data-health',
  '/api/debug','/api/debug-crawler','/api/deploy-status','/api/deployment-dashboard',
  '/api/diagnostics','/api/health','/api/learning','/api/learning-layer',
  '/api/liquidation','/api/lunarcrush','/api/market','/api/ml-health','/api/ml-predict',
  '/api/ml-rl','/api/mock-feedback','/api/mock-inject','/api/mock-trading-dashboard',
  '/api/news-feed','/api/news-ingest','/api/news-signal','/api/openclaw',
  '/api/openclaw-telegram','/api/perpetual-trader','/api/pm2-status',
  '/api/product-features','/api/product-updates','/api/research-agent',
  '/api/research-agent-dashboard','/api/research-agent-chat','/api/signal',
  '/api/signals','/api/social-intel','/api/social-sentiment','/api/strategy-labs',
  '/api/support-assistant','/api/system-health','/api/telegram','/api/version',
  '/api/wallet-tracker','/api/weekly-analysis'
]);

console.log('=== BACKEND APIs NOT REFERENCED IN FRONTEND ===');
const beNotInFe = [...BE_APIS].filter(a => !FE_APIS.has(a)).sort();
beNotInFe.forEach(a => console.log('  ' + a));
console.log('  Count:', beNotInFe.length);

console.log('\n=== FRONTEND APIs NOT IN BACKEND (would 404) ===');
const feNotInBe = [...FE_APIS].filter(a => !BE_APIS.has(a)).sort();
feNotInBe.forEach(a => console.log('  ' + a));
console.log('  Count:', feNotInBe.length);

console.log('\n=== STATS ===');
console.log('  Backend API endpoints:', BE_APIS.size);
console.log('  Frontend API references:', FE_APIS.size);
console.log('  Overlap:', [...BE_APIS].filter(a => FE_APIS.has(a)).length);
console.log('  Backend-only (no UI):', beNotInFe.length);
console.log('  Frontend-only (would 404):', feNotInBe.length);
