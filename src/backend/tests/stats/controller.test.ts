import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/server.js';
import runMigration from '../../src/db/migrations/001_initial.js';

const STATS = '/api/stats';
const SESSIONS = '/api/sessions';
const ITEMS = '/api/items';
const CATEGORIES = '/api/categories';

const sampleCategory = {
  name: 'Footwear',
  icon: 'figure.walk',
  initial_wear: 900,
  rest_multiplier: 6,
  rest_constant: 86400,
  risk_levels: [
    { lower: null, upper: 14400, text: 'safe', severity: 1 },
    { lower: 14400, upper: 28800, text: 'moderate', severity: 2 },
    { lower: 28800, upper: null, text: 'high', severity: 3 },
  ],
  break_decay_multiplier: 0.75,
  break_penalty_period: 168,
};

let itemId: number;

beforeAll(async () => {
  runMigration();
  const catRes = await app.request(CATEGORIES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sampleCategory),
  });
  const categoryId = (await catRes.json()).id;

  const itemRes = await app.request(ITEMS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Stats Shoe', category_id: categoryId, color: '#0000ff' }),
  });
  itemId = (await itemRes.json()).id;

  // Complete a session to have some data
  const s = await (await app.request(`${SESSIONS}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId }),
  })).json();
  await app.request(`${SESSIONS}/${s.id}/end`, { method: 'POST' });
});

describe('GET /api/stats/:item_id', () => {
  it('returns cumulative stats for an item', async () => {
    const res = await app.request(`${STATS}/${itemId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item_id).toBe(itemId);
    expect(body.session_count).toBeGreaterThan(0);
    expect(body.total_wear).toBeGreaterThan(0);
    expect(body.max_wear).toBeGreaterThan(0);
    expect(typeof body.streak_wear).toBe('number');
    expect(typeof body.best_streak_wear).toBe('number');
  });

  it('returns 404 for unknown item', async () => {
    const res = await app.request(`${STATS}/99999`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/stats/:item_id/history', () => {
  it('returns monthly time-series', async () => {
    const res = await app.request(`${STATS}/${itemId}/history?unit=month`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    if (body.length > 0) {
      expect(body[0].period).toMatch(/^\d{4}-\d{2}$/);
      expect(typeof body[0].total_wear).toBe('number');
      expect(typeof body[0].session_count).toBe('number');
    }
  });

  it('returns weekly time-series', async () => {
    const res = await app.request(`${STATS}/${itemId}/history?unit=week`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 400 for invalid unit', async () => {
    const res = await app.request(`${STATS}/${itemId}/history?unit=day`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown item', async () => {
    const res = await app.request(`${STATS}/99999/history`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/stats/leaderboard/:type', () => {
  const types = ['longest-wear', 'most-total-wear', 'best-streak', 'most-sessions'];

  it.each(types)('returns leaderboard for %s', async (type) => {
    const res = await app.request(`${STATS}/leaderboard/${type}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 400 for unknown type', async () => {
    const res = await app.request(`${STATS}/leaderboard/unknown-type`);
    expect(res.status).toBe(400);
  });
});
