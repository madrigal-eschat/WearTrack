import { Hono } from 'hono';
import { notificationStore } from '../notifications/store.js';
import { getPublicKey } from '../notifications/sender.js';
import { ValidationError } from '../middleware/errors.js';

export const router = new Hono();

router.get('/vapid-public-key', (c) => {
  return c.json({ publicKey: getPublicKey() });
});

router.post('/subscribe', async (c) => {
  const body = await c.req.json();
  if (typeof body.endpoint !== 'string' || !body.keys) {
    throw new ValidationError('Invalid push subscription');
  }
  notificationStore.upsertSubscription(JSON.stringify(body));
  return c.json({ ok: true });
});

router.delete('/subscribe', (c) => {
  notificationStore.deleteSubscription();
  return c.json({ ok: true });
});
