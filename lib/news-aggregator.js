// ============================================================
// News Aggregator - RSS feed fetching for crypto news
// Sources: CoinTelegraph, CoinDesk, WatcherGuru, CryptoSlate
// No external RSS parser - pure fetch + regex XML parsing
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
  },
  {
    name: 'TheBlock',
    url: 'https://www.theblock.co/rss.xml',
    weight: 1.1,
    tags: ['institutional', 'defi', 'regulation', 'markets']
  },
  {
    name: 'Decrypt',
    url: 'https://decrypt.co/feed',
    weight: 0.9,
    tags: ['nft', 'gaming', 'defi', 'culture']
  },
  {
    name: 'BitcoinMagazine',
    url: 'https://bitcoinmagazine.com/feed',
    weight: 1.0,
    tags: ['bitcoin', 'macro', 'mining']
  }
];

let lastFetchDiagnostics = {
  generatedAt: null,
  sourceCount: SOURCES.length,
  successes: [],
  failures: [],
  totalItems: 0,
  freshItems: 0
};

function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(regex);
  if (!m) return '';
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
  if (!pubDateStr) return true;
  const d = new Date(pubDateStr);
  if (Number.isNaN(d.getTime())) return true;
  const age = Date.now() - d.getTime();
  return age < minutes * 60 * 1000;
}

export async function fetchAllNews(maxAgeMinutes = 60) {
  const results = [];
  const diagnostics = {
    generatedAt: new Date().toISOString(),
    sourceCount: SOURCES.length,
    successes: [],
    failures: [],
    totalItems: 0,
    freshItems: 0
  };

  const promises = SOURCES.map(async (source) => {
    try {
      const xml = await fetchWithTimeout(source.url, 8000);
      const items = parseRSS(xml);
      diagnostics.totalItems += items.length;

      const fresh = items
        .filter(item => isRecent(item.pubDate, maxAgeMinutes))
        .map(item => ({
          source: source.name,
          title: item.title,
          summary: item.summary,
          url: item.link,
          publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          weight: source.weight
        }));

      diagnostics.freshItems += fresh.length;
      diagnostics.successes.push({ source: source.name, total: items.length, fresh: fresh.length });
      results.push(...fresh);
    } catch (err) {
      diagnostics.failures.push({ source: source.name, error: err.message });
      console.warn(`News source ${source.name} fetch failed: ${err.message}`);
    }
  });

  await Promise.allSettled(promises);
  lastFetchDiagnostics = diagnostics;

  return results.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

export function getLastNewsFetchDiagnostics() {
  return lastFetchDiagnostics;
}

export { SOURCES };
