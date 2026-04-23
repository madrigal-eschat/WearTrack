/**
 * Development-only entry point.
 * Runs the Hono API and Vite dev server (with HMR) on a single port.
 * Uses Vite's documented middleware-mode pattern: assets go through Vite's
 * connect stack; all other non-API routes get the transformed index.html.
 * Never imported or used in production.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { getRequestListener } from '@hono/node-server';
import { app } from './server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(__dirname, '../../frontend');

const vite = await createViteServer({
  root: frontendRoot,
  base: '/',
  server: { middlewareMode: true },
  appType: 'custom', // we handle the SPA fallback ourselves below
});

const honoHandler = getRequestListener(app.fetch);

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/';

  // ── API: Hono handles it ─────────────────────────────────────────────────
  if (url.startsWith('/api')) {
    honoHandler(req, res);
    return;
  }

  // ── Static assets / HMR / Vite internals: let Vite's connect stack run ──
  // Anything with a file extension, or Vite's own /@vite/ /@fs/ paths
  const isViteAsset = url.startsWith('/@') || url.startsWith('/node_modules') || /\.[a-z0-9]+(\?.*)?$/i.test(url.split('?')[0]);

  if (isViteAsset) {
    vite.middlewares.handle(req, res, (err?: unknown) => {
      if (err) { res.statusCode = 500; res.end(String(err)); }
      else     { res.statusCode = 404; res.end('Not found'); }
    });
    return;
  }

  // ── SPA fallback: serve transformed index.html for all app routes ────────
  try {
    const raw = await readFile(resolve(frontendRoot, 'index.html'), 'utf-8');
    const html = await vite.transformIndexHtml(url, raw);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  } catch (e) {
    vite.ssrFixStacktrace(e as Error);
    res.statusCode = 500;
    res.end(String(e));
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Weartrack dev server → http://localhost:${port}`);
});
