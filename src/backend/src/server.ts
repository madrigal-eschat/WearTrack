import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { logging } from './middleware/logging.js';
import { errorHandler } from './middleware/errors.js';
import { router as categoriesRouter } from './controllers/categories.js';
import { router as itemsRouter } from './controllers/items.js';
import { router as sessionsRouter } from './controllers/sessions.js';
import { router as injuriesRouter } from './controllers/injuries.js';
import { router as leaderboardsRouter } from './controllers/leaderboards.js';

const app = new Hono();

app.use('/*', logging());
app.onError(errorHandler());

app.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

app.route('/api/categories', categoriesRouter);
app.route('/api/items', itemsRouter);
app.route('/api/sessions', sessionsRouter);
app.route('/api/injuries', injuriesRouter);
app.route('/api/leaderboards', leaderboardsRouter);

// Serve the built frontend. FRONTEND_DIST must be set in production (Docker).
// Not used in dev — dev-server.ts handles the frontend via Vite middleware.
if (process.env.FRONTEND_DIST) {
  app.use('/*', serveStatic({ root: process.env.FRONTEND_DIST }));
  app.get('/*', serveStatic({ path: `${process.env.FRONTEND_DIST}/index.html` }));
}

export { app };

// Only start the HTTP server when this file is the direct entry point.
// In dev, dev-server.ts starts its own server and imports { app } without triggering this.
const entryFile = process.argv[1] ?? '';
if (entryFile.endsWith('/server.ts') || entryFile.endsWith('/server.js')) {
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Weartrack listening on http://localhost:${port}`);
  });
}
