import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/server.js';
import { runMigrations } from '../../src/db/migrations/index.js';

const BASE = '/api/items';
const SESSIONS = '/api/sessions';
const CATEGORIES_BASE = '/api/categories';

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

let categoryId: number;

beforeAll(async () => {
  runMigrations();
  const res = await app.request(CATEGORIES_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sampleCategory),
  });
  const cat = await res.json();
  categoryId = cat.id;
});

async function createItem(overrides: Record<string, unknown> = {}) {
  return app.request(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Shoe', category_id: categoryId, color: '#ff0000', ...overrides }),
  });
}

describe('POST /api/items', () => {
  it('creates an item and returns 201', async () => {
    const res = await createItem({ name: 'Running Shoe' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Running Shoe');
    expect(body.category_id).toBe(categoryId);
    expect(body.color).toBe('#ff0000');
    expect(body.difficulty_multiplier).toBe(1.0);
  });

  it('returns 400 when name is missing', async () => {
    const res = await createItem({ name: undefined });
    expect(res.status).toBe(400);
  });

  it('returns 400 when category_id is missing', async () => {
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Cat' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when color is missing', async () => {
    const res = await createItem({ color: undefined });
    expect(res.status).toBe(400);
  });

  it('returns 400 when category does not exist', async () => {
    const res = await createItem({ category_id: 99999 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/items', () => {
  it('returns an array of items', async () => {
    await createItem({ name: 'List Item' });
    const res = await app.request(BASE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('filters by category_id query param', async () => {
    const res = await app.request(`${BASE}?category_id=${categoryId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    body.forEach((item: { category_id: number }) => {
      expect(item.category_id).toBe(categoryId);
    });
  });
});

describe('GET /api/items/:id', () => {
  it('returns a single item', async () => {
    const created = await (await createItem({ name: 'Single Item' })).json();
    const res = await app.request(`${BASE}/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.name).toBe('Single Item');
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request(`${BASE}/99999`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/items/:id', () => {
  it('updates name', async () => {
    const created = await (await createItem({ name: 'Patchable' })).json();
    const res = await app.request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Patched' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Patched');
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

describe('DELETE /api/items/:id', () => {
  it('deletes an item and returns 204', async () => {
    const created = await (await createItem({ name: 'Delete Me' })).json();
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

describe('GET /api/items/:id/stats', () => {
  it('returns zeroed stats for an item with no sessions', async () => {
    const item = await (await createItem({ name: 'No Sessions' })).json();
    const res = await app.request(`${BASE}/${item.id}/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item_id).toBe(item.id);
    expect(body.total_wear_seconds).toBe(0);
    expect(body.session_count).toBe(0);
    expect(body.max_single_session_wear_seconds).toBe(0);
    // No streak fields — streaks are per-category
    expect((body as Record<string, unknown>).streak_wear_seconds).toBeUndefined();
  });

  it('reflects stats after a completed session', async () => {
    const item = await (await createItem({ name: 'Stats Item' })).json();
    const startTs = Math.floor(Date.now() / 1000) - 3600;
    const s = await (await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, started_at: startTs }),
    })).json();
    await app.request(`${SESSIONS}/${s.id}/end`, { method: 'POST' });

    const res = await app.request(`${BASE}/${item.id}/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_count).toBe(1);
    expect(body.total_wear_seconds).toBeGreaterThan(0);
    expect(body.max_single_session_wear_seconds).toBeGreaterThan(0);
  });

  it('returns 404 for unknown item', async () => {
    const res = await app.request(`${BASE}/99999/stats`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/items/:id/stats/history', () => {
  it('returns monthly time-series', async () => {
    const item = await (await createItem({ name: 'History Item' })).json();
    const s = await (await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id }),
    })).json();
    await app.request(`${SESSIONS}/${s.id}/end`, { method: 'POST' });

    const res = await app.request(`${BASE}/${item.id}/stats/history?unit=month`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    if (body.length > 0) {
      expect(body[0].period).toMatch(/^\d{4}-\d{2}$/);
      expect(typeof body[0].total_wear_seconds).toBe('number');
      expect(typeof body[0].session_count).toBe('number');
    }
  });

  it('returns weekly time-series', async () => {
    const item = await (await createItem({ name: 'History Item Weekly' })).json();
    const res = await app.request(`${BASE}/${item.id}/stats/history?unit=week`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('returns 400 for invalid unit', async () => {
    const item = await (await createItem({ name: 'History Bad Unit' })).json();
    const res = await app.request(`${BASE}/${item.id}/stats/history?unit=day`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown item', async () => {
    const res = await app.request(`${BASE}/99999/stats/history`);
    expect(res.status).toBe(404);
  });
});
