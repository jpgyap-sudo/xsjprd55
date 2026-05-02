#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE 5-HOUR BUG SCANNING & TESTING LOOP
// Tests all APIs, workers, database, and product features continuously
// ═══════════════════════════════════════════════════════════════════════════════

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPORT_FILE = `AUTONOMOUS-REPORT-${new Date().toISOString().slice(0,10)}-${Date.now()}.md`;
const LOG_FILE = `test-loop-${new Date().toISOString().slice(0,10)}.log`;

// Test configuration
const CONFIG = {
  duration: 5 * 60 * 60 * 1000, // 5 hours
  apiTestInterval: 10 * 60 * 1000, // 10 minutes
  workerCheckInterval: 15 * 60 * 1000, // 15 minutes
  logAnalysisInterval: 30 * 60 * 1000, // 30 minutes
  reportInterval: 60 * 60 * 1000, // 1 hour
  vpsIp: '165.22.110.111',
  baseUrl: 'http://localhost:3000'
};

// APIs to test
const APIS = [
  '/api/health',
  '/api/perpetual-trader',
  '/api/mock-trading-dashboard',
  '/api/signal',
  '/api/research-agent',
  '/api/news-feed',
  '/api/catalyst',
  '/api/diagnostics',
  '/api/api-status',
  '/api/bugs',
  '/api/product-features',
  '/api/deploy-status',
  '/api/binance-ticker',
  '/api/liquidation',
  '/api/market',
  '/api/ml-predict',
  '/api/social-sentiment'
];

// Workers to check
const WORKERS = [
  'perpetual-trader-worker',
  'signal-generator-worker',
  'news-ingest-worker',
  'research-agent-worker',
  'bug-hunter-worker',
  'data-health-worker',
  'ml-pipeline-worker'
];

class TestRunner {
  constructor() {
    this.startTime = Date.now();
    this.results = {
      apiTests: [],
      workerStatus: [],
      errors: [],
      fixes: [],
      summary: {
        totalTests: 0,
        passed: 0,
        failed: 0,
        bugsFound: 0,
        bugsFixed: 0
      }
    };
    this.running = true;
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
    console.log(logEntry);
    fs.appendFileSync(LOG_FILE, logEntry + '\n');
  }

  async testAPI(endpoint) {
    try {
      const start = Date.now();
      const result = execSync(`curl -s -w "\\nHTTP_CODE:%{http_code}" ${CONFIG.baseUrl}${endpoint}`, {
        encoding: 'utf8',
        timeout: 10000
      });
      const latency = Date.now() - start;
      const [body, codeLine] = result.split('HTTP_CODE:');
      const statusCode = parseInt(codeLine);
      
      const success = statusCode >= 200 && statusCode < 300;
      
      this.results.apiTests.push({
        endpoint,
        statusCode,
        latency,
        success,
        timestamp: new Date().toISOString()
      });

      if (!success) {
        this.log(`API FAIL: ${endpoint} returned ${statusCode}`, 'error');
        this.results.summary.failed++;
      } else {
        this.results.summary.passed++;
      }
      this.results.summary.totalTests++;
      
      return success;
    } catch (error) {
      this.log(`API ERROR: ${endpoint} - ${error.message}`, 'error');
      this.results.apiTests.push({
        endpoint,
        error: error.message,
        success: false,
        timestamp: new Date().toISOString()
      });
      this.results.summary.failed++;
      this.results.summary.totalTests++;
      return false;
    }
  }

  async testAllAPIs() {
    this.log('Starting API tests...', 'info');
    for (const api of APIS) {
      await this.testAPI(api);
      await this.delay(1000); // Rate limiting
    }
    this.log(`API tests complete. Passed: ${this.results.summary.passed}, Failed: ${this.results.summary.failed}`, 'info');
  }

  async checkWorkers() {
    this.log('Checking worker status on VPS...', 'info');
    try {
      const result = execSync(`ssh -o ConnectTimeout=10 root@${CONFIG.vpsIp} "pm2 list --json"`, {
        encoding: 'utf8',
        timeout: 15000
      });
      const pm2Data = JSON.parse(result);
      
      const workerStatus = WORKERS.map(workerName => {
        const worker = pm2Data.find(p => p.name === workerName);
        return {
          name: workerName,
          status: worker ? worker.pm2_env.status : 'not found',
          uptime: worker ? worker.pm2_env.pm_uptime : null,
          restartCount: worker ? worker.pm2_env.restart_time : 0,
          cpu: worker ? worker.monit?.cpu : null,
          memory: worker ? worker.monit?.memory : null,
          timestamp: new Date().toISOString()
        };
      });
      
      this.results.workerStatus.push(...workerStatus);
      
      const offlineWorkers = workerStatus.filter(w => w.status !== 'online');
      if (offlineWorkers.length > 0) {
        this.log(`WARNING: ${offlineWorkers.length} workers offline`, 'warn');
        offlineWorkers.forEach(w => this.log(`  - ${w.name}: ${w.status}`, 'warn'));
      }
    } catch (error) {
      this.log(`Worker check failed: ${error.message}`, 'error');
    }
  }

  async analyzeLogs() {
    this.log('Analyzing error logs...', 'info');
    try {
      // Check PM2 logs for errors
      const logResult = execSync(`ssh -o ConnectTimeout=10 root@${CONFIG.vpsIp} "pm2 logs --lines 100 --nostream 2>&1 | grep -i 'error\\|fail\\|exception' | tail -20"`, {
        encoding: 'utf8',
        timeout: 15000
      });
      
      if (logResult.trim()) {
        this.log('Recent errors found in logs:', 'error');
        this.log(logResult, 'error');
        this.results.errors.push({
          timestamp: new Date().toISOString(),
          source: 'pm2-logs',
          details: logResult
        });
      }
    } catch (error) {
      // No errors found is okay
    }
  }

  async attemptAutoFix() {
    this.log('Attempting auto-fixes for detected issues...', 'info');
    
    // Check for common issues and fix them
    const offlineAPIs = this.results.apiTests.filter(t => !t.success && t.timestamp > new Date(Date.now() - 3600000).toISOString());
    
    if (offlineAPIs.length > 0) {
      this.log(`Found ${offlineAPIs.length} failing APIs, attempting restart...`, 'warn');
      try {
        execSync(`ssh -o ConnectTimeout=10 root@${CONFIG.vpsIp} "pm2 reload server"`, { timeout: 30000 });
        this.log('Server reloaded, waiting 10s for recovery...', 'info');
        await this.delay(10000);
        
        // Retest failed APIs
        for (const api of offlineAPIs.slice(0, 3)) {
          const success = await this.testAPI(api.endpoint);
          if (success) {
            this.log(`FIXED: ${api.endpoint} recovered after restart`, 'success');
            this.results.fixes.push({ endpoint: api.endpoint, fix: 'server-reload', timestamp: new Date().toISOString() });
            this.results.summary.bugsFixed++;
          }
        }
      } catch (error) {
        this.log(`Auto-fix failed: ${error.message}`, 'error');
      }
    }
  }

  generateReport() {
    const duration = (Date.now() - this.startTime) / 1000 / 60; // minutes
    
    const report = `# Autonomous Test Report - ${new Date().toISOString()}

## Summary
- **Duration**: ${duration.toFixed(1)} minutes
- **Total Tests**: ${this.results.summary.totalTests}
- **Passed**: ${this.results.summary.passed}
- **Failed**: ${this.results.summary.failed}
- **Bugs Found**: ${this.results.summary.bugsFound}
- **Bugs Fixed**: ${this.results.summary.bugsFixed}

## API Test Results
| Endpoint | Status | Latency | Timestamp |
|----------|--------|---------|-----------|
${this.results.apiTests.slice(-20).map(t => `| ${t.endpoint} | ${t.success ? '✅' : '❌'} ${t.statusCode || 'ERR'} | ${t.latency || '-'}ms | ${t.timestamp} |`).join('\n')}

## Worker Status
| Worker | Status | Restarts | CPU | Memory |
|--------|--------|----------|-----|--------|
${this.results.workerStatus.slice(-WORKERS.length).map(w => `| ${w.name} | ${w.status} | ${w.restartCount} | ${w.cpu || '-'}% | ${w.memory ? (w.memory/1024/1024).toFixed(1) : '-'}MB |`).join('\n')}

## Errors Found
${this.results.errors.length > 0 ? this.results.errors.map(e => `- **${e.timestamp}** [${e.source}]: ${e.details.substring(0, 200)}...`).join('\n') : 'No errors detected'}

## Fixes Applied
${this.results.fixes.length > 0 ? this.results.fixes.map(f => `- **${f.timestamp}**: ${f.endpoint} - ${f.fix}`).join('\n') : 'No fixes applied'}

## Action Items
${this.generateActionItems()}
`;
    
    fs.writeFileSync(REPORT_FILE, report);
    this.log(`Report saved to ${REPORT_FILE}`, 'info');
    return report;
  }

  generateActionItems() {
    const items = [];
    
    const failingAPIs = this.results.apiTests.filter(t => !t.success);
    if (failingAPIs.length > 0) {
      items.push(`- 🔴 Fix ${failingAPIs.length} failing API endpoints`);
    }
    
    const offlineWorkers = this.results.workerStatus.filter(w => w.status !== 'online');
    if (offlineWorkers.length > 0) {
      items.push(`- 🔴 Restart ${offlineWorkers.length} offline workers`);
    }
    
    if (this.results.errors.length > 0) {
      items.push(`- 🟡 Review ${this.results.errors.length} logged errors`);
    }
    
    return items.length > 0 ? items.join('\n') : '- ✅ All systems operational';
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async run() {
    this.log('═══════════════════════════════════════════════════════════', 'info');
    this.log('  STARTING 5-HOUR COMPREHENSIVE TEST LOOP', 'info');
    this.log('═══════════════════════════════════════════════════════════', 'info');
    
    // Initial tests
    await this.testAllAPIs();
    await this.checkWorkers();
    await this.analyzeLogs();
    
    // Schedule recurring tasks
    const apiInterval = setInterval(() => this.testAllAPIs(), CONFIG.apiTestInterval);
    const workerInterval = setInterval(() => this.checkWorkers(), CONFIG.workerCheckInterval);
    const logInterval = setInterval(() => this.analyzeLogs(), CONFIG.logAnalysisInterval);
    const fixInterval = setInterval(() => this.attemptAutoFix(), CONFIG.logAnalysisInterval);
    const reportInterval = setInterval(() => this.generateReport(), CONFIG.reportInterval);
    
    // Run for 5 hours
    await this.delay(CONFIG.duration);
    
    // Cleanup
    this.running = false;
    clearInterval(apiInterval);
    clearInterval(workerInterval);
    clearInterval(logInterval);
    clearInterval(fixInterval);
    clearInterval(reportInterval);
    
    // Final report
    this.log('═══════════════════════════════════════════════════════════', 'info');
    this.log('  TEST LOOP COMPLETE - GENERATING FINAL REPORT', 'info');
    this.log('═══════════════════════════════════════════════════════════', 'info');
    
    const finalReport = this.generateReport();
    console.log('\n' + finalReport);
  }
}

// Run the test
const runner = new TestRunner();
runner.run().catch(error => {
  console.error('Test loop crashed:', error);
  process.exit(1);
});
