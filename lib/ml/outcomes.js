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
 * Get the estimated exit price for a signal based on its timeframe and creation time.
 * Uses the latest available close price within the signal's expected duration.
 *
 * Timeframe → expected signal duration (TTL):
 *   1m  → 5 min
 *   5m  → 15 min
 *   15m → 1 hour
 *   30m → 2 hours
 *   1h  → 4 hours
 *   2h  → 8 hours
 *   4h  → 24 hours
 *   1d  → 7 days
 *   default → 1 hour
 *
 * @param {object} signal - { id, symbol, timeframe, created_at, price }
 * @param {number} currentPrice - The latest known price
 * @param {Array<object>} [priceHistory] - Optional array of { timestamp, close } for precise exit
 * @returns {{ exitPrice: number, exitReason: string }}
 */
export function estimateExitPrice(signal, currentPrice, priceHistory = []) {
  const TTL_MAP = {
    '1m': 5 * 60 * 1000,
    '5m': 15 * 60 * 1000,
    '15m': 60 * 60 * 1000,
    '30m': 2 * 60 * 60 * 1000,
    '1h': 4 * 60 * 60 * 1000,
    '2h': 8 * 60 * 60 * 1000,
    '4h': 24 * 60 * 60 * 1000,
    '1d': 7 * 24 * 60 * 60 * 1000,
  };

  const ttl = TTL_MAP[signal.timeframe] || 60 * 60 * 1000; // default 1h
  const signalTime = new Date(signal.created_at).getTime();
  const expiryTime = signalTime + ttl;
  const now = Date.now();

  // If the signal hasn't expired yet, use current price
  if (now < expiryTime) {
    return { exitPrice: currentPrice, exitReason: 'still_open' };
  }

  // If we have price history, find the closest price to expiry time
  if (priceHistory.length > 0) {
    const sorted = [...priceHistory].sort(
      (a, b) => Math.abs(new Date(a.timestamp).getTime() - expiryTime)
        - Math.abs(new Date(b.timestamp).getTime() - expiryTime)
    );
    if (sorted.length > 0) {
      return { exitPrice: sorted[0].close, exitReason: 'price_history_expiry' };
    }
  }

  // Fallback: use current price as best estimate
  return { exitPrice: currentPrice, exitReason: 'current_price_fallback' };
}

/**
 * Backfill unlabeled snapshots using timeframe-aware exit price estimation.
 * Processes in batches to avoid overwhelming the DB.
 *
 * @param {string} symbol
 * @param {number} currentPrice
 * @param {object} [opts]
 * @param {number} [opts.batchSize=100] - Max rows to process per call
 * @param {Array<object>} [opts.priceHistory] - Optional price history for precise exit
 * @returns {{ updated: number, total: number, errors: string[] }}
 */
export function backfillOutcomes(symbol, currentPrice, opts = {}) {
  const errors = [];
  const batchSize = opts.batchSize || 100;
  const priceHistory = opts.priceHistory || [];

  const stmt = db.prepare(`
    SELECT id, price, signal_side, timeframe, created_at
    FROM signal_snapshots
    WHERE symbol = ? AND outcome_label IS NULL
    ORDER BY created_at ASC
    LIMIT ?
  `);
  const rows = stmt.all(symbol, batchSize);

  if (rows.length === 0) {
    return { updated: 0, total: 0, errors: [] };
  }

  let updated = 0;
  const update = db.prepare(`
    UPDATE signal_snapshots
    SET outcome_label = ?, outcome_return_pct = ?, outcome_checked_at = datetime('now')
    WHERE id = ?
  `);

  const tx = db.transaction(() => {
    for (const row of rows) {
      try {
        const { exitPrice } = estimateExitPrice(
          { id: row.id, symbol, timeframe: row.timeframe, created_at: row.created_at, price: row.price },
          currentPrice,
          priceHistory
        );

        const { label, returnPct } = labelOutcome({
          entryPrice: row.price,
          exitPrice,
          side: row.signal_side,
        });
        update.run(label, returnPct, row.id);
        updated++;
      } catch (e) {
        errors.push(`Row ${row.id}: ${e.message}`);
      }
    }
  });

  tx();

  return { updated, total: rows.length, errors };
}

/**
 * Backfill ALL unlabeled snapshots across all symbols.
 * Calls backfillOutcomes in a loop until all are processed.
 *
 * @param {object} marketData - Map of symbol → { price, priceHistory? }
 * @param {object} [opts]
 * @param {number} [opts.batchSize=100]
 * @returns {Promise<{ totalUpdated: number, details: object }>}
 */
export async function backfillAllOutcomes(marketData, opts = {}) {
  const batchSize = opts.batchSize || 100;
  const details = {};
  let totalUpdated = 0;

  for (const [symbol, data] of Object.entries(marketData)) {
    let symbolUpdated = 0;
    let keepGoing = true;

    while (keepGoing) {
      const result = backfillOutcomes(symbol, data.price, {
        batchSize,
        priceHistory: data.priceHistory || [],
      });
      symbolUpdated += result.updated;
      if (result.errors.length > 0) {
        console.error(`[OUTCOMES] Errors for ${symbol}: ${result.errors.join('; ')}`);
      }
      if (result.updated < batchSize) {
        keepGoing = false;
      }
    }

    details[symbol] = symbolUpdated;
    totalUpdated += symbolUpdated;
  }

  return { totalUpdated, details };
}
