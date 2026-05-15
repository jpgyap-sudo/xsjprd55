// ============================================================
// Shared Strategy Proposal Saver — xsjprd55
// Single source of truth for saving strategy proposals.
// Tries Supabase first, falls back to SQLite.
// ============================================================

import { db } from './db.js';
import { saveStrategyProposal as supaSave } from './supabase-db.js';
import { logger } from '../logger.js';

/**
 * Save a strategy proposal to the database.
 * Tries Supabase first, falls back to SQLite.
 * @param {Object} proposal
 * @param {string} proposal.name
 * @param {string} [proposal.description]
 * @param {Array} [proposal.rules]
 * @param {number} [proposal.confidence]
 * @param {string[]} [proposal.tags]
 * @param {string} [proposal.rulesHash]
 * @param {string} [proposal.sourceName]
 * @param {number} [proposal.sourceCredibility]
 * @returns {Promise<{ok:boolean, id?:number, error?:string}>}
 */
export async function saveProposal(proposal) {
  const {
    name,
    description = '',
    rules = [],
    confidence = 0.5,
    tags = [],
    rulesHash = null,
    sourceName = 'unknown',
    sourceCredibility = 0.5,
  } = proposal;

  // Try Supabase first
  try {
    await supaSave({
      name,
      description,
      rules,
      confidence,
      tags,
      rulesHash,
      sourceName,
      sourceCredibility,
    });
    return { ok: true };
  } catch (e) {
    logger.debug(`[SAVE-PROPOSAL] Supabase save failed, falling back to SQLite: ${e.message}`);
  }

  // Fallback to SQLite
  try {
    const stmt = db.prepare(`
      INSERT INTO strategy_proposals
        (created_at, name, description, rules_json, confidence, tested, promoted, rejected, rules_hash, source_name, source_credibility)
      VALUES (datetime('now'), ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)
    `);
    const result = stmt.run(name, description, JSON.stringify(rules), confidence, rulesHash, sourceName, sourceCredibility);
    return { ok: true, id: result.lastInsertRowid };
  } catch (e) {
    logger.error(`[SAVE-PROPOSAL] SQLite save failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * Mark a research source as used.
 * Tries Supabase first, falls back to SQLite.
 * @param {number|string} sourceId
 * @returns {Promise<boolean>}
 */
export async function markSourceUsed(sourceId) {
  try {
    const { markResearchSourceUsed } = await import('./supabase-db.js');
    await markResearchSourceUsed(sourceId);
    return true;
  } catch (e) {
    try {
      db.prepare(`UPDATE research_sources SET used = 1 WHERE id = ?`).run(sourceId);
      return true;
    } catch (e2) {
      logger.warn(`[SAVE-PROPOSAL] Failed to mark source ${sourceId} as used: ${e2.message}`);
      return false;
    }
  }
}
