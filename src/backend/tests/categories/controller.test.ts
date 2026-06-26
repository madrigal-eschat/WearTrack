import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/server.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { sampleCategory, createCategory } from '../fixtures.js';

const BASE = '/api/categories';
const ITEMS = '/api/items';
const SESSIONS = '/api/sessions';

beforeAll(() => {
  runMigrations();
});

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

  it('returns 400 when rest_multiplier is missing', async () => {
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sampleCategory, rest_multiplier: undefined }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when minimum_rest is missing', async () => {
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sampleCategory, minimum_rest: undefined }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when break_decay_multiplier is missing', async () => {
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sampleCategory, break_decay_multiplier: undefined }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when break_grace_time is missing', async () => {
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sampleCategory, break_grace_time: undefined }),
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

  it('patches icon', async () => {
    const created = await (await createCategory({ name: 'Icon Patch' })).json();
    const res = await app.request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icon: 'figure.run' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.icon).toBe('figure.run');
    expect(body.name).toBe('Icon Patch');
  });

  it('patches break_decay_multiplier', async () => {
    const created = await (await createCategory({ name: 'Decay Patch' })).json();
    const res = await app.request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ break_decay_multiplier: 0.75 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.break_decay_multiplier).toBe(0.75);
  });

  it('empty-body PATCH returns existing category unchanged (200)', async () => {
    const created = await (await createCategory({ name: 'Empty Patch' })).json();
    const res = await app.request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Empty Patch');
    expect(body.icon).toBe(created.icon);
    expect(body.rest_multiplier).toBe(created.rest_multiplier);
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

  it('cascade deletes items when category is deleted', async () => {
    const cat = await (await createCategory({ name: 'Cascade Cat' })).json();
    // Create two items under this category
    const item1 = await (await app.request(ITEMS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cascade Item A', category_id: cat.id, color: '#111111' }),
    })).json();
    const item2 = await (await app.request(ITEMS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cascade Item B', category_id: cat.id, color: '#222222' }),
    })).json();

    // Delete the category
    const delRes = await app.request(`${BASE}/${cat.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    // Items should also be gone
    const check1 = await app.request(`${ITEMS}/${item1.id}`);
    expect(check1.status).toBe(404);
    const check2 = await app.request(`${ITEMS}/${item2.id}`);
    expect(check2.status).toBe(404);
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

    // Session on item1 (started 2h ago to ensure non-zero wear duration)
    const now = Math.floor(Date.now() / 1000);
    const s1 = await (await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item1.id, started_at: now - 7200 }),
    })).json();
    await app.request(`${SESSIONS}/${s1.id}/end`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ended_at: now - 3600 }) });

    // Session on item2 (same category — should continue streak)
    const s2 = await (await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item2.id, started_at: now - 1800 }),
    })).json();
    await app.request(`${SESSIONS}/${s2.id}/end`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ended_at: now - 900 }) });

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

describe('target/max validation', () => {
  it('accepts a null maximum', async () => {
    const res = await createCategory({ name: 'NoMax', initial_max_wear_duration_seconds: null });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.initial_max_wear_duration_seconds).toBeNull();
  });

  it('rejects a non-number, non-null maximum', async () => {
    const res = await createCategory({ initial_max_wear_duration_seconds: 'nope' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing target', async () => {
    const res = await createCategory({ initial_target_wear_duration_seconds: undefined });
    expect(res.status).toBe(400);
  });

  it('patches break_grace_time and minimum_rest', async () => {
    const created = await (await createCategory({ name: 'Patchable' })).json();
    const res = await app.request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ break_grace_time: 3600, minimum_rest: 1200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.break_grace_time).toBe(3600);
    expect(body.minimum_rest).toBe(1200);
  });
});
