import { Hono } from 'hono';
import { logging } from './middleware/logging.js';
import { errorHandler } from './middleware/errors.js';

const app = new Hono();

app.use('/*', logging());
app.use('/*', errorHandler());

app.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

app.get('/*', (c) => {
  return c.html('<html><body><h1>Weartrack</h1></body></html>', 200);
});

export default app;
