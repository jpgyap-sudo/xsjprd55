// ============================================================
// VPS Server Entry Point — xsjprd55
// Express server for Digital Ocean VPS deployment.
// Serves public/ static files and routes /api/* to handlers.
// ============================================================

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
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
  'signals',     // active signal scan/generation
  'market',      // GET auto-fetch
  'weekly-analysis', // GET weekly report
  'bot',         // type=learn, type=ingest-news
  'news-ingest', // RSS/news ingestion
  'news-signal', // GET news scan
  'learning',    // GET learning loop
]);

function requireSecret(req, res, next) {
  const routeName = req.path.split('/')[2]; // /api/NAME
  if (!PROTECTED_ROUTES.has(routeName)) {
    return next();
  }

  // Skip auth for manual POST requests on market only.
  // Signal scan routes protect mutations in their handlers.
  if (req.method === 'POST' && ['market'].includes(routeName)) {
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

async function loadHandler(routePath) {
  if (!fs.existsSync(routePath)) return null;
  const mod = await import(pathToFileURL(routePath).href);
  return mod.default || null;
}

function discoverRoutes(dir, prefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const routes = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      routes.push(...discoverRoutes(fullPath, `${prefix}/${entry.name}`));
    } else if (entry.name.endsWith('.js')) {
      const name = entry.name.replace(/\.js$/, '');
      routes.push({ route: `/api${prefix}/${name}`, file: fullPath });
    }
  }
  return routes;
}

// Auto-discover API routes (flat + nested)
const apiRoutes = discoverRoutes(apiDir);
for (const { route, file } of apiRoutes) {
  app.all(route, async (req, res) => {
    try {
      const handler = await loadHandler(file);
      if (!handler) {
        return res.status(404).json({ error: 'Handler not found' });
      }
      await handler(req, res);
    } catch (e) {
      console.error(`[server] Error in ${route}:`, e);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error', message: e.message });
      }
    }
  });
}

// Health check at root (optional)
app.get('/api', (req, res) => {
  res.json({ ok: true, routes: apiRoutes.map((r) => r.route) });
});

// Fallback to index.html for SPA behavior
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] xsjprd55 running on port ${PORT}`);
  console.log(`[server] API routes:`, apiRoutes.map((r) => r.route));
});
