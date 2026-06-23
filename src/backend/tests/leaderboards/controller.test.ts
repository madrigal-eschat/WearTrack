import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/server.js';
import { runMigrations } from '../../src/db/migrations/index.js';

const LEADERBOARDS = '/api/leaderboards';
const SESSIONS = '/api/sessions';
const ITEMS = '/api/items';
const CATEGORIES = '/api/categories';

const sampleCategory = {
  name: 'Footwear',
  icon: 'figure.walk',
  initial_target_wear_duration_seconds: 900,
  initial_max_wear_duration_seconds: 1800,
  rest_multiplier: 6,
  minimum_rest: 86400,
  risk_levels: [
    { lower: null, upper: 14400, text: 'safe', severity: 1 },
    { lower: 14400, upper: 28800, text: 'moderate', severity: 2 },
    { lower: 28800, upper: null, text: 'high', severity: 3 },
  ],
  break_decay_multiplier: 0.91,
  break_grace_time: 86400,
};

beforeAll(async () => {
  runMigrations();
  const catRes = await app.request(CATEGORIES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sampleCategory),
  });
  const categoryId = (await catRes.json()).id;

  const itemRes = await app.request(ITEMS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Leaderboard Shoe', category_id: categoryId, color: '#0000ff' }),
  });
  const itemId = (await itemRes.json()).id;

  // Complete a session so leaderboard tables have data
  const s = await (await app.request(`${SESSIONS}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId }),
  })).json();
  await app.request(`${SESSIONS}/${s.id}/end`, { method: 'POST' });
});

describe('GET /api/leaderboards/longest-wear', () => {
  it('returns 200 with an array', async () => {
    const res = await app.request(`${LEADERBOARDS}/longest-wear`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('entries have expected shape', async () => {
    const res = await app.request(`${LEADERBOARDS}/longest-wear`);
    const body = await res.json() as { item_id: number; item_name: string; category_name: string; score: number }[];
    if (body.length > 0) {
      expect(typeof body[0].item_id).toBe('number');
      expect(typeof body[0].item_name).toBe('string');
      expect(typeof body[0].category_name).toBe('string');
      expect(typeof body[0].score).toBe('number');
    }
  });
});

describe('GET /api/leaderboards/most-total-wear', () => {
  it('returns 200 with an array', async () => {
    const res = await app.request(`${LEADERBOARDS}/most-total-wear`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

describe('GET /api/leaderboards/best-streak', () => {
  it('returns 200 with an array', async () => {
    const res = await app.request(`${LEADERBOARDS}/best-streak`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('entries reference categories not items', async () => {
    const res = await app.request(`${LEADERBOARDS}/best-streak`);
    const body = await res.json() as { category_id: number; category_name: string; score: number; streak_sessions: number }[];
    if (body.length > 0) {
      expect(typeof body[0].category_id).toBe('number');
      expect(typeof body[0].category_name).toBe('string');
      expect(typeof body[0].score).toBe('number');
      expect(typeof body[0].streak_sessions).toBe('number');
      // Should NOT have item_id
      expect((body[0] as Record<string, unknown>).item_id).toBeUndefined();
    }
  });
});

describe('GET /api/leaderboards/most-sessions', () => {
  it('returns 200 with an array', async () => {
    const res = await app.request(`${LEADERBOARDS}/most-sessions`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

describe('unknown leaderboard routes', () => {
  // Explicit routes mean the server falls through to the SPA catch-all (200)
  // rather than returning a 400 validation error as the old /:type param did.
  it('does not return a 400 validation error for an unrecognised path', async () => {
    const res = await app.request(`${LEADERBOARDS}/unknown-type`);
    expect(res.status).not.toBe(400);
  });
});
