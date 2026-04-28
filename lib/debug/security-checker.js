// ============================================================
// Security Checker — Detects secrets leakage and access issues
// ============================================================

export function runSecurityCheck(files) {
  const findings = [];

  // ── .env files committed ──────────────────────────────────
  const envFiles = files.filter(f =>
    /^\.env($|\.)/.test(f.path) && !f.path.endsWith('.example')
  );

  for (const f of envFiles) {
    findings.push({
      source_agent: 'debug_crawler_agent',
      title: 'Environment file should not be committed',
      description: `A non-example .env file (${f.path}) was detected in the repo scan.`,
      severity: 'critical',
      priority: 1,
      file_path: f.path,
      affected_area: 'secrets',
      recommendation: 'Remove this file from git, rotate any exposed keys, and keep only .env.example committed.'
    });
  }

  // ── .gitignore missing .env rule ──────────────────────────
  const gitignore = files.find(f => f.path === '.gitignore');
  if (gitignore && !/\.env/.test(gitignore.content)) {
    findings.push({
      source_agent: 'debug_crawler_agent',
      title: '.gitignore may not exclude .env files',
      description: '.gitignore does not appear to contain an .env rule.',
      severity: 'high',
      priority: 2,
      file_path: '.gitignore',
      affected_area: 'secrets',
      recommendation: 'Add .env, .env.*, and !.env.example rules to .gitignore.'
    });
  }

  // ── .env.example missing critical vars ────────────────────
  const envExample = files.find(f => f.path === '.env.example');
  if (envExample) {
    const requiredVars = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'TELEGRAM_BOT_TOKEN',
      'CRON_SECRET',
      'TRADING_MODE'
    ];
    const missing = requiredVars.filter(v => !envExample.content.includes(v));
    if (missing.length) {
      findings.push({
        source_agent: 'debug_crawler_agent',
        title: '.env.example missing critical variables',
        description: `.env.example is missing: ${missing.join(', ')}. New developers may not know required env vars.`,
        severity: 'medium',
        priority: 3,
        file_path: '.env.example',
        affected_area: 'configuration',
        recommendation: 'Add all required environment variables to .env.example with placeholder values and comments.'
      });
    }
  }

  // ── Exposed private keys or seed phrases ──────────────────
  for (const file of files) {
    const c = file.content;
    if (/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|mnemonic|seed phrase|12 words|24 words/i.test(c)) {
      findings.push({
        source_agent: 'debug_crawler_agent',
        title: 'Possible private key or seed phrase in code',
        description: `${file.path} contains patterns matching private keys or seed phrases.`,
        severity: 'critical',
        priority: 1,
        file_path: file.path,
        affected_area: 'secrets',
        recommendation: 'Never commit private keys or seed phrases. Use environment variables or a secure key management service.'
      });
    }
  }

  // ── Permissive CORS ───────────────────────────────────────
  for (const file of files) {
    const c = file.content;
    if (/cors\s*\(\s*\)|Access-Control-Allow-Origin.*\*/.test(c) && !file.path.includes('node_modules')) {
      findings.push({
        source_agent: 'debug_crawler_agent',
        title: 'Permissive CORS policy detected',
        description: `${file.path} allows all origins with CORS. This can enable CSRF attacks.`,
        severity: 'high',
        priority: 2,
        file_path: file.path,
        affected_area: 'security',
        recommendation: 'Restrict CORS to specific origins. Use an allowlist instead of wildcard (*).'
      });
    }
  }

  return findings;
}
