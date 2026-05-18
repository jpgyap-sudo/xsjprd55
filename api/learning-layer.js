// ============================================================
// Trading Learning Layer API — Status, trigger, insights,
// and unified learning ecosystem dashboard
// ============================================================

import { runLearningLayer } from '../lib/learning-layer/index.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

// ── Bridge snapshots ───────────────────────────────────────
import { getPerpetualTllSnapshot } from '../lib/learning-layer/perpetual-trader-bridge.js';
import { getResearchAgentTllSnapshot } from '../lib/learning-layer/research-agent-bridge.js';
import { getSignalAgentTllSnapshot } from '../lib/learning-layer/signal-agent-bridge.js';
import { getTllMockTradingSnapshot } from '../lib/learning-layer/mock-trading-bridge.js';

/**
 * GET  /api/learning-layer — TLL status dashboard
 * POST /api/learning-layer?action=run — Trigger TLL cycle
 * GET  /api/learning-layer/patterns — Discovered patterns
 * GET  /api/learning-layer/skills — Generated trading skills
 * GET  /api/learning-layer/regime — Current market regime
 * GET  /api/learning-layer/healing — Healing log
 * GET  /api/learning-layer/ecosystem — Unified learning ecosystem snapshot
 */
export default async function handler(req, res) {
  const { method, query } = req;

  // ── POST: Trigger TLL cycle ──────────────────────────────
  if (method === 'POST' && query.action === 'run') {
    try {
      const results = await runLearningLayer({ force: true });
      return res.status(200).json({ ok: true, results });
    } catch (e) {
      logger.error('[API_TLL] POST /run failed:', e.message);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GET: Patterns ────────────────────────────────────────
  if (method === 'GET' && query.view === 'patterns') {
    try {
      const { data, error } = await supabase
        .from('tll_patterns')
        .select('*')
        .order('win_rate', { ascending: false })
        .limit(50);

      if (error) throw error;
      return res.status(200).json({ ok: true, patterns: data || [] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GET: Skills ──────────────────────────────────────────
  if (method === 'GET' && query.view === 'skills') {
    try {
      const { data, error } = await supabase
        .from('tll_skills')
        .select('*')
        .eq('active', true)
        .order('confidence', { ascending: false })
        .limit(50);

      if (error) throw error;
      return res.status(200).json({ ok: true, skills: data || [] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GET: Regime ──────────────────────────────────────────
  if (method === 'GET' && query.view === 'regime') {
    try {
      const { data, error } = await supabase
        .from('tll_regime_log')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return res.status(200).json({ ok: true, regimes: data || [] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GET: Healing ─────────────────────────────────────────
  if (method === 'GET' && query.view === 'healing') {
    try {
      const { data, error } = await supabase
        .from('tll_healing_log')
        .select('*')
        .order('healed_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return res.status(200).json({ ok: true, healing: data || [] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GET: Tournament ───────────────────────────────────────
  if (method === 'GET' && query.view === 'tournament') {
    try {
      const { runStrategyTournament } = await import('../lib/learning-layer/strategy-tournament.js');
      const tournament = await runStrategyTournament();
      return res.status(200).json({
        ok: true,
        rankings: tournament.rankings || [],
        matches: tournament.matches || [],
        strategyStats: tournament.strategyStats || {},
        status: tournament.status || 'completed',
      });
    } catch (e) {
      logger.error('[API_TLL] GET /tournament failed:', e.message);
      return res.status(200).json({ ok: true, rankings: [], matches: [], strategyStats: {}, status: 'error' });
    }
  }

  // ── GET: Unified Learning Ecosystem ──────────────────────
  if (method === 'GET' && query.view === 'ecosystem') {
    try {
      const [
        mockTradingSnapshot,
        perpetualSnapshot,
        researchAgentSnapshot,
        signalAgentSnapshot,
        { count: brainMemoryCount },
        { count: patternCount },
        { count: skillCount },
        { count: healingCount },
        { data: latestRegime },
      ] = await Promise.all([
        getTllMockTradingSnapshot(),
        getPerpetualTllSnapshot(),
        getResearchAgentTllSnapshot(),
        getSignalAgentTllSnapshot(),
        supabase.from('brain_signal_memory').select('id', { count: 'exact', head: true }),
        supabase.from('tll_patterns').select('*', { count: 'exact', head: true }),
        supabase.from('tll_skills').select('*', { count: 'exact', head: true }).eq('active', true),
        supabase.from('tll_healing_log').select('*', { count: 'exact', head: true }),
        supabase.from('tll_regime_log').select('*').order('detected_at', { ascending: false }).limit(1).single(),
      ]);

      const totalIngested =
        (mockTradingSnapshot?.ingestedIntoBrainMemory || 0) +
        (perpetualSnapshot?.ingestedIntoBrainMemory || 0) +
        (researchAgentSnapshot?.ingestedIntoBrainMemory || 0) +
        (signalAgentSnapshot?.ingestedIntoBrainMemory || 0);

      return res.status(200).json({
        ok: true,
        ecosystem: {
          brainMemory: {
            totalRecords: brainMemoryCount || 0,
            totalIngestedFromBridges: totalIngested,
          },
          tll: {
            patternsDiscovered: patternCount || 0,
            activeSkills: skillCount || 0,
            healingEvents: healingCount || 0,
            currentRegime: latestRegime || null,
            enabled: process.env.TLL_ENABLED !== 'false',
            intervalMs: parseInt(process.env.TLL_INTERVAL_MS || '1800000', 10),
          },
          bridges: {
            mockTrading: mockTradingSnapshot,
            perpetualTrader: perpetualSnapshot,
            researchAgent: researchAgentSnapshot,
            signalAgent: signalAgentSnapshot,
          },
          lastSync: new Date().toISOString(),
        },
      });
    } catch (e) {
      logger.error('[API_TLL] GET /ecosystem failed:', e.message);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GET: Status dashboard (default) ──────────────────────
  if (method === 'GET') {
    try {
      const [
        { count: patternCount },
        { count: skillCount },
        { count: healingCount },
        { data: latestRegime },
        { count: resolvedCount },
      ] = await Promise.all([
        supabase.from('tll_patterns').select('*', { count: 'exact', head: true }),
        supabase.from('tll_skills').select('*', { count: 'exact', head: true }).eq('active', true),
        supabase.from('tll_healing_log').select('*', { count: 'exact', head: true }),
        supabase.from('tll_regime_log').select('*').order('detected_at', { ascending: false }).limit(1).single(),
        supabase.from('brain_signal_memory').select('*', { count: 'exact', head: true }).not('resolved_at', 'is', null),
      ]);

      return res.status(200).json({
        ok: true,
        status: {
          patterns_discovered: patternCount || 0,
          active_skills: skillCount || 0,
          healing_events: healingCount || 0,
          resolved_signals: resolvedCount || 0,
          current_regime: latestRegime || null,
          tll_enabled: process.env.TLL_ENABLED !== 'false',
          tll_interval_ms: parseInt(process.env.TLL_INTERVAL_MS || '1800000', 10),
        },
      });
    } catch (e) {
      logger.error('[API_TLL] GET /status failed:', e.message);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
