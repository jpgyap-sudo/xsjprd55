// ============================================================
// Fetch-with-Fallback Pattern
// Tries API first; falls back to crawler; updates source health.
// ============================================================

import { updateSourceHealth } from './data-health.js';
import { createNotification } from './notification-engine.js';
import { logger } from './logger.js';

/**
 * Fetch data with API-first, crawler-fallback strategy.
 * @param {Object} opts
 * @param {string} opts.source       Source name (e.g. 'CoinGlass')
 * @param {string} opts.dataType     Data type (e.g. 'liquidation')
 * @param {Function} opts.apiFn      Async API fetch function
 * @param {Function} opts.crawlerFn  Async crawler fallback function
 */
export async function fetchWithFallback({ source, dataType, apiFn, crawlerFn }) {
  try {
    const data = await apiFn();
    await updateSourceHealth({
      sourceName: source,
      dataType,
      apiStatus: 'online',
      crawlerStatus: 'not_needed',
      fallbackUsed: false,
      error: null,
    });
    logger.info(`[FETCH] ${source} ${dataType} via API`);
    return { data, source, method: 'api', fallbackUsed: false };
  } catch (apiError) {
    logger.warn(`[FETCH] ${source} API failed for ${dataType}: ${apiError.message}`);

    await createNotification({
      level: 'warning',
      title: `${source} API error`,
      message: `${source} API failed for ${dataType}. Activating crawler fallback.`,
      source,
      dataType,
    });

    if (!crawlerFn) {
      await updateSourceHealth({
        sourceName: source,
        dataType,
        apiStatus: 'error',
        crawlerStatus: 'not_available',
        fallbackUsed: false,
        error: apiError.message,
      });
      return { data: null, source, method: 'failed', fallbackUsed: false, apiError: apiError.message };
    }

    try {
      const crawledData = await crawlerFn();
      await updateSourceHealth({
        sourceName: source,
        dataType,
        apiStatus: 'error',
        crawlerStatus: 'online',
        fallbackUsed: true,
        error: apiError.message,
      });
      await createNotification({
        level: 'warning',
        title: 'Crawler fallback used',
        message: `${source} crawler was used because API failed for ${dataType}. Accuracy may be lower.`,
        source,
        dataType,
      });
      logger.info(`[FETCH] ${source} ${dataType} via crawler fallback`);
      return { data: crawledData, source, method: 'crawler', fallbackUsed: true, apiError: apiError.message };
    } catch (crawlerError) {
      logger.error(`[FETCH] ${source} crawler also failed for ${dataType}: ${crawlerError.message}`);
      await updateSourceHealth({
        sourceName: source,
        dataType,
        apiStatus: 'error',
        crawlerStatus: 'error',
        fallbackUsed: false,
        error: crawlerError.message,
      });
      await createNotification({
        level: 'critical',
        title: `${source} data unavailable`,
        message: `${source} API and crawler both failed for ${dataType}. Reduce confidence score.`,
        source,
        dataType,
      });
      return {
        data: null,
        source,
        method: 'failed',
        fallbackUsed: false,
        apiError: apiError.message,
        crawlerError: crawlerError.message,
      };
    }
  }
}
