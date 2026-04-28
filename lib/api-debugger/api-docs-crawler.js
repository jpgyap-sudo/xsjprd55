// ============================================================
// API Docs Crawler
// Fetches and caches official API documentation for context
// ============================================================

import crypto from 'crypto';
import { listDocsCache, upsertDocsCache } from './api-debugger-store.js';

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function defaultDocUrls() {
  return [
    { provider: 'kimi', url: 'https://platform.moonshot.ai/docs/api/chat#%E5%9F%BA%E6%9C%AC%E4%BF%A1%E6%81%AF' },
    { provider: 'kimi', url: 'https://platform.moonshot.ai/docs/api/errors' },
    { provider: 'claude', url: 'https://docs.anthropic.com/en/api/getting-started' },
    { provider: 'claude', url: 'https://docs.anthropic.com/en/api/errors' },
    { provider: 'claude', url: 'https://docs.anthropic.com/en/api/rate-limits' }
  ];
}

export async function crawlApiDocs() {
  const urls = defaultDocUrls();
  const results = [];

  for (const item of urls) {
    try {
      const res = await fetch(item.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (!res.ok) {
        results.push({ provider: item.provider, url: item.url, ok: false, error: `HTTP ${res.status}` });
        continue;
      }
      const html = await res.text();
      const text = stripHtml(html);
      const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : item.url;

      const row = await upsertDocsCache({
        provider: item.provider,
        docUrl: item.url,
        contentHash: hash,
        title,
        summary: text.slice(0, 400),
        contentSnippet: text.slice(0, 2000)
      });

      results.push({ provider: item.provider, url: item.url, ok: true, title, hash, id: row?.id });
    } catch (err) {
      results.push({ provider: item.provider, url: item.url, ok: false, error: err.message });
    }
  }

  return results;
}
