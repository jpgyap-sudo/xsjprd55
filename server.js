// ============================================================
// VPS Server Entry Point — xsjprd55
// Express server for Digital Ocean VPS deployment.
// Serves public/ static files and routes /api/* to handlers.
// ============================================================

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// ── Auth middleware for admin/cron endpoints ───────────────
// Endpoints that trigger scans, learning loops, or mutations
// require either x-cron-secret header or ?secret= query param.
const CRON_SECRET = process.env.CRON_SECRET;
const PROTECTED_ROUTES = new Set([
  'signal',      // GET auto-scan
  'market',      // GET auto-fetch
  'weekly-analysis', // GET weekly report
  'bot',         // type=learn, type=ingest-news
  'news-signal', // GET news scan
  'learning',    // GET learning loop
]);

function requireSecret(req, res, next) {
  const routeName = req.path.split('/')[2]; // /api/NAME
  if (!PROTECTED_ROUTES.has(routeName)) {
    return next();
  }

  // Skip auth for manual POST requests on signal/market
  if (req.method === 'POST' && ['signal', 'market'].includes(routeName)) {
    return next();
  }

  if (!CRON_SECRET) {
    console.warn(`[auth] CRON_SECRET not set — ${req.path} is unprotected`);
    return next();
  }

  const headerSecret = req.headers['x-cron-secret'];
  const querySecret  = req.query?.secret;
  const bodySecret   = req.body?.secret;
  const provided     = headerSecret || querySecret || bodySecret;

  if (provided !== CRON_SECRET) {
    console.warn(`[auth] rejected ${req.method} ${req.path} — invalid secret`);
    return res.status(401).json({ error: 'Unauthorized — provide x-cron-secret header or ?secret=' });
  }

  next();
}

app.use('/api', requireSecret);

// ── Static files (dashboard) ───────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routing ────────────────────────────────────────────
const apiDir = path.join(__dirname, 'api');

async function loadHandler(routeName) {
  const filePath = path.join(apiDir, `${routeName}.js`);
  if (!fs.existsSync(filePath)) return null;
  const mod = await import(filePath);
  return mod.default || null;
}

// Auto-discover API routes
const apiFiles = fs.readdirSync(apiDir).filter((f) => f.endsWith('.js'));
for (const file of apiFiles) {
  const routeName = file.replace(/\.js$/, '');
  const routePath = `/api/${routeName}`;

  app.all(routePath, async (req, res) => {
    try {
      const handler = await loadHandler(routeName);
      if (!handler) {
        return res.status(404).json({ error: 'Handler not found' });
      }
      await handler(req, res);
    } catch (e) {
      console.error(`[server] Error in ${routePath}:`, e);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error', message: e.message });
      }
    }
  });
}

// Health check at root (optional)
app.get('/api', (req, res) => {
  res.json({ ok: true, routes: apiFiles.map((f) => f.replace(/\.js$/, '')) });
});

// Fallback to index.html for SPA behavior
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] xsjprd55 running on port ${PORT}`);
  console.log(`[server] API routes:`, apiFiles.map((f) => f.replace(/\.js$/, '')));
});
