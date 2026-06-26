import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/server.js';
import { runMigrations } from '../../src/db/migrations/index.js';

beforeAll(() => {
  runMigrations();
});

const NOTIFICATIONS = '/api/notifications';

describe('GET /api/notifications/vapid-public-key', () => {
  it('returns publicKey field', async () => {
    const res = await app.request(`${NOTIFICATIONS}/vapid-public-key`);
    expect(res.status).toBe(200);
    const body = await res.json() as { publicKey: string | null };
    expect('publicKey' in body).toBe(true);
    // In test env VAPID vars are not set, so null is expected
    expect(body.publicKey).toBeNull();
  });
});

describe('POST /api/notifications/subscribe', () => {
  it('stores a subscription and returns 200', async () => {
    const sub = {
      endpoint: 'https://push.example.com/test',
      keys: { p256dh: 'fake-p256dh', auth: 'fake-auth' },
    };
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    expect(res.status).toBe(200);
  });

  it('replaces existing subscription on re-subscribe', async () => {
    const sub1 = { endpoint: 'https://push.example.com/first', keys: { p256dh: 'a', auth: 'b' } };
    const sub2 = { endpoint: 'https://push.example.com/second', keys: { p256dh: 'c', auth: 'd' } };
    await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub1),
    });
    await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub2),
    });
    // Verify second subscription is stored (not first)
    const { prepare } = await import('../../src/db/index.js');
    const row = prepare('SELECT subscription_json FROM push_subscriptions').get() as
      { subscription_json: string } | undefined;
    expect(row).toBeDefined();
    expect(JSON.parse(row!.subscription_json).endpoint).toBe('https://push.example.com/second');
  });

  it('returns 400 when body is missing endpoint', async () => {
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: { p256dh: 'x', auth: 'y' } }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is missing keys.p256dh', async () => {
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example.com/x', keys: { auth: 'y' } }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is missing keys.auth', async () => {
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example.com/x', keys: { p256dh: 'x' } }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/notifications/subscribe', () => {
  it('removes the subscription and returns 200', async () => {
    // First subscribe
    await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://example.com', keys: { p256dh: 'x', auth: 'y' } }),
    });
    // Then unsubscribe
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    // Verify gone
    const { prepare } = await import('../../src/db/index.js');
    const row = prepare('SELECT * FROM push_subscriptions').get();
    expect(row).toBeUndefined();
  });

  it('returns 200 when nothing is subscribed (idempotent delete)', async () => {
    // Ensure there's no subscription by clearing first
    const { prepare } = await import('../../src/db/index.js');
    prepare('DELETE FROM push_subscriptions').run();

    const res = await app.request(`${NOTIFICATIONS}/subscribe`, { method: 'DELETE' });
    expect(res.status).toBe(200);
  });
});
