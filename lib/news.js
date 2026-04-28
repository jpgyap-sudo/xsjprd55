// ============================================================
// News Aggregator — CryptoPanic + RSS feeds
// No API key required for basic CryptoPanic public feed.
// ============================================================

const CRYPTOPANIC_URL = 'https://cryptopanic.com/api/v1/posts/';
const RSS_FEEDS = [
  'https://www.coindesk.com/arc/outboundfeeds/rss-all-articles/',
  'https://cointelegraph.com/rss'
];

// In-memory cache (lasts one serverless invocation)
let cache = { news: null, fetchedAt: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── CryptoPanic (JSON, easiest) ─────────────────────────────
export async function fetchCryptoPanicNews(opts = {}) {
  const { filter = 'hot', limit = 20, currencies } = opts;
  const params = new URLSearchParams({ public: 'true', filter });
  if (limit) params.set('limit', String(limit));
  if (currencies) params.set('currencies', currencies);

  const res = await fetch(`${CRYPTOPANIC_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`CryptoPanic ${res.status}`);
  const json = await res.json();
  return (json.results || []).map(r => ({
    source: 'cryptopanic',
    title: r.title,
    url: r.url,
    publishedAt: r.published_at,
    currencies: (r.currencies || []).map(c => c.code),
    kind: r.kind // 'news' | 'media'
  }));
}

// ── RSS fallback (lightweight regex parser) ─────────────────
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>[\s\S]*?<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const itemXml = m[0];
    const title = (itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]?.trim() || '';
    const link = (itemXml.match(/<link>([\s\S]*?)<\/link>/) || [])[1]?.trim() || '';
    const pubDate = (itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]?.trim() || '';
    if (title) {
      items.push({ source: 'rss', title, url: link, publishedAt: pubDate, currencies: [], kind: 'news' });
    }
  }
  return items;
}

export async function fetchRSSFeeds() {
  const all = [];
  for (const url of RSS_FEEDS) {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/rss+xml' } });
      if (!res.ok) continue;
      const xml = await res.text();
      all.push(...parseRSS(xml));
    } catch (e) {
      console.error(`[RSS] failed ${url}:`, e.message);
    }
  }
  return all;
}

// ── Unified fetch with cache ────────────────────────────────
export async function fetchAllNews(opts = {}) {
  const now = Date.now();
  if (cache.news && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.news;
  }

  const [cp, rss] = await Promise.allSettled([
    fetchCryptoPanicNews(opts),
    fetchRSSFeeds()
  ]);

  const news = [
    ...(cp.status === 'fulfilled' ? cp.value : []),
    ...(rss.status === 'fulfilled' ? rss.value : [])
  ];

  // Deduplicate by URL
  const seen = new Set();
  const deduped = news.filter(n => {
    if (seen.has(n.url)) return false;
    seen.add(n.url);
    return true;
  });

  cache = { news: deduped, fetchedAt: now };
  return deduped;
}

// ── Search news by keyword or symbol ────────────────────────
export async function searchNews(query, opts = {}) {
  const news = await fetchAllNews(opts);
  const q = query.toLowerCase();
  return news.filter(n => {
    const text = (n.title + ' ' + (n.currencies?.join(' ') || '')).toLowerCase();
    return text.includes(q);
  }).slice(0, opts.limit || 5);
}

// ── Format news for Telegram ────────────────────────────────
export function formatNews(items) {
  if (!items.length) return '📭 No news found.';
  return items.map((n, i) => `${i + 1}. *${escapeMd(n.title)}*\n   ${n.url}`).join('\n\n');
}

function escapeMd(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
