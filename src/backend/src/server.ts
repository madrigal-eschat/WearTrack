import { Hono } from 'hono';
import { logging } from './middleware/logging.js';
import { errorHandler } from './middleware/errors.js';
import { router as categoriesRouter } from './categories/router.js';
import { router as itemsRouter } from './items/router.js';

const app = new Hono();

app.use('/*', logging());
app.onError(errorHandler());

app.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

app.route('/api/categories', categoriesRouter);
app.route('/api/items', itemsRouter);

app.get('/*', (c) => {
  return c.html('<html><body><h1>Weartrack</h1></body></html>', 200);
});

export default app;
