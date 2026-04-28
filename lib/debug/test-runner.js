// ============================================================
// Test Runner — Executes npm commands and smoke tests
// Reports failures as bug findings.
// ============================================================

import { spawn } from 'child_process';

function runCommand(command, args = [], options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      shell: process.platform === 'win32',
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({
        ok: false,
        command: [command, ...args].join(' '),
        stdout,
        stderr: stderr + '\nCommand timed out after ' + (options.timeoutMs || 30000) + 'ms',
        code: -1
      });
    }, options.timeoutMs || 30000);

    child.stdout?.on('data', d => stdout += d.toString());
    child.stderr?.on('data', d => stderr += d.toString());

    child.on('close', code => {
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        command: [command, ...args].join(' '),
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
        code
      });
    });

    child.on('error', err => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        command: [command, ...args].join(' '),
        stdout,
        stderr: err.message,
        code: -1
      });
    });
  });
}

export async function runProjectTests() {
  const results = [];

  // Basic sanity checks
  results.push(await runCommand('node', ['--version'], { timeoutMs: 10000 }));
  results.push(await runCommand('npm', ['--version'], { timeoutMs: 10000 }));

  // Check available scripts
  const pkgResult = await runCommand('npm', ['run'], { timeoutMs: 15000 });
  results.push(pkgResult);

  // Run tests if available
  if (/test/.test(pkgResult.stdout)) {
    results.push(await runCommand('npm', ['test', '--', '--runInBand'], { timeoutMs: 120000 }));
  }

  // Run lint if available
  if (/lint/.test(pkgResult.stdout)) {
    results.push(await runCommand('npm', ['run', 'lint'], { timeoutMs: 120000 }));
  }

  return results;
}

export async function runSmokeTests() {
  const urls = (process.env.DEBUG_SMOKE_URLS || 'http://localhost:3000/api/health')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const results = [];

  for (const url of urls) {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      results.push({
        ok: res.ok,
        url,
        status: res.status,
        duration_ms: Date.now() - started
      });
    } catch (error) {
      results.push({
        ok: false,
        url,
        error: error.message,
        duration_ms: Date.now() - started
      });
    }
  }

  return results;
}

export function findingsFromTestResults(results = [], smoke = []) {
  const findings = [];

  for (const r of results) {
    if (!r.ok) {
      findings.push({
        source_agent: 'debug_crawler_agent',
        title: `Test command failed: ${r.command}`,
        description: `Exit code ${r.code}. stderr: ${r.stderr || 'none'}`,
        severity: 'high',
        priority: 2,
        file_path: 'package.json',
        affected_area: 'tests',
        recommendation: 'Fix failing test/lint command before deployment.',
        metadata: { command: r.command, stdout: r.stdout, stderr: r.stderr }
      });
    }
  }

  for (const s of smoke) {
    if (!s.ok) {
      findings.push({
        source_agent: 'debug_crawler_agent',
        title: `Smoke test failed: ${s.url}`,
        description: s.error ? `Endpoint failed: ${s.error}` : `Endpoint returned HTTP ${s.status}`,
        severity: 'high',
        priority: 2,
        file_path: 'api',
        affected_area: 'runtime_health',
        recommendation: 'Check server, API route, env variables, and deployment logs.',
        metadata: s
      });
    }
  }

  return findings;
}
