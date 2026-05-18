// ============================================================
// E2E Analysis — Analyze frontend HTML structure
// ============================================================
const BASE = 'https://bot.abcx124.xyz';

async function fetchText(path) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(15000) });
  return await res.text();
}

function extractBetween(html, start, end) {
  const s = html.indexOf(start);
  if (s === -1) return '';
  const e = html.indexOf(end, s + start.length);
  if (e === -1) return html.substring(s + start.length);
  return html.substring(s + start.length, e);
}

async function main() {
  // 1. Main dashboard
  const mainHtml = await fetchText('/');
  console.log('=== MAIN DASHBOARD ===');
  console.log('Size:', mainHtml.length, 'bytes');

  // Extract title
  const title = extractBetween(mainHtml, '<title>', '</title>');
  console.log('Title:', title);

  // Extract nav links
  const navLinks = mainHtml.match(/href="([^"]+)"/g) || [];
  const uniqueLinks = [...new Set(navLinks.map(l => l.replace('href="', '').replace('"', '')))];
  console.log('\nNavigation / Links:');
  uniqueLinks.forEach(l => console.log('  ' + l));

  // Extract sections/cards
  const sections = mainHtml.match(/<section[\s>]/g) || [];
  const cards = mainHtml.match(/class="[^"]*card[^"]*"/gi) || [];
  console.log('\nSections:', sections.length, '| Cards:', cards.length);

  // Extract API calls in JS
  const apiCalls = mainHtml.match(/\/api\/[a-z-]+/g) || [];
  const uniqueApis = [...new Set(apiCalls)];
  console.log('\nAPI calls referenced in frontend:');
  uniqueApis.forEach(a => console.log('  ' + a));

  // Extract feature names from the HTML
  const featureNames = mainHtml.match(/data-feature="[^"]+"/g) || [];
  console.log('\nData features:', featureNames.length);

  // Check for common UI patterns
  const hasCharts = mainHtml.includes('chart') || mainHtml.includes('Chart');
  const hasTables = mainHtml.includes('table') || mainHtml.includes('Table');
  const hasForms = mainHtml.includes('form') || mainHtml.includes('input');
  const hasModals = mainHtml.includes('modal') || mainHtml.includes('Modal');
  const hasWebSocket = mainHtml.includes('WebSocket') || mainHtml.includes('websocket');
  console.log('\nUI Features:');
  console.log('  Charts:', hasCharts);
  console.log('  Tables:', hasTables);
  console.log('  Forms:', hasForms);
  console.log('  Modals:', hasModals);
  console.log('  WebSocket:', hasWebSocket);

  // 2. Check each dashboard page
  const dashboards = [
    '/pm2-dashboard.html',
    '/tll-dashboard.html',
    '/research-agent-dashboard.html',
    '/social-intelligence-dashboard.html',
    '/api-debugger-dashboard.html',
    '/perpetual-trader-history.html',
    '/perpetual-trader-trade-detail.html',
  ];

  console.log('\n=== DASHBOARD PAGES ===');
  for (const d of dashboards) {
    const html = await fetchText(d);
    const t = extractBetween(html, '<title>', '</title>') || d;
    const size = html.length;
    const apis = (html.match(/\/api\/[a-z-]+/g) || []).length;
    console.log(`  ${d} | ${size}bytes | ${apis} API refs | Title: ${t}`);
  }

  // 3. Check PWA support
  console.log('\n=== PWA ===');
  const manifest = await fetchText('/manifest.json');
  console.log('  Manifest:', manifest.substring(0, 200));
  const sw = await fetchText('/sw.js').catch(() => 'NOT FOUND');
  console.log('  Service Worker:', sw.substring(0, 100));

  // 4. Summary of all findings
  console.log('\n=== COMPREHENSIVE GAP ANALYSIS ===');
  console.log('See full report above.');
}

main().catch(console.error);
