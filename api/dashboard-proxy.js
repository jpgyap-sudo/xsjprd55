// ============================================================
// Dashboard Proxy — /api/dashboard-proxy
// Proxies requests to protected API routes with CRON_SECRET
// so the frontend doesn't need to know the secret.
// ============================================================

const PROTECTED_ENDPOINTS = [
  'signals',
  'market',
  'weekly-analysis',
  'bot',
  'news-ingest',
  'news-signal',
  'learning',
  'perpetual-trader',
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const target = req.query.target;
  if (!target || !PROTECTED_ENDPOINTS.includes(target)) {
    return res.status(400).json({
      ok: false,
      error: `Invalid or missing target. Valid targets: ${PROTECTED_ENDPOINTS.join(', ')}`
    });
  }

  const CRON_SECRET = process.env.CRON_SECRET;
  if (!CRON_SECRET) {
    return res.status(200).json({
      ok: false,
      error: 'CRON_SECRET not configured on server',
      target,
      note: 'Set CRON_SECRET environment variable to enable protected endpoints'
    });
  }

  try {
    const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
    const fetchUrl = `${baseUrl}/api/${target}?secret=${encodeURIComponent(CRON_SECRET)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(fetchUrl, {
      headers: {
        'x-cron-secret': CRON_SECRET,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    let data;
    try {
      data = await response.json();
    } catch {
      data = { ok: false, error: 'Invalid JSON response from target' };
    }

    return res.status(200).json({
      ok: true,
      target,
      data,
      ts: new Date().toISOString()
    });
  } catch (e) {
    console.error(`[dashboard-proxy] Error proxying to ${target}:`, e.message);
    return res.status(200).json({
      ok: false,
      target,
      error: e.message,
      note: 'Protected endpoint unavailable'
    });
  }
}
