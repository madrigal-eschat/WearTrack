import { Hono } from 'hono';
import { logging } from './middleware/logging.js';
import { errorHandler } from './middleware/errors.js';
import { router as categoriesRouter } from './categories/router.js';
import { router as itemsRouter } from './items/router.js';
import { router as sessionsRouter } from './sessions/router.js';
import { router as injuriesRouter } from './injuries/router.js';
import { router as statsRouter } from './stats/router.js';

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
app.route('/api/stats', statsRouter);

app.get('/*', (c) => {
  return c.html('<html><body><h1>Weartrack</h1></body></html>', 200);
});

export default app;
