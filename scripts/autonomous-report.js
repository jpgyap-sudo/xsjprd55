#!/usr/bin/env node
// ============================================================
// Autonomous Report Generator
// Run: node scripts/autonomous-report.js
// Generates a comprehensive project status report and saves it.
// ============================================================

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const now = new Date();
const timestamp = now.toISOString();
const reportFilename = `AUTONOMOUS-REPORT-${now.toISOString().slice(0,10)}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}.md`;
const reportPath = path.join(ROOT, reportFilename);

let report = `# 🤖 Autonomous Report\n\n`;
report += `**Generated:** ${timestamp}\n`;
report += `**Project:** ${path.basename(ROOT)}\n\n`;

// ── 1. Git State ───────────────────────────────────────────
report += `## 1. Project State (Git)\n\n`;
try {
  const branch = execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf-8' }).trim();
  const lastCommit = execSync('git log -1 --format="%h %s (%cr)"', { cwd: ROOT, encoding: 'utf-8' }).trim();
  const status = execSync('git status --short', { cwd: ROOT, encoding: 'utf-8' }).trim();
  report += `- **Branch:** \`main\`\n`;
  report += `- **Last Commit:** ${lastCommit}\n`;
  report += `- **Uncommitted Changes:** ${status ? status.split('\n').length + ' files' : 'None'}\n`;
  if (status) {
    report += `\n\`\`\`\n${status}\n\`\`\`\n`;
  }
} catch (e) {
  report += `- Git unavailable or not a repo\n`;
}
report += `\n`;

// ── 2. Worker Inventory ────────────────────────────────────
report += `## 2. Worker Inventory\n\n`;
const workersDir = path.join(ROOT, 'workers');
const workerFiles = fs.existsSync(workersDir) ? fs.readdirSync(workersDir).filter(f => f.endsWith('.js')) : [];
report += `**Defined workers (${workerFiles.length}):**\n\n`;
for (const f of workerFiles) {
  const fp = path.join(workersDir, f);
  const content = fs.readFileSync(fp, 'utf-8');
  const firstComment = content.match(/\/\/.*/) || content.match(/\/\*[\s\S]*?\*\//);
  const desc = firstComment ? firstComment[0].replace(/\/\/\s*/, '').slice(0, 80) : 'No description';
  report += `- \`${f}\` — ${desc}\n`;
}
report += `\n`;

// ── 3. API Routes Inventory ────────────────────────────────
report += `## 3. API Routes Inventory\n\n`;
const apiDir = path.join(ROOT, 'api');
const apiFiles = fs.existsSync(apiDir) ? fs.readdirSync(apiDir).filter(f => f.endsWith('.js') && !fs.statSync(path.join(apiDir, f)).isDirectory()) : [];
report += `**Top-level routes (${apiFiles.length}):** ` + apiFiles.map(f => '`/api/' + f.replace('.js','') + '`').join(', ') + '\n\n';
const apiSubdirs = fs.existsSync(apiDir) ? fs.readdirSync(apiDir).filter(f => fs.statSync(path.join(apiDir, f)).isDirectory()) : [];
for (const d of apiSubdirs) {
  const subFiles = fs.readdirSync(path.join(apiDir, d)).filter(f => f.endsWith('.js'));
  report += `- **${d}/** (${subFiles.length}): ` + subFiles.map(f => '`/api/' + d + '/' + f.replace('.js','') + '`').join(', ') + '\n';
}
report += `\n`;

// ── 4. Environment Check ───────────────────────────────────
report += `## 4. Environment Check\n\n`;
const envFiles = ['.env', '.env.prod', '.env.example'];
for (const ef of envFiles) {
  const efPath = path.join(ROOT, ef);
  report += `- **${ef}:** ${fs.existsSync(efPath) ? '✅ Present' : '❌ Missing'}\n`;
}
report += `\n`;

// ── 5. Package & Dependencies ──────────────────────────────
report += `## 5. Package & Dependencies\n\n`;
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const depCount = Object.keys(pkg.dependencies || {}).length;
  const devCount = Object.keys(pkg.devDependencies || {}).length;
  report += `- **Name:** ${pkg.name || 'N/A'}\n`;
  report += `- **Version:** ${pkg.version || 'N/A'}\n`;
  report += `- **Dependencies:** ${depCount}\n`;
  report += `- **Dev Dependencies:** ${devCount}\n`;
  report += `- **Key Scripts:** ${Object.keys(pkg.scripts || {}).slice(0, 8).join(', ')}\n`;
} catch (e) {
  report += `- Could not read package.json\n`;
}
report += `\n`;

// ── 6. Data & Logs ─────────────────────────────────────────
report += `## 6. Data & Logs\n\n`;
const dataDir = path.join(ROOT, 'data');
if (fs.existsSync(dataDir)) {
  const dataFiles = fs.readdirSync(dataDir);
  report += `- **data/** contains ${dataFiles.length} file(s): ${dataFiles.join(', ')}\n`;
} else {
  report += `- **data/** directory not found\n`;
}
report += `\n`;

// ── 7. Action Items ────────────────────────────────────────
report += `## 7. Action Items (Auto-Generated)\n\n`;
const actions = [];
if (workerFiles.length === 0) actions.push('No workers found — verify `workers/` directory.');
if (!fs.existsSync(path.join(ROOT, '.env'))) actions.push('`.env` file missing — copy from `.env.example` and configure.');
if (!fs.existsSync(path.join(ROOT, 'package.json'))) actions.push('`package.json` missing — project may be corrupted.');
if (actions.length === 0) actions.push('No immediate blockers detected. Project appears healthy.');
for (const a of actions) {
  report += `- ${a}\n`;
}
report += `\n`;

// ── 8. How to Resume ───────────────────────────────────────
report += `## 8. How to Resume\n\n`;
report += `1. Open project: \`${ROOT}\`\n`;
report += `2. Review this report for any critical issues\n`;
report += `3. Run \\"npm run dev\\" or start workers via PM2/Docker\n`;
report += `4. Check \`C:/Users/User/.roo/MEMORY.md\` for session continuity\n`;
report += `\n---\n*End of Autonomous Report*\n`;

// Save report
fs.writeFileSync(reportPath, report);
console.log(`✅ Autonomous report saved: ${reportPath}`);
console.log(`\n📋 Summary:`);
console.log(`  Workers: ${workerFiles.length}`);
console.log(`  API routes: ${apiFiles.length}`);
console.log(`  Environment files checked: ${envFiles.length}`);

// Update global memory
const memoryPath = 'C:/Users/User/.roo/MEMORY.md';
try {
  let memory = '';
  if (fs.existsSync(memoryPath)) {
    memory = fs.readFileSync(memoryPath, 'utf-8');
  } else {
    memory = '# Global Session Memory\n\n';
  }
  const autoEntry = `\n## Autonomous Session — ${timestamp}\n- **Project:** ${ROOT}\n- **Report:** ${reportFilename}\n- **Workers:** ${workerFiles.length}\n- **APIs:** ${apiFiles.length}\n- **Status:** ${actions[0]}\n`;
  memory += autoEntry;
  fs.writeFileSync(memoryPath, memory);
  console.log(`🧠 Global memory updated: ${memoryPath}`);
} catch (e) {
  console.warn('⚠️ Could not update global memory:', e.message);
}
