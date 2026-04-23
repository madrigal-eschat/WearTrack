import { Hono } from 'hono';
import { serve } from '@hono/node-server';
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

app.get('/*', (c) => {
  return c.html('<html><body><h1>Weartrack</h1></body></html>', 200);
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Weartrack backend listening on http://localhost:${port}`);
});

export default app;
