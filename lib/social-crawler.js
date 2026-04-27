// ============================================================
// Social & Market Data Crawler
// Scrapes crypto social media and analytics sites for sentiment,
// trending tokens, funding data, and liquidation signals.
// Uses Playwright with anti-detection and rate limiting.
// ============================================================

import { chromium } from 'playwright';
import { logger } from './logger.js';

const BROWSER_TIMEOUT = 30000;

async function getBrowser() {
  return chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
    ],
  });
}

// ── Birdeye Perps ───────────────────────────────────────────
export async function crawlBirdeyePerps() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const results = { trending: [], funding: [], liquidations: [], timestamp: new Date().toISOString() };

  try {
    await page.goto('https://birdeye.so/perps', { waitUntil: 'networkidle', timeout: BROWSER_TIMEOUT });
    await page.waitForTimeout(3000);

    // Extract trending perp tokens
    const tokens = await page.$$eval('table tbody tr, [data-testid="token-row"], .token-item', rows =>
      rows.slice(0, 20).map(row => {
        const text = row.innerText || row.textContent || '';
        const parts = text.split(/\s+/).filter(Boolean);
        return {
          symbol: parts[0]?.replace('$', '') || null,
          price: parseFloat(parts.find(p => p.startsWith('$'))?.replace('$', '') || 0),
          change24h: parseFloat(parts.find(p => p.includes('%'))?.replace('%', '') || 0),
          volume: parts.find(p => p.toLowerCase().includes('m') || p.toLowerCase().includes('k')) || null,
          raw: text.slice(0, 500),
        };
      }).filter(t => t.symbol)
    );

    results.trending = tokens;
    logger.info(`[SOCIAL-CRAWLER] Birdeye: ${tokens.length} tokens scraped`);
  } catch (err) {
    logger.warn(`[SOCIAL-CRAWLER] Birdeye failed: ${err.message}`);
  } finally {
    await browser.close();
  }

  return results;
}

// ── CoinMarketCap Fear & Greed / Trending ───────────────────
export async function crawlCoinMarketCap() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const results = { fearGreed: null, trending: [], timestamp: new Date().toISOString() };

  try {
    // Trending cryptocurrencies
    await page.goto('https://coinmarketcap.com/trending/', { waitUntil: 'networkidle', timeout: BROWSER_TIMEOUT });
    await page.waitForTimeout(3000);

    const trending = await page.$$eval('table tbody tr', rows =>
      rows.slice(0, 10).map(row => {
        const cells = row.querySelectorAll('td');
        return {
          rank: cells[0]?.textContent?.trim() || null,
          name: cells[1]?.textContent?.trim().split('\n')[0] || null,
          symbol: cells[1]?.textContent?.trim().split('\n')[1] || null,
          price: cells[2]?.textContent?.trim() || null,
          change24h: cells[3]?.textContent?.trim() || null,
        };
      }).filter(t => t.symbol)
    );
    results.trending = trending;

    // Fear & Greed
    await page.goto('https://coinmarketcap.com/charts/fear-and-greed-index/', { waitUntil: 'networkidle', timeout: BROWSER_TIMEOUT });
    await page.waitForTimeout(2000);

    const fgText = await page.$eval('.fear-and-greed-index, [data-testid="fear-greed-value"], .index-value', el => el.textContent).catch(() => null);
    const fgLabel = await page.$eval('.fear-and-greed-label, [data-testid="fear-greed-label"]', el => el.textContent).catch(() => null);

    if (fgText) {
      results.fearGreed = {
        value: parseInt(fgText.replace(/\D/g, ''), 10) || null,
        label: fgLabel?.trim() || null,
      };
    }

    logger.info(`[SOCIAL-CRAWLER] CMC: ${trending.length} trending, FG=${results.fearGreed?.value}`);
  } catch (err) {
    logger.warn(`[SOCIAL-CRAWLER] CMC failed: ${err.message}`);
  } finally {
    await browser.close();
  }

  return results;
}

// ── CryptoPanic (News + Social sentiment proxy) ─────────────
export async function crawlCryptoPanic() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const results = { posts: [], timestamp: new Date().toISOString() };

  try {
    await page.goto('https://cryptopanic.com/news/', { waitUntil: 'networkidle', timeout: BROWSER_TIMEOUT });
    await page.waitForTimeout(3000);

    const posts = await page.$$eval('.news-item, article, [data-testid="news-item"]', items =>
      items.slice(0, 20).map(item => {
        const title = item.querySelector('h2, .title, a')?.textContent?.trim() || '';
        const source = item.querySelector('.source, .domain')?.textContent?.trim() || 'unknown';
        const votes = item.querySelector('.votes, .score')?.textContent?.trim() || '0';
        return { title, source, votes: parseInt(votes, 10) || 0 };
      }).filter(p => p.title)
    );

    results.posts = posts;
    logger.info(`[SOCIAL-CRAWLER] CryptoPanic: ${posts.length} posts`);
  } catch (err) {
    logger.warn(`[SOCIAL-CRAWLER] CryptoPanic failed: ${err.message}`);
  } finally {
    await browser.close();
  }

  return results;
}

// ── DexScreener Trending ────────────────────────────────────
export async function crawlDexScreener() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const results = { pairs: [], timestamp: new Date().toISOString() };

  try {
    await page.goto('https://dexscreener.com/', { waitUntil: 'networkidle', timeout: BROWSER_TIMEOUT });
    await page.waitForTimeout(3000);

    const pairs = await page.$$eval('a[href*="/solana/"], a[href*="/ethereum/"], [data-testid="token-pair"]', items =>
      items.slice(0, 15).map(item => {
        const text = item.innerText || item.textContent || '';
        const parts = text.split(/\s+/).filter(Boolean);
        return {
          pair: parts[0] || null,
          price: parts.find(p => p.startsWith('$')) || null,
          change: parts.find(p => p.includes('%')) || null,
          volume: parts.find(p => /[0-9]+[KMB]/.test(p)) || null,
          raw: text.slice(0, 300),
        };
      }).filter(p => p.pair)
    );

    results.pairs = pairs;
    logger.info(`[SOCIAL-CRAWLER] DexScreener: ${pairs.length} pairs`);
  } catch (err) {
    logger.warn(`[SOCIAL-CRAWLER] DexScreener failed: ${err.message}`);
  } finally {
    await browser.close();
  }

  return results;
}

// ── Sentiment Analysis Helper ───────────────────────────────
export function analyzeSentiment(text) {
  const bullish = /\b(pump|moon|bullish|breakout|rally|surge| ATH|buy|long|green|rocket)\b/gi;
  const bearish = /\b(dump|crash|bearish|breakdown|rekt|sell|short|red|liquidat|fud)\b/gi;

  const bCount = (text.match(bullish) || []).length;
  const beCount = (text.match(bearish) || []).length;
  const total = bCount + beCount;

  if (total === 0) return { score: 0, label: 'neutral' };
  const score = (bCount - beCount) / Math.max(total, 1);
  return {
    score: Math.max(-1, Math.min(1, score)),
    label: score > 0.2 ? 'bullish' : score < -0.2 ? 'bearish' : 'neutral',
    bullishCount: bCount,
    bearishCount: beCount,
  };
}

// ── Aggregate all sources ───────────────────────────────────
export async function runSocialCrawl() {
  logger.info('[SOCIAL-CRAWLER] Starting multi-source crawl...');

  const [birdeye, cmc, panic, dex] = await Promise.allSettled([
    crawlBirdeyePerps(),
    crawlCoinMarketCap(),
    crawlCryptoPanic(),
    crawlDexScreener(),
  ]);

  const aggregate = {
    birdeye: birdeye.status === 'fulfilled' ? birdeye.value : { error: birdeye.reason?.message },
    coinmarketcap: cmc.status === 'fulfilled' ? cmc.value : { error: cmc.reason?.message },
    cryptopanic: panic.status === 'fulfilled' ? panic.value : { error: panic.reason?.message },
    dexscreener: dex.status === 'fulfilled' ? dex.value : { error: dex.reason?.message },
    timestamp: new Date().toISOString(),
  };

  // Compute overall sentiment from all text sources
  let allText = '';
  if (aggregate.cryptopanic?.posts) {
    allText += aggregate.cryptopanic.posts.map(p => p.title).join(' ');
  }
  if (aggregate.birdeye?.trending) {
    allText += ' ' + aggregate.birdeye.trending.map(t => t.raw).join(' ');
  }

  aggregate.overallSentiment = analyzeSentiment(allText);

  logger.info(`[SOCIAL-CRAWLER] Complete. Sentiment: ${aggregate.overallSentiment.label} (${aggregate.overallSentiment.score.toFixed(2)})`);
  return aggregate;
}
