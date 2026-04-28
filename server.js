// ============================================================
// VPS Server Entry Point — xsjprd55
// Express server for Digital Ocean VPS deployment.
// Serves public/ static files and routes /api/* to handlers.
// ============================================================

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

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
