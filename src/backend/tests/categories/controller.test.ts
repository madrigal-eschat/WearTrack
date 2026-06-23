import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/server.js';
import { runMigrations } from '../../src/db/migrations/index.js';

const BASE = '/api/categories';
const ITEMS = '/api/items';
const SESSIONS = '/api/sessions';

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

beforeAll(() => {
  runMigrations();
});

async function createCategory(overrides = {}) {
  const res = await app.request(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...sampleCategory, ...overrides }),
  });
  return res;
}

describe('POST /api/categories', () => {
  it('creates a category and returns 201', async () => {
    const res = await createCategory({ name: 'Post Test' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Post Test');
    expect(body.icon).toBe('figure.walk');
    expect(Array.isArray(body.risk_levels)).toBe(true);
    expect(body.risk_levels[0].text).toBe('safe');
  });

  it('returns 400 when name is missing', async () => {
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sampleCategory, name: undefined }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when icon is missing', async () => {
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sampleCategory, icon: undefined }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when risk_levels is invalid', async () => {
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sampleCategory, risk_levels: 'not-an-array' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/categories', () => {
  it('returns an array of categories', async () => {
    await createCategory({ name: 'List Test' });
    const res = await app.request(BASE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(Array.isArray(body[0].risk_levels)).toBe(true);
  });
});

describe('GET /api/categories/:id', () => {
  it('returns a single category', async () => {
    const created = await (await createCategory({ name: 'Get Single' })).json();
    const res = await app.request(`${BASE}/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.name).toBe('Get Single');
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request(`${BASE}/99999`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/categories/:id', () => {
  it('updates name only', async () => {
    const created = await (await createCategory({ name: 'Patch Me' })).json();
    const res = await app.request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Patched Name' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Patched Name');
    expect(body.icon).toBe(created.icon);
  });

  it('returns 400 for invalid risk_levels on patch', async () => {
    const created = await (await createCategory({ name: 'Patch Invalid' })).json();
    const res = await app.request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ risk_levels: { not: 'an array' } }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request(`${BASE}/99999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ghost' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/categories/:id', () => {
  it('deletes a category and returns 204', async () => {
    const created = await (await createCategory({ name: 'Delete Me' })).json();
    const res = await app.request(`${BASE}/${created.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    const check = await app.request(`${BASE}/${created.id}`);
    expect(check.status).toBe(404);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request(`${BASE}/99999`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/categories/:id/stats', () => {
  it('returns zeroed stats for a new category with no sessions', async () => {
    const cat = await (await createCategory({ name: 'Empty Stats Cat' })).json();
    const res = await app.request(`${BASE}/${cat.id}/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.category_id).toBe(cat.id);
    expect(body.total_wear_seconds).toBe(0);
    expect(body.session_count).toBe(0);
    expect(body.streak_wear_seconds).toBe(0);
    expect(body.streak_count).toBe(0);
    expect(body.best_streak_wear_seconds).toBe(0);
    expect(body.best_streak_count).toBe(0);
    expect(body.item_count).toBe(0);
  });

  it('reflects aggregated stats and streak after sessions across items', async () => {
    const cat = await (await createCategory({ name: 'Streak Cat' })).json();

    const item1 = await (await app.request(ITEMS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Streak Item A', category_id: cat.id, color: '#aaa' }),
    })).json();

    const item2 = await (await app.request(ITEMS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Streak Item B', category_id: cat.id, color: '#bbb' }),
    })).json();

    // Session on item1
    const s1 = await (await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item1.id }),
    })).json();
    await app.request(`${SESSIONS}/${s1.id}/end`, { method: 'POST' });

    // Session on item2 (same category — should continue streak)
    const s2 = await (await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item2.id }),
    })).json();
    await app.request(`${SESSIONS}/${s2.id}/end`, { method: 'POST' });

    const res = await app.request(`${BASE}/${cat.id}/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_count).toBe(2);
    expect(body.total_wear_seconds).toBeGreaterThan(0);
    expect(body.streak_count).toBe(2);          // both sessions within grace window
    expect(body.best_streak_count).toBe(2);
    expect(body.item_count).toBe(2);
  });

  it('returns 404 for unknown category', async () => {
    const res = await app.request(`${BASE}/99999/stats`);
    expect(res.status).toBe(404);
  });
});
