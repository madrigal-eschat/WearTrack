import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { logging } from './middleware/logging.js';
import { errorHandler } from './middleware/errors.js';
import { runMigrations } from './db/migrations/index.js';
import { dbExport } from './db/index.js';
import { router as categoriesRouter } from './controllers/categories.js';
import { router as itemsRouter } from './controllers/items.js';
import { router as sessionsRouter } from './controllers/sessions.js';
import { router as injuriesRouter } from './controllers/injuries.js';
import { router as leaderboardsRouter } from './controllers/leaderboards.js';
import { router as notificationsRouter } from './controllers/notifications.js';
import { startScheduler } from './notifications/runner.js';
import { startEventsPoller } from './events/poller.js';

runMigrations();
startScheduler();
startEventsPoller();

const app = new Hono();

app.use('/*', logging());
app.onError(errorHandler());

app.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

app.get('/api/version', (c) => {
  const version = process.env.COMMIT_HASH || 'unknown';
  return c.json({ version });
});

if (process.env.NODE_ENV !== 'production' || process.env.E2E_TEST === '1') {
  app.post('/api/__reset', (c) => {
    dbExport.exec(`
      DELETE FROM sessions;
      DELETE FROM injuries;
      DELETE FROM stats;
      DELETE FROM category_stats;
      DELETE FROM session_day_index;
      DELETE FROM items;
      DELETE FROM categories;
      DELETE FROM push_subscriptions;
      DELETE FROM event_poller_state;
    `);
    return c.json({ ok: true });
  });
}

app.route('/api/categories', categoriesRouter);
app.route('/api/items', itemsRouter);
app.route('/api/sessions', sessionsRouter);
app.route('/api/injuries', injuriesRouter);
app.route('/api/leaderboards', leaderboardsRouter);
app.route('/api/notifications', notificationsRouter);

if (process.env.FRONTEND_DIST) {
  // Content-hashed bundles are immutable; everything else (index.html, sw.js, manifest) must revalidate.
  app.use('/*', async (c, next) => {
    await next();
    c.res.headers.set(
      'Cache-Control',
      c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
  });
  app.use('/*', serveStatic({ root: process.env.FRONTEND_DIST }));
  app.get('/*', serveStatic({ path: `${process.env.FRONTEND_DIST}/index.html` }));
}

export { app };
export default app;

const entryFile = process.argv[1] ?? '';
if (entryFile.endsWith('/server.ts') || entryFile.endsWith('/server.js')) {
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Weartrack listening on http://localhost:${port}`);
  });
}
