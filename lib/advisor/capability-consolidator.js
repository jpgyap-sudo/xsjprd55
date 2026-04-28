// ============================================================
// Capability Consolidator — xsjprd55
// Scans app capabilities, proposes improvements, saves to memory log.
// Proposals are sent to app-development for review; only approved ones
// get built by the coding agent.
// ============================================================

import { db } from '../ml/db.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { generateImprovementSuggestion } from '../ai.js';
import fs from 'fs';
import path from 'path';

const MEMORY_LOG_PATH = process.env.CAPABILITY_LOG_PATH || path.join(process.cwd(), 'data', 'capability-log.jsonl');
const SKILL_DIR = path.join(process.cwd(), '.roo', 'skills', 'capability-consolidator');

/* ── Schema helpers ───────────────────────────────────────── */

export function initCapabilityTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_development_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'feature',
      capability_area TEXT NOT NULL DEFAULT 'general',
      impact_score REAL NOT NULL DEFAULT 0,
      effort_estimate TEXT,
      proposed_by TEXT NOT NULL DEFAULT 'capability-consolidator',
      status TEXT NOT NULL DEFAULT 'pending',
      review_notes TEXT,
      reviewed_at TEXT,
      approved_at TEXT,
      implemented_at TEXT,
      related_proposal_ids TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_adp_status ON app_development_proposals(status);
    CREATE INDEX IF NOT EXISTS idx_adp_category ON app_development_proposals(category);
    CREATE INDEX IF NOT EXISTS idx_adp_created ON app_development_proposals(created_at);
  `);
}

/* ── Capability Discovery ─────────────────────────────────── */

function scanWorkers() {
  const workersDir = path.join(process.cwd(), 'workers');
  if (!fs.existsSync(workersDir)) return [];
  return fs.readdirSync(workersDir)
    .filter(f => f.endsWith('.js'))
    .map(f => {
      const content = fs.readFileSync(path.join(workersDir, f), 'utf-8');
      const nameMatch = content.match(/name:\s*['"`](.+?)['"`]/);
      const descMatch = content.match(/\/\/\s*(.+?)(?:\n|$)/);
      return {
        file: f,
        name: nameMatch?.[1] || f.replace('.js', ''),
        description: descMatch?.[1]?.trim() || 'Worker process',
        hasConfigFlag: content.includes('config.ENABLE_'),
        intervalMatch: content.match(/INTERVAL_MS\s*=\s*(\d+)/)?.[1]
      };
    });
}

function scanApis() {
  const apiDir = path.join(process.cwd(), 'api');
  if (!fs.existsSync(apiDir)) return [];
  return fs.readdirSync(apiDir)
    .filter(f => f.endsWith('.js'))
    .map(f => {
      const content = fs.readFileSync(path.join(apiDir, f), 'utf-8');
      const routeMatch = content.match(/export\s+default\s+async\s+function\s+handler/);
      return {
        file: f,
        route: `/api/${f.replace('.js', '')}`,
        hasHandler: !!routeMatch,
        importsSupabase: content.includes("from '../lib/supabase.js'") || content.includes('supabase'),
        importsMl: content.includes("from '../lib/ml/")
      };
    });
}

function scanSkills() {
  const skillsDir = path.join(process.cwd(), '.roo', 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const skillMd = path.join(skillsDir, d.name, 'SKILL.md');
      const hasSkill = fs.existsSync(skillMd);
      return { name: d.name, hasSkillMd: hasSkill };
    });
}

function scanStrategies() {
  try {
    const rows = db.prepare(`SELECT name FROM strategy_proposals WHERE rejected = 0`).all();
    return rows.map(r => r.name);
  } catch (e) {
    return [];
  }
}

function scanDbTables() {
  try {
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
    return rows.map(r => r.name);
  } catch (e) {
    return [];
  }
}

/* ── Proposal Generation ──────────────────────────────────── */

function generateCapabilityProposals(capabilities) {
  const proposals = [];

  // Proposal 1: Missing worker health monitoring
  if (!capabilities.workers.some(w => w.file.includes('health'))) {
    proposals.push({
      title: 'Worker Health Dashboard & Auto-Restart',
      description: 'Add a dedicated worker-health-monitor that tracks all PM2 processes, detects stale workers (no heartbeat > 5min), and auto-restarts them. Expose via /api/worker-health endpoint.',
      category: 'infra',
      capability_area: 'monitoring',
      impact_score: 0.85,
      effort_estimate: 'medium',
      tags: ['monitoring', 'reliability', 'pm2']
    });
  }

  // Proposal 2: Research-to-Mock feedback loop is weak
  const hasFeedbackLoop = capabilities.strategies.length > 0;
  if (!hasFeedbackLoop || capabilities.strategies.length < 5) {
    proposals.push({
      title: 'Tighten Research → Mock Trading Feedback Loop',
      description: 'Currently research agents extract strategies but mock trading may not validate them fast enough. Propose: (1) auto-backtest every new strategy proposal within 1h, (2) promote strategies with >54% WR after 20 mock trades, (3) auto-reject strategies with <40% WR.',
      category: 'strategy',
      capability_area: 'research',
      impact_score: 0.92,
      effort_estimate: 'medium',
      tags: ['research', 'mock-trading', 'feedback-loop', 'ml']
    });
  }

  // Proposal 3: Signal coverage is limited
  const pairCount = config.DEFAULT_PAIRS?.length || 0;
  if (pairCount < 20) {
    proposals.push({
      title: `Expand Signal Universe to 100+ Perpetual Pairs`,
      description: `Currently tracking ${pairCount} pairs. Fetch all perpetual pairs from Binance, Bybit, OKX, Hyperliquid via CCXT. Filter by min 24h volume > $1M. Add to config.DEFAULT_PAIRS dynamically. Research agent should scan the full universe.`,
      category: 'feature',
      capability_area: 'signals',
      impact_score: 0.88,
      effort_estimate: 'medium',
      tags: ['signals', 'exchange-api', 'ccxt', 'coverage']
    });
  }

  // Proposal 4: No real-time websocket for signals
  if (!config.ENABLE_WEBSOCKET) {
    proposals.push({
      title: 'Real-Time Signal WebSocket Feed',
      description: 'Add a WebSocket server (ws library) that broadcasts new signals, liquidation events, and research proposals to connected dashboard clients. Enables live updates without polling.',
      category: 'feature',
      capability_area: 'realtime',
      impact_score: 0.80,
      effort_estimate: 'high',
      tags: ['websocket', 'realtime', 'ui']
    });
  }

  // Proposal 5: ML model auto-retraining
  proposals.push({
    title: 'Auto-Retrain ML Model on Performance Degradation',
    description: 'Monitor ML model accuracy over a rolling 7-day window. If accuracy drops below 52%, trigger automatic retraining on the latest signal_snapshots + outcomes. Log retraining events and compare old vs new model on holdout set before promoting.',
    category: 'ml',
    capability_area: 'machine-learning',
    impact_score: 0.90,
    effort_estimate: 'high',
      tags: ['ml', 'auto-retrain', 'model-quality']
  });

  // Proposal 6: Position sizing based on Kelly Criterion
  proposals.push({
    title: 'Kelly Criterion Position Sizing',
    description: 'Replace fixed 1% risk per trade with dynamic Kelly sizing: f* = (bp - q) / b, where b=avg win/avg loss, p=win rate, q=1-p. Cap at 2% max to prevent over-leverage. Use mock trading stats per strategy to calculate personalized Kelly fraction.',
    category: 'risk',
    capability_area: 'position-sizing',
    impact_score: 0.87,
    effort_estimate: 'low',
    tags: ['risk', 'position-sizing', 'kelly', 'math']
  });

  // Proposal 7: Multi-timeframe confluence scoring
  proposals.push({
    title: 'Multi-Timeframe Confluence Score',
    description: 'For each pair, compute signals on 15m, 1h, 4h, 1d. A trade only fires when ≥3 timeframes agree (e.g., all LONG or 3 LONG + 1 NEUTRAL). Weight higher timeframes more heavily. This filters out noise and improves win rate.',
    category: 'strategy',
    capability_area: 'signals',
    impact_score: 0.91,
    effort_estimate: 'medium',
    tags: ['signals', 'multi-timeframe', 'confluence', 'filter']
  });

  // Proposal 8: Telegram alert for high-confidence signals
  proposals.push({
    title: 'Priority Telegram Alerts for High-Confidence Signals',
    description: 'Add a priority queue for signals with confidence ≥0.85 and win probability ≥70%. These bypass cooldown and are sent immediately to Telegram with enhanced formatting (chart snapshot link, key levels, funding context).',
    category: 'feature',
    capability_area: 'notifications',
    impact_score: 0.83,
    effort_estimate: 'low',
    tags: ['telegram', 'alerts', 'high-confidence', 'notifications']
  });

  // Proposal 9: Exchange-specific signal optimization
  proposals.push({
    title: 'Per-Exchange Signal Optimization',
    description: 'Different exchanges have different liquidity, fee structures, and funding dynamics. Train separate ML models or strategy weights per exchange (Binance vs Hyperliquid vs Bybit). Use exchange-specific features like maker/taker fee ratios and slippage estimates.',
    category: 'ml',
    capability_area: 'exchange-integration',
    impact_score: 0.86,
    effort_estimate: 'high',
    tags: ['exchange', 'optimization', 'per-exchange', 'ml']
  });

  // Proposal 10: On-chain whale flow integration
  proposals.push({
    title: 'On-Chain Whale Flow Signal Integration',
    description: 'Integrate Glassnode / CryptoQuant style on-chain metrics: exchange inflows/outflows, whale wallet movements, SOPR, MVRV. When large inflows to exchanges coincide with technical SHORT signals, boost confidence. Requires free tier APIs or public endpoints.',
      category: 'data-source',
    capability_area: 'on-chain',
    impact_score: 0.89,
    effort_estimate: 'high',
    tags: ['on-chain', 'whale', 'data-source', 'glassnode']
  });

  // Proposal 11: Automated paper → live transition gate
  proposals.push({
    title: 'Automated Paper → Live Trading Gate',
    description: 'Before any strategy can run in live mode, require: (1) ≥50 mock trades, (2) ≥55% win rate, (3) Sharpe ≥1.0, (4) max drawdown <15%, (5) 7 consecutive profitable days. Gate is enforced in trading.js checkRiskGates. Log gate decisions for audit.',
    category: 'risk',
    capability_area: 'trading-gate',
    impact_score: 0.95,
    effort_estimate: 'medium',
    tags: ['risk', 'live-trading', 'gate', 'paper-to-live']
  });

  // Proposal 12: Capability Consolidator self-improvement
  proposals.push({
    title: 'Self-Improving Capability Consolidator',
    description: 'The capability consolidator itself should track which proposals got approved vs rejected, learn what types of proposals are most valuable, and adjust its generation weights. Store approval history in capability_log and use simple heuristics to boost high-impact categories.',
    category: 'meta',
    capability_area: 'self-improvement',
    impact_score: 0.78,
    effort_estimate: 'low',
    tags: ['meta', 'self-improvement', 'capability-consolidator']
  });

  return proposals;
}

/* ── Persistence ──────────────────────────────────────────── */

function ensureLogDir() {
  const dir = path.dirname(MEMORY_LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function appendMemoryLog(entry) {
  ensureLogDir();
  fs.appendFileSync(MEMORY_LOG_PATH, JSON.stringify(entry) + '\n', 'utf-8');
}

export function saveProposal(proposal) {
  initCapabilityTables();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO app_development_proposals
      (created_at, updated_at, title, description, category, capability_area, impact_score, effort_estimate, proposed_by, status, tags, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    now, now,
    proposal.title,
    proposal.description,
    proposal.category,
    proposal.capability_area,
    proposal.impact_score,
    proposal.effort_estimate || 'medium',
    proposal.proposed_by || 'capability-consolidator',
    proposal.status || 'pending',
    JSON.stringify(proposal.tags || []),
    JSON.stringify(proposal.metadata || {})
  );

  const saved = { ...proposal, id: result.lastInsertRowid, created_at: now };
  appendMemoryLog({ type: 'proposal_created', ts: now, proposal: saved });
  return saved;
}

export function listProposals({ status, limit = 50 } = {}) {
  initCapabilityTables();
  let sql = `SELECT * FROM app_development_proposals`;
  const params = [];
  if (status) {
    sql += ` WHERE status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

export function updateProposalStatus(id, status, reviewNotes = '') {
  initCapabilityTables();
  const now = new Date().toISOString();
  const extra = {};
  if (status === 'approved') extra.approved_at = now;
  if (status === 'implemented') extra.implemented_at = now;
  if (reviewNotes) extra.review_notes = reviewNotes;
  if (status === 'approved' || status === 'rejected') extra.reviewed_at = now;

  const sets = ['status = ?', 'updated_at = ?'];
  const vals = [status, now];
  if (extra.approved_at) { sets.push('approved_at = ?'); vals.push(extra.approved_at); }
  if (extra.implemented_at) { sets.push('implemented_at = ?'); vals.push(extra.implemented_at); }
  if (extra.review_notes) { sets.push('review_notes = ?'); vals.push(extra.review_notes); }
  if (extra.reviewed_at) { sets.push('reviewed_at = ?'); vals.push(extra.reviewed_at); }
  vals.push(id);

  db.prepare(`UPDATE app_development_proposals SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  appendMemoryLog({ type: 'proposal_status_changed', ts: now, id, status, reviewNotes });
}

/* ── Main Consolidation Cycle ─────────────────────────────── */

export async function runConsolidationCycle() {
  logger.info('[CAPABILITY-CONSOLIDATOR] Starting consolidation cycle');
  initCapabilityTables();

  const capabilities = {
    workers: scanWorkers(),
    apis: scanApis(),
    skills: scanSkills(),
    strategies: scanStrategies(),
    dbTables: scanDbTables(),
    configFlags: {
      researchAgent: config.ENABLE_RESEARCH_AGENT_WORKER,
      capabilityConsolidator: config.ENABLE_CAPABILITY_CONSOLIDATOR,
      mockTrading: config.ENABLE_MOCK_TRADING_WORKER,
      websocket: config.ENABLE_WEBSOCKET,
    }
  };

  logger.info(`[CAPABILITY-CONSOLIDATOR] Scanned ${capabilities.workers.length} workers, ${capabilities.apis.length} APIs, ${capabilities.skills.length} skills, ${capabilities.strategies.length} strategies, ${capabilities.dbTables.length} tables`);

  // Generate proposals based on discovered gaps
  const proposals = generateCapabilityProposals(capabilities);
  logger.info(`[CAPABILITY-CONSOLIDATOR] Generated ${proposals.length} proposals`);

  // Check for duplicates (same title, last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recent = db.prepare(`SELECT title FROM app_development_proposals WHERE created_at > ?`).all(thirtyDaysAgo);
  const recentTitles = new Set(recent.map(r => r.title));

  let savedCount = 0;
  for (const p of proposals) {
    if (recentTitles.has(p.title)) {
      logger.debug(`[CAPABILITY-CONSOLIDATOR] Skipping duplicate: ${p.title}`);
      continue;
    }
    const saved = saveProposal(p);
    savedCount++;
    logger.info(`[CAPABILITY-CONSOLIDATOR] Saved proposal #${saved.id}: ${saved.title}`);
  }

  // Update skill file
  updateSkillFile(capabilities, savedCount);

  logger.info(`[CAPABILITY-CONSOLIDATOR] Cycle complete. ${savedCount} new proposals saved.`);
  return { capabilities, proposalsGenerated: proposals.length, proposalsSaved: savedCount };
}

function updateSkillFile(capabilities, newProposalsCount) {
  try {
    if (!fs.existsSync(SKILL_DIR)) {
      fs.mkdirSync(SKILL_DIR, { recursive: true });
    }
    const skillPath = path.join(SKILL_DIR, 'SKILL.md');
    const now = new Date().toISOString();
    const content = `# Capability Consolidator Skill

> Auto-generated by Capability Consolidator at ${now}

## Current Capabilities Snapshot

| Component | Count |
|-----------|-------|
| Workers | ${capabilities.workers.length} |
| API Routes | ${capabilities.apis.length} |
| Skills | ${capabilities.skills.length} |
| Strategy Proposals | ${capabilities.strategies.length} |
| DB Tables | ${capabilities.dbTables.length} |

## Active Workers
${capabilities.workers.map(w => `- **${w.name}** (${w.file}) — ${w.description}`).join('\n') || '_None detected_'}

## API Routes
${capabilities.apis.map(a => `- ${a.route} ${a.hasHandler ? '✅' : '⚠️'}`).join('\n') || '_None detected_'}

## Feature Flags
${Object.entries(capabilities.configFlags).map(([k, v]) => `- ${k}: ${v ? 'ON' : 'OFF'}`).join('\n')}

## Last Consolidation
- Time: ${now}
- New proposals generated: ${newProposalsCount}

## Review Queue
Check /api/app-development-proposals?status=pending for proposals awaiting review.
`;
    fs.writeFileSync(skillPath, content, 'utf-8');
  } catch (e) {
    logger.warn(`[CAPABILITY-CONSOLIDATOR] Skill file update failed: ${e.message}`);
  }
}

/* ── Review helpers ───────────────────────────────────────── */

export function getPendingProposalsForReview(limit = 10) {
  return listProposals({ status: 'pending', limit });
}

export function getProposalStats() {
  initCapabilityTables();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as c FROM app_development_proposals GROUP BY status
  `).all();
  const stats = { total: 0, pending: 0, approved: 0, rejected: 0, implemented: 0 };
  for (const r of rows) {
    stats[r.status] = r.c;
    stats.total += r.c;
  }
  return stats;
}
