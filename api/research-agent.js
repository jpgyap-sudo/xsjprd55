// ============================================================
// API: Research Agent (Enhanced with Assello extensions)
// POST /api/research-agent          — feed research input
// POST /api/research-agent?action=crawl    — trigger source crawler
// POST /api/research-agent?action=extract  — trigger strategy extraction
// GET  /api/research-agent          — list promoted + ranked strategies
// ============================================================

import {
  storeResearchItem,
  proposeStrategiesFromRecentResearch,
  researchCycle,
} from '../lib/ml/researchAgent.js';
import { saveStrategyProposal } from '../lib/ml/supabase-db.js';
import { getPromotedStrategies } from '../lib/ml/feedbackLoop.js';
import { crawlAllSources } from '../lib/ml/sourceCrawler.js';
import { extractAndSaveFromResearch } from '../lib/ml/strategyExtractor.js';
import { rankAllStrategies } from '../lib/ml/strategyEvaluator.js';
import { initMlDb } from '../lib/ml/db.js';

export default async function handler(req, res) {
  initMlDb();

  const action = req.query?.action || '';

  // ── POST /api/research-agent?action=crawl ───────────────────
  if (req.method === 'POST' && action === 'crawl') {
    const result = await crawlAllSources();
    return res.status(200).json({ action: 'crawl', ...result, ts: new Date().toISOString() });
  }

  // ── POST /api/research-agent?action=extract ─────────────────
  if (req.method === 'POST' && action === 'extract') {
    const result = extractAndSaveFromResearch();
    return res.status(200).json({ action: 'extract', ...result, ts: new Date().toISOString() });
  }

  // ── POST /api/research-agent ────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    const { items = [], autoPropose = true } = body;

    let stored = 0;
    let proposals = 0;

    if (Array.isArray(items) && items.length > 0) {
      const result = researchCycle(items);
      stored = result.stored;
      proposals = result.proposals;
    } else if (body.sourceName && body.content) {
      storeResearchItem({ sourceName: body.sourceName, sourceUrl: body.sourceUrl, content: body.content });
      stored = 1;
      if (autoPropose) {
        const props = proposeStrategiesFromRecentResearch(25);
        for (const p of props) saveStrategyProposal(p);
        proposals = props.length;
      }
    }

    return res.status(200).json({ stored, proposals, ts: new Date().toISOString() });
  }

  // ── GET /api/research-agent ─────────────────────────────────
  if (req.method === 'GET') {
    const promoted = getPromotedStrategies();
    const ranked = rankAllStrategies();
    return res.status(200).json({
      promotedStrategies: promoted,
      rankedStrategies: ranked.slice(0, 10),
      ts: new Date().toISOString(),
    });
  }

  res.status(405).send('Method Not Allowed');
}
