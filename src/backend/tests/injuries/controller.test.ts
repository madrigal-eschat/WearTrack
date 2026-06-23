import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/server.js';
import { runMigrations } from '../../src/db/migrations/index.js';

const INJURIES = '/api/injuries';
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

let categoryId: number;
let itemId: number;

beforeAll(async () => {
  runMigrations();
  const catRes = await app.request(CATEGORIES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sampleCategory),
  });
  categoryId = (await catRes.json()).id;

  const itemRes = await app.request(ITEMS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Shoe', category_id: categoryId, color: '#ff0000' }),
  });
  itemId = (await itemRes.json()).id;
});

async function createInjury(overrides: Record<string, unknown> = {}) {
  return app.request(INJURIES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId, ...overrides }),
  });
}

async function healInjury(injuryId: number) {
  return app.request(`${INJURIES}/${injuryId}/heal`, { method: 'POST' });
}

describe('POST /api/injuries', () => {
  it('records an injury and returns 201', async () => {
    const res = await createInjury({ wear_seconds: 18000 }); // 5h → moderate severity 2
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.item_id).toBe(itemId);
    expect(body.occurred_at).toBeTypeOf('number');
    expect(body.healed_at).toBeNull();
    expect(body.severity).toBe(2); // 5h is in moderate band

    await healInjury(body.id);
  });

  it('severity defaults to 1 when no wear data', async () => {
    // Create a fresh item with no sessions
    const freshItemRes = await app.request(ITEMS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Fresh Shoe', category_id: categoryId, color: '#00ff00' }),
    });
    const freshItem = await freshItemRes.json();

    const res = await app.request(INJURIES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: freshItem.id }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.severity).toBe(1);

    await healInjury(body.id);
  });

  it('returns 400 when item already has active injury', async () => {
    const first = await (await createInjury({ wear_seconds: 5000 })).json();
    const res = await createInjury({ wear_seconds: 5000 });
    expect(res.status).toBe(400);
    await healInjury(first.id);
  });

  it('returns 400 when item_id is missing', async () => {
    const res = await app.request(INJURIES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when item does not exist', async () => {
    const res = await createInjury({ item_id: 99999 });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/injuries/:id/heal', () => {
  it('heals an injury and sets healed_at', async () => {
    const injury = await (await createInjury({ wear_seconds: 5000 })).json();
    const res = await healInjury(injury.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.healed_at).toBeTypeOf('number');
  });

  it('returns 400 when already healed', async () => {
    const injury = await (await createInjury({ wear_seconds: 5000 })).json();
    await healInjury(injury.id);
    const res = await healInjury(injury.id);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown injury', async () => {
    const res = await healInjury(99999);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/injuries', () => {
  it('returns a list of injuries', async () => {
    const i = await (await createInjury({ wear_seconds: 5000 })).json();
    await healInjury(i.id);
    const res = await app.request(INJURIES);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('filters by item_id', async () => {
    const res = await app.request(`${INJURIES}?item_id=${itemId}`);
    const body = await res.json();
    body.forEach((inj: { item_id: number }) => expect(inj.item_id).toBe(itemId));
  });
});

describe('GET /api/injuries/:id', () => {
  it('returns a single injury', async () => {
    const i = await (await createInjury({ wear_seconds: 5000 })).json();
    await healInjury(i.id);
    const res = await app.request(`${INJURIES}/${i.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(i.id);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request(`${INJURIES}/99999`);
    expect(res.status).toBe(404);
  });
});
