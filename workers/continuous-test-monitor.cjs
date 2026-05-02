#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// PERMANENT 24/7 CONTINUOUS TESTING & MONITORING WORKER
// Runs indefinitely, testing all APIs, workers, and product features
// ═══════════════════════════════════════════════════════════════════════════════

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  vpsIp: process.env.VPS_IP || '165.22.110.111',
  baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
  reportDir: './test-reports',
  apiTestInterval: 10 * 60 * 1000,      // 10 minutes
  workerCheckInterval: 15 * 60 * 1000,  // 15 minutes
  logAnalysisInterval: 30 * 60 * 1000,  // 30 minutes
  reportInterval: 60 * 60 * 1000,       // 1 hour
  dailySummaryInterval: 24 * 60 * 60 * 1000, // 24 hours
  maxReports: 168, // Keep 7 days of hourly reports
};

// Ensure report directory exists
if (!fs.existsSync(CONFIG.reportDir)) {
  fs.mkdirSync(CONFIG.reportDir, { recursive: true });
}

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
  '/api/social-sentiment',
  '/api/wallet-tracker',
  '/api/weekly-analysis',
  '/api/version'
];

// Workers to check
const WORKERS = [
  'perpetual-trader-worker',
  'signal-generator-worker',
  'news-ingest-worker',
  'research-agent-worker',
  'bug-hunter-worker',
  'data-health-worker',
  'ml-pipeline-worker',
  'server'
];

class ContinuousMonitor {
  constructor() {
    this.startTime = Date.now();
    this.sessionId = `monitor-${Date.now()}`;
    this.stats = {
      totalTests: 0,
      passed: 0,
      failed: 0,
      bugsFound: 0,
      bugsFixed: 0,
      restarts: 0,
      last24h: {
        tests: 0,
        failures: 0,
        fixes: 0
      }
    };
    this.recentFailures = [];
    this.running = true;
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${type.toUpperCase()}]`;
    console.log(`${prefix} ${message}`);
  }

  async testAPI(endpoint) {
    try {
      const start = Date.now();
      const result = execSync(`curl -s -o /dev/null -w "%{http_code}" ${CONFIG.baseUrl}${endpoint}`, {
        encoding: 'utf8',
        timeout: 15000,
        shell: '/bin/bash'
      });
      const latency = Date.now() - start;
      const statusCode = parseInt(result.trim());
      const success = statusCode >= 200 && statusCode < 300;
      
      this.stats.totalTests++;
      if (success) {
        this.stats.passed++;
        this.stats.last24h.tests++;
      } else {
        this.stats.failed++;
        this.stats.last24h.failures++;
        this.recentFailures.push({ endpoint, statusCode, time: Date.now() });
        this.log(`API FAIL: ${endpoint} returned ${statusCode}`, 'error');
      }
      
      return { success, statusCode, latency };
    } catch (error) {
      this.stats.totalTests++;
      this.stats.failed++;
      this.stats.last24h.failures++;
      this.recentFailures.push({ endpoint, error: error.message, time: Date.now() });
      this.log(`API ERROR: ${endpoint} - ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testAllAPIs() {
    this.log('Running API health checks...', 'info');
    const results = [];
    
    for (const api of APIS) {
      const result = await this.testAPI(api);
      results.push({ endpoint: api, ...result });
      await this.delay(500);
    }
    
    const failed = results.filter(r => !r.success);
    this.log(`API checks complete. ${results.length - failed.length}/${results.length} passed`, failed.length > 0 ? 'warn' : 'info');
    
    return results;
  }

  async checkWorkers() {
    this.log('Checking worker status...', 'info');
    try {
      const result = execSync(`ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no root@${CONFIG.vpsIp} "pm2 list --json 2>/dev/null"`, {
        encoding: 'utf8',
        timeout: 20000
      });
      
      const pm2Data = JSON.parse(result);
      const workerStatus = WORKERS.map(workerName => {
        const worker = pm2Data.find(p => p.name === workerName);
        return {
          name: workerName,
          status: worker ? worker.pm2_env.status : 'not found',
          uptime: worker ? Date.now() - worker.pm2_env.pm_uptime : null,
          restarts: worker ? worker.pm2_env.restart_time : 0,
          cpu: worker ? worker.monit?.cpu : null,
          memory: worker ? Math.round(worker.monit?.memory / 1024 / 1024) : null
        };
      });
      
      const offline = workerStatus.filter(w => w.status !== 'online');
      if (offline.length > 0) {
        this.log(`WARNING: ${offline.length} workers offline`, 'warn');
        offline.forEach(w => this.log(`  - ${w.name}: ${w.status}`, 'warn'));
        
        // Auto-restart offline workers
        for (const worker of offline) {
          if (worker.status === 'stopped' || worker.status === 'errored') {
            this.log(`Auto-restarting ${worker.name}...`, 'info');
            try {
              execSync(`ssh -o ConnectTimeout=10 root@${CONFIG.vpsIp} "pm2 restart ${worker.name}"`, { timeout: 30000 });
              this.stats.bugsFixed++;
              this.stats.last24h.fixes++;
              this.stats.restarts++;
              this.log(`Restarted ${worker.name}`, 'success');
            } catch (e) {
              this.log(`Failed to restart ${worker.name}: ${e.message}`, 'error');
            }
          }
        }
      }
      
      return workerStatus;
    } catch (error) {
      this.log(`Worker check failed: ${error.message}`, 'error');
      return [];
    }
  }

  async analyzeLogs() {
    this.log('Analyzing error logs...', 'info');
    const errors = [];
    
    try {
      // Check PM2 logs for recent errors
      const logResult = execSync(`ssh -o ConnectTimeout=10 root@${CONFIG.vpsIp} "pm2 logs --lines 200 --nostream 2>&1 | grep -E 'error|fail|exception|Error|FAIL' | tail -20"`, {
        encoding: 'utf8',
        timeout: 20000
      });
      
      if (logResult.trim()) {
        this.log('Recent errors detected in logs', 'warn');
        errors.push(...logResult.split('\n').filter(Boolean));
        this.stats.bugsFound += errors.length;
      }
    } catch (e) {
      // No errors found is okay
    }
    
    return errors;
  }

  async attemptAutoFix(failedAPIs) {
    if (failedAPIs.length === 0) return;
    
    this.log(`Attempting auto-fix for ${failedAPIs.length} failing APIs...`, 'info');
    
    try {
      // Reload server if multiple APIs are failing
      if (failedAPIs.length >= 3) {
        this.log('Multiple API failures detected, reloading server...', 'warn');
        execSync(`ssh -o ConnectTimeout=10 root@${CONFIG.vpsIp} "pm2 reload server"`, { timeout: 30000 });
        await this.delay(10000);
        
        // Retest
        let fixed = 0;
        for (const api of failedAPIs) {
          const result = await this.testAPI(api.endpoint);
          if (result.success) {
            fixed++;
            this.log(`FIXED: ${api.endpoint}`, 'success');
          }
        }
        
        if (fixed > 0) {
          this.stats.bugsFixed += fixed;
          this.stats.last24h.fixes += fixed;
          this.stats.restarts++;
        }
      }
    } catch (error) {
      this.log(`Auto-fix failed: ${error.message}`, 'error');
    }
  }

  generateHourlyReport(apiResults, workerStatus, errors) {
    const timestamp = new Date();
    const filename = `hourly-report-${timestamp.toISOString().slice(0,13)}.md`;
    const filepath = path.join(CONFIG.reportDir, filename);
    
    const uptime = Math.floor((Date.now() - this.startTime) / 1000 / 60);
    
    const report = `# Hourly Test Report - ${timestamp.toLocaleString()}

## Session: ${this.sessionId}
## Uptime: ${uptime} minutes

## Summary
- Total Tests: ${this.stats.totalTests}
- Passed: ${this.stats.passed}
- Failed: ${this.stats.failed}
- Bugs Found: ${this.stats.bugsFound}
- Bugs Fixed: ${this.stats.bugsFixed}
- Restarts: ${this.stats.restarts}

## Last 24 Hours
- Tests: ${this.stats.last24h.tests}
- Failures: ${this.stats.last24h.failures}
- Fixes Applied: ${this.stats.last24h.fixes}

## API Status (${apiResults.length} endpoints)
| Endpoint | Status | Code | Latency |
|----------|--------|------|---------|
${apiResults.map(r => `| ${r.endpoint} | ${r.success ? '✅' : '❌'} | ${r.statusCode || 'ERR'} | ${r.latency || '-'}ms |`).join('\n')}

## Worker Status (${workerStatus.length} workers)
| Worker | Status | Restarts | CPU | Memory |
|--------|--------|----------|-----|--------|
${workerStatus.map(w => `| ${w.name} | ${w.status} | ${w.restarts} | ${w.cpu || '-'}% | ${w.memory || '-'}MB |`).join('\n')}

## Recent Errors (${errors.length})
${errors.length > 0 ? errors.map(e => `- ${e}`).join('\n') : 'No new errors detected'}

## Recent Failures (Last hour)
${this.recentFailures.filter(f => Date.now() - f.time < 3600000).map(f => `- ${f.endpoint || f.error} at ${new Date(f.time).toLocaleTimeString()}`).join('\n') || 'None'}

---
*Generated by Continuous Test Monitor v1.0*
`;
    
    fs.writeFileSync(filepath, report);
    this.log(`Hourly report saved: ${filepath}`, 'info');
    
    // Cleanup old reports
    this.cleanupOldReports();
    
    return filepath;
  }

  generateDailySummary() {
    const timestamp = new Date();
    const filename = `daily-summary-${timestamp.toISOString().slice(0,10)}.md`;
    const filepath = path.join(CONFIG.reportDir, filename);
    
    const report = `# Daily Test Summary - ${timestamp.toLocaleDateString()}

## 24-Hour Statistics
- Total API Tests: ${this.stats.last24h.tests}
- Failures Detected: ${this.stats.last24h.failures}
- Auto-Fixes Applied: ${this.stats.last24h.fixes}
- System Restarts: ${this.stats.restarts}

## Overall Health Score
${this.calculateHealthScore()}%

## Action Items
${this.generateActionItems()}

## Notes
- Monitoring has been running for ${Math.floor((Date.now() - this.startTime) / 1000 / 60 / 60)} hours
- Reports are stored in ${CONFIG.reportDir}

---
*Next summary: ${new Date(Date.now() + 86400000).toLocaleDateString()}*
`;
    
    fs.writeFileSync(filepath, report);
    this.log(`Daily summary saved: ${filepath}`, 'info');
    
    // Reset daily counters
    this.stats.last24h = { tests: 0, failures: 0, fixes: 0 };
    
    return filepath;
  }

  calculateHealthScore() {
    if (this.stats.totalTests === 0) return 100;
    return Math.round((this.stats.passed / this.stats.totalTests) * 100);
  }

  generateActionItems() {
    const items = [];
    
    if (this.stats.last24h.failures > 10) {
      items.push(`🔴 High failure rate detected: ${this.stats.last24h.failures} failures in 24h`);
    }
    
    if (this.stats.restarts > 5) {
      items.push(`🟡 Excessive restarts: ${this.stats.restarts} restarts in 24h`);
    }
    
    if (this.recentFailures.filter(f => Date.now() - f.time < 3600000).length > 5) {
      items.push(`🟠 Multiple recent failures in the last hour`);
    }
    
    return items.length > 0 ? items.join('\n') : '✅ All systems healthy';
  }

  cleanupOldReports() {
    try {
      const files = fs.readdirSync(CONFIG.reportDir)
        .filter(f => f.startsWith('hourly-report-'))
        .map(f => ({
          name: f,
          path: path.join(CONFIG.reportDir, f),
          stat: fs.statSync(path.join(CONFIG.reportDir, f))
        }))
        .sort((a, b) => b.stat.mtime - a.stat.mtime);
      
      if (files.length > CONFIG.maxReports) {
        const toDelete = files.slice(CONFIG.maxReports);
        toDelete.forEach(f => {
          fs.unlinkSync(f.path);
          this.log(`Cleaned up old report: ${f.name}`, 'info');
        });
      }
    } catch (e) {
      this.log(`Cleanup error: ${e.message}`, 'error');
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async run() {
    this.log('═══════════════════════════════════════════════════════════', 'info');
    this.log('  24/7 CONTINUOUS TEST MONITOR STARTED', 'info');
    this.log('═══════════════════════════════════════════════════════════', 'info');
    this.log(`Session: ${this.sessionId}`, 'info');
    this.log(`VPS: ${CONFIG.vpsIp}`, 'info');
    this.log(`API URL: ${CONFIG.baseUrl}`, 'info');
    this.log(`Report Directory: ${CONFIG.reportDir}`, 'info');
    
    // Run initial tests
    const apiResults = await this.testAllAPIs();
    const workerStatus = await this.checkWorkers();
    const errors = await this.analyzeLogs();
    
    // Attempt fixes if needed
    const failedAPIs = apiResults.filter(r => !r.success);
    if (failedAPIs.length > 0) {
      await this.attemptAutoFix(failedAPIs);
    }
    
    // Generate first report
    this.generateHourlyReport(apiResults, workerStatus, errors);
    
    // Schedule recurring tasks
    let lastHourlyReport = Date.now();
    let lastDailySummary = Date.now();
    let lastAPITest = Date.now();
    let lastWorkerCheck = Date.now();
    let lastLogAnalysis = Date.now();
    
    while (this.running) {
      const now = Date.now();
      
      // API tests every 10 minutes
      if (now - lastAPITest >= CONFIG.apiTestInterval) {
        await this.testAllAPIs();
        lastAPITest = now;
      }
      
      // Worker checks every 15 minutes
      if (now - lastWorkerCheck >= CONFIG.workerCheckInterval) {
        await this.checkWorkers();
        lastWorkerCheck = now;
      }
      
      // Log analysis every 30 minutes
      if (now - lastLogAnalysis >= CONFIG.logAnalysisInterval) {
        await this.analyzeLogs();
        lastLogAnalysis = now;
      }
      
      // Hourly report
      if (now - lastHourlyReport >= CONFIG.reportInterval) {
        const apis = await this.testAllAPIs();
        const workers = await this.checkWorkers();
        const errs = await this.analyzeLogs();
        this.generateHourlyReport(apis, workers, errs);
        lastHourlyReport = now;
      }
      
      // Daily summary
      if (now - lastDailySummary >= CONFIG.dailySummaryInterval) {
        this.generateDailySummary();
        lastDailySummary = now;
      }
      
      // Small delay to prevent CPU spinning
      await this.delay(5000);
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[MONITOR] Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[MONITOR] Shutting down gracefully...');
  process.exit(0);
});

// Start the monitor
const monitor = new ContinuousMonitor();
monitor.run().catch(error => {
  console.error('[MONITOR] Fatal error:', error);
  process.exit(1);
});
