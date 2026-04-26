// ============================================================
// News Aggregator — RSS feed fetching for crypto news
// Sources: CoinTelegraph, CoinDesk, WatcherGuru, CryptoSlate
// No external RSS parser — pure fetch + regex XML parsing
// ============================================================

const SOURCES = [
  {
    name: 'CoinTelegraph',
    url: 'https://cointelegraph.com/rss',
    weight: 1.2,
    tags: ['bitcoin', 'ethereum', 'defi', 'regulation']
  },
  {
    name: 'CoinDesk',
    url: 'https://feeds.feedburner.com/CoinDesk',
    weight: 1.2,
    tags: ['bitcoin', 'markets', 'policy']
  },
  {
    name: 'WatcherGuru',
    url: 'https://watcherguru.com/feed/',
    weight: 1.0,
    tags: ['altcoins', 'whale', 'breaking']
  },
  {
    name: 'CryptoSlate',
    url: 'https://cryptoslate.com/feed/',
    weight: 0.9,
    tags: ['market', 'defi', 'nft']
  }
];

const PROCESSED_URLS = new Set(); // Session-level dedup (resets on cold start)

function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(regex);
  if (!m) return '';
  // Strip CDATA wrapper and HTML tags
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRSS(xml) {
  const items = [];
  const regex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'pubdate');
    const summary = extractTag(block, 'description') || extractTag(block, 'content:encoded');
    if (title && link) {
      items.push({ title, link, pubDate, summary });
    }
  }
  return items;
}

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function isRecent(pubDateStr, minutes) {
  if (!pubDateStr) return true; // include if no date
  const d = new Date(pubDateStr);
  if (isNaN(d.getTime())) return true;
  const age = Date.now() - d.getTime();
  return age < minutes * 60 * 1000;
}

export async function fetchAllNews(maxAgeMinutes = 60) {
  const results = [];

  const promises = SOURCES.map(async (source) => {
    try {
      const xml = await fetchWithTimeout(source.url, 8000);
      const items = parseRSS(xml);
      const fresh = items
        .filter(item => isRecent(item.pubDate, maxAgeMinutes))
        .filter(item => !PROCESSED_URLS.has(item.link))
        .map(item => {
          PROCESSED_URLS.add(item.link);
          return {
            source: source.name,
            title: item.title,
            summary: item.summary,
            url: item.link,
            publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
            weight: source.weight
          };
        });
      results.push(...fresh);
    } catch (err) {
      console.warn(`⚠️ ${source.name} fetch failed: ${err.message}`);
    }
  });

  await Promise.allSettled(promises);

  // Sort by publish date, newest first
  return results.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

export { SOURCES };
