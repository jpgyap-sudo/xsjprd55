// ============================================================
// Unified Bot API — all self-improving bot endpoints in one function
// GET|POST /api/bot?type=suggestions     — suggestion CRUD + voting
// GET|POST /api/bot?type=sources         — data source registry
// GET      /api/bot?type=patterns        — signal patterns + stats
// GET|POST /api/bot?type=learn&secret=.. — run learning loop (cron)
// ============================================================

import { supabase } from '../lib/supabase.js';
import { voteSuggestion, reviewSuggestion } from '../lib/suggestion-engine.js';
import { getSources, registerSource, discoverSources } from '../lib/data-source-manager.js';
import { getPatternStats } from '../lib/pattern-learner.js';
import { runLearningLoop } from '../lib/learning-loop.js';
import { ingestNews, cleanupOldNews } from '../lib/news-store.js';

const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { type } = req.query || {};

    // ── Suggestions (default) ──────────────────────────────
    if (!type || type === 'suggestions') {
      if (req.method === 'GET') {
        const { status, category, limit = 50, offset = 0 } = req.query;
        let query = supabase
          .from('app_suggestions')
          .select('*')
          .order('generated_at', { ascending: false })
          .range(Number(offset), Number(offset) + Number(limit) - 1);
        if (status) query = query.eq('status', status);
        if (category) query = query.eq('category', category);

        // Separate count query for accurate totals (not limited to current page)
        let countQuery = supabase.from('app_suggestions').select('status');
        if (category) countQuery = countQuery.eq('category', category);
        const [{ data, error }, { data: allStatuses }] = await Promise.all([query, countQuery]);
        if (error) throw error;

        const counts = (allStatuses || []);
        const stats = {
          total: counts.length,
          pending: counts.filter(s => s.status === 'pending').length,
          approved: counts.filter(s => s.status === 'approved').length,
          rejected: counts.filter(s => s.status === 'rejected').length,
          implemented: counts.filter(s => s.status === 'implemented').length,
        };
        return res.status(200).json({ ok: true, suggestions: data || [], stats, count: counts.length });
      }

      if (req.method === 'POST') {
        const { id, action, vote, status, notes, ...body } = req.body || {};

        if (action === 'vote' && id) {
          const result = await voteSuggestion(id, vote);
          return res.status(200).json({ ok: true, suggestion: result });
        }

        if (action === 'review' && id) {
          const result = await reviewSuggestion(id, status, notes);
          return res.status(200).json({ ok: true, suggestion: result });
        }

        const { data, error } = await supabase
          .from('app_suggestions')
          .insert(body)
          .select()
          .single();
        if (error) throw error;
        return res.status(201).json({ ok: true, suggestion: data });
      }
    }

    // ── Data Sources ───────────────────────────────────────
    if (type === 'sources') {
      if (req.method === 'GET') {
        const { type: srcType, status, provides } = req.query;
        const sources = await getSources({ type: srcType, status, provides });
        return res.status(200).json({ ok: true, sources, count: sources.length });
      }
      if (req.method === 'POST') {
        const { action, ...body } = req.body || {};
        if (action === 'discover') {
          const discoveries = await discoverSources();
          return res.status(200).json({ ok: true, discoveries, count: discoveries.length });
        }
        const source = await registerSource(body);
        return res.status(201).json({ ok: true, source });
      }
    }

    // ── Patterns ───────────────────────────────────────────
    if (type === 'patterns') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const { strategy, symbol, limit = 50, offset = 0, stats } = req.query;
      if (stats === 'true') {
        const data = await getPatternStats({ strategy, symbol, limit: Number(limit) });
        return res.status(200).json({ ok: true, ...data });
      }
      let query = supabase
        .from('signal_patterns')
        .select('*')
        .order('generated_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);
      if (strategy) query = query.eq('strategy', strategy);
      if (symbol) query = query.eq('symbol', symbol);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ ok: true, patterns: data || [], count: data?.length || 0 });
    }

    // ── Learning Loop ──────────────────────────────────────
    if (type === 'learn') {
      const secret = req.query?.secret || req.body?.secret;
      if (secret !== CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const results = await runLearningLoop();
      return res.status(200).json({ ok: true, results });
    }

    // ── News Ingest (cron) ─────────────────────────────────
    if (type === 'ingest-news') {
      const secret = req.query?.secret || req.body?.secret;
      if (secret !== CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized cron request' });
      }
      const results = { ingest: null, cleanup: null, durationMs: 0 };
      const start = Date.now();
      try {
        results.ingest = await ingestNews({ maxAgeMinutes: 60 });
        if (Math.random() < 0.05) {
          results.cleanup = await cleanupOldNews(7);
        }
        results.durationMs = Date.now() - start;
        return res.status(200).json({
          ok: true,
          inserted: results.ingest.inserted,
          duplicates: results.ingest.duplicates,
          errors: results.ingest.errors,
          sources: results.ingest.sources,
          cleanup: results.cleanup,
          durationMs: results.durationMs
        });
      } catch (err) {
        console.error('[bot/ingest-news] fatal error:', err);
        return res.status(500).json({
          ok: false,
          error: err.message,
          durationMs: Date.now() - start
        });
      }
    }

    return res.status(400).json({ error: 'Invalid type parameter' });
  } catch (err) {
    console.error('[api/bot] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
