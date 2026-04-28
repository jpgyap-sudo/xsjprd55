// ============================================================
// Playwright Crawler Fallback
// Used when exchange APIs fail. Launches headless Chromium.
// ============================================================

import { logger } from '../lib/logger.js';

let chromium = null;

async function getChromium() {
  if (!chromium) {
    const pw = await import('playwright');
    chromium = pw.chromium;
  }
  return chromium;
}

/**
 * Crawl a public page and extract text or HTML.
 * @param {Object} opts
 * @param {string} opts.url
 * @param {string} [opts.selector]  CSS selector to extract inner text
 * @param {number} [opts.timeout=60000]
 */
export async function crawlPublicPage({ url, selector, timeout = 60000 }) {
  const browser = await (await getChromium()).launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout });
    if (selector) {
      const text = await page.locator(selector).innerText({ timeout: 10000 });
      return text;
    }
    const html = await page.content();
    return html;
  } catch (err) {
    logger.error(`[CRAWLER] Failed to crawl ${url}: ${err.message}`);
    throw err;
  } finally {
    await browser.close();
  }
}

/**
 * Extract liquidation heatmap JSON from a known public source.
 * Placeholder — adapt selectors to the actual site.
 */
export async function crawlLiquidationHeatmap(symbol = 'BTCUSDT') {
  // Example: CoinGlass public page (hypothetical URL)
  const url = `https://www.coinglass.com/LiquidationHeatMap`;
  const html = await crawlPublicPage({ url });
  // TODO: parse HTML to extract heatmap JSON
  logger.warn(`[CRAWLER] Liquidation heatmap parsing not yet implemented for ${symbol}`);
  return null;
}
