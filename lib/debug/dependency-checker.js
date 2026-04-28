// ============================================================
// Dependency Checker — Analyzes package.json for risks
// Checks for missing deps, outdated scripts, known vulnerable
// patterns, and trading-app-specific requirements.
// ============================================================

export function runDependencyCheck(files) {
  const pkg = files.find(f => f.path === 'package.json');
  if (!pkg) {
    return [{
      source_agent: 'debug_crawler_agent',
      title: 'Missing package.json',
      description: 'The repo scan did not find package.json.',
      severity: 'high',
      priority: 2,
      file_path: 'package.json',
      affected_area: 'dependencies',
      recommendation: 'Confirm the debug crawler root path is correct and package.json exists.'
    }];
  }

  const findings = [];
  let parsed;
  try {
    parsed = JSON.parse(pkg.content);
  } catch {
    return [{
      source_agent: 'debug_crawler_agent',
      title: 'Invalid package.json',
      description: 'package.json could not be parsed as JSON.',
      severity: 'critical',
      priority: 1,
      file_path: 'package.json',
      affected_area: 'dependencies',
      recommendation: 'Fix package.json syntax before deployment.'
    }];
  }

  const deps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
  const allScripts = JSON.stringify(parsed.scripts || {});

  // ── Missing start script ──────────────────────────────────
  if (!parsed.scripts?.start) {
    findings.push({
      source_agent: 'debug_crawler_agent',
      title: 'Missing npm start script',
      description: 'package.json has no start script. VPS/PM2 deployment may fail or require manual command.',
      severity: 'medium',
      priority: 3,
      file_path: 'package.json',
      affected_area: 'deployment',
      recommendation: 'Add a clear start script: "start": "node server.js"'
    });
  }

  // ── Missing test script ───────────────────────────────────
  if (!parsed.scripts?.test) {
    findings.push({
      source_agent: 'debug_crawler_agent',
      title: 'Missing npm test script',
      description: 'No test script found. Cannot verify code quality before deployment.',
      severity: 'medium',
      priority: 3,
      file_path: 'package.json',
      affected_area: 'tests',
      recommendation: 'Add a test script, even if basic: "test": "node --test"'
    });
  }

  // ── Supabase dependency check ─────────────────────────────
  if (!deps['@supabase/supabase-js']) {
    findings.push({
      source_agent: 'debug_crawler_agent',
      title: 'Supabase dependency not detected',
      description: 'The app appears to use Supabase but @supabase/supabase-js was not found in dependencies.',
      severity: 'high',
      priority: 2,
      file_path: 'package.json',
      affected_area: 'database',
      recommendation: 'Install @supabase/supabase-js or confirm the project uses another DB client.'
    });
  }

  // ── CCXT for trading apps ─────────────────────────────────
  if (!deps['ccxt'] && /trading|crypto|exchange|binance|bybit/i.test(JSON.stringify(parsed))) {
    findings.push({
      source_agent: 'debug_crawler_agent',
      title: 'Exchange data dependency may be missing',
      description: 'Crypto trading app package does not show ccxt dependency.',
      severity: 'low',
      priority: 4,
      file_path: 'package.json',
      affected_area: 'market_data',
      recommendation: 'Use ccxt or dedicated exchange SDKs for exchange market data where appropriate.'
    });
  }

  // ── dotenv for env loading ────────────────────────────────
  if (!deps['dotenv'] && parsed.type === 'module') {
    findings.push({
      source_agent: 'debug_crawler_agent',
      title: 'dotenv may be missing for ESM projects',
      description: 'This is an ESM project but dotenv is not in dependencies. Environment variables may not load correctly.',
      severity: 'medium',
      priority: 3,
      file_path: 'package.json',
      affected_area: 'configuration',
      recommendation: 'Install dotenv or use Node.js 20+ built-in --env-file flag. Ensure env vars load before server starts.'
    });
  }

  // ── Express for API server ────────────────────────────────
  if (!deps['express'] && /server\.js|api\//.test(JSON.stringify(files.map(f => f.path)))) {
    findings.push({
      source_agent: 'debug_crawler_agent',
      title: 'Express not detected in dependencies',
      description: 'The project has API routes/server.js but express is not in package.json dependencies.',
      severity: 'high',
      priority: 2,
      file_path: 'package.json',
      affected_area: 'api',
      recommendation: 'Ensure express is listed in dependencies, or document the alternative framework being used.'
    });
  }

  // ── Check for known vulnerable patterns ───────────────────
  if (deps['lodash'] && !deps['lodash-es']) {
    findings.push({
      source_agent: 'debug_crawler_agent',
      title: 'Using full lodash package',
      description: 'Full lodash increases bundle size. Consider lodash-es for tree-shaking.',
      severity: 'low',
      priority: 4,
      file_path: 'package.json',
      affected_area: 'performance',
      recommendation: 'Replace lodash with lodash-es or specific lodash.* sub-packages.'
    });
  }

  // ── Type field for ESM ────────────────────────────────────
  if (!parsed.type) {
    findings.push({
      source_agent: 'debug_crawler_agent',
      title: 'package.json missing "type" field',
      description: 'No "type": "module" or "type": "commonjs" specified. This can cause import/require confusion.',
      severity: 'low',
      priority: 4,
      file_path: 'package.json',
      affected_area: 'configuration',
      recommendation: 'Explicitly set "type": "module" for ESM or "type": "commonjs" for CJS projects.'
    });
  }

  // ── Engine requirements ───────────────────────────────────
  if (!parsed.engines?.node) {
    findings.push({
      source_agent: 'debug_crawler_agent',
      title: 'No Node.js engine requirement specified',
      description: 'package.json does not specify minimum Node.js version. Deployment environments may use incompatible versions.',
      severity: 'low',
      priority: 4,
      file_path: 'package.json',
      affected_area: 'deployment',
      recommendation: 'Add "engines": { "node": ">=18.0.0" } to enforce Node version compatibility.'
    });
  }

  return findings;
}
