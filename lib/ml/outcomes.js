// ============================================================
// Outcome Labeling — xsjprd55 ML Loop
// Labels signal snapshots as win/loss after TP/SL or candle close.
// ============================================================

import { db } from './db.js';

/**
 * @param {Object} params
 * @param {number} params.entryPrice
 * @param {number} params.exitPrice
 * @param {string} params.side — 'LONG' | 'SHORT'
 * @param {number} [params.tpPct] — take-profit %
 * @param {number} [params.slPct] — stop-loss %
 * @returns {{label:number, returnPct:number}}
 *   label: 1 = win, 0 = loss
 */
export function labelOutcome({ entryPrice, exitPrice, side, tpPct = 2, slPct = 1 }) {
  if (!entryPrice || !exitPrice || entryPrice <= 0) {
    return { label: 0, returnPct: 0 };
  }

  const rawReturnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
  const signedReturn = side === 'SHORT' ? -rawReturnPct : rawReturnPct;

  const tpThreshold = tpPct;
  const slThreshold = -slPct;

  let label = 0;
  if (signedReturn >= tpThreshold) label = 1;
  else if (signedReturn <= slThreshold) label = 0;
  else {
    // Partial / ambiguous — label by direction
    label = signedReturn > 0 ? 1 : 0;
  }

  return { label, returnPct: Number(signedReturn.toFixed(4)) };
}

/**
 * Backfill unlabeled snapshots using stored price + side.
 * @param {string} symbol
 * @param {number} currentPrice
 * @returns {number} count updated
 */
export function backfillOutcomes(symbol, currentPrice) {
  const stmt = db.prepare(`
    SELECT id, price, signal_side
    FROM signal_snapshots
    WHERE symbol = ? AND outcome_label IS NULL
    ORDER BY created_at ASC
  `);
  const rows = stmt.all(symbol);

  let updated = 0;
  const update = db.prepare(`
    UPDATE signal_snapshots
    SET outcome_label = ?, outcome_return_pct = ?, outcome_checked_at = datetime('now')
    WHERE id = ?
  `);

  for (const row of rows) {
    const { label, returnPct } = labelOutcome({
      entryPrice: row.price,
      exitPrice: currentPrice,
      side: row.signal_side,
    });
    update.run(label, returnPct, row.id);
    updated++;
  }

  return updated;
}
