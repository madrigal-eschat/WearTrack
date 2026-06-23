import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/server.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { prepare } from '../../src/db/index.js';

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

async function startSession(overrides: Record<string, unknown> = {}) {
  return app.request(`${SESSIONS}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId, ...overrides }),
  });
}

async function endSession(sessionId: number, body: Record<string, unknown> = {}) {
  return app.request(`${SESSIONS}/${sessionId}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/sessions/current expected durations', () => {
  it('returns expected_target/expected_max for an idle item (first session)', async () => {
    // sampleCategory: target 900, max 1800; Test Shoe difficulty 1; idle
    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === categoryId);
    const ourItem = entry.items.find((i: { item_id: number }) => i.item_id === itemId);
    expect(ourItem.expected_target).toBe(900);
    expect(ourItem.expected_max).toBe(1800);
  });
});

describe('POST /api/sessions/start', () => {
  it('starts a session and returns 201', async () => {
    const res = await startSession();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.item_id).toBe(itemId);
    expect(body.started_at).toBeTypeOf('number');
    expect(body.ended_at).toBeNull();
    expect(body.target_wear_seconds).toBeTypeOf('number');
    expect(body.max_wear_seconds).toBeTypeOf('number');

    await endSession(body.id);
  });

  it('accepts an explicit started_at timestamp', async () => {
    const ts = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const res = await startSession({ started_at: ts });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.started_at).toBe(ts);
    await endSession(body.id);
  });

  it('returns 400 when item_id is missing', async () => {
    const res = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when started_at is not a number', async () => {
    const res = await startSession({ started_at: 'yesterday' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when item does not exist', async () => {
    const res = await startSession({ item_id: 99999 });
    expect(res.status).toBe(404);
  });

  it('returns 409 when the category already has an open session on the same item', async () => {
    const s1 = await (await startSession()).json();
    const res = await startSession();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.conflicting_item).toBeDefined();
    expect(body.conflicting_item.id).toBe(itemId);
    await endSession(s1.id);
  });

  it('returns 409 when the category already has an open session on a different item', async () => {
    const item2Res = await app.request(ITEMS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Second Shoe', category_id: categoryId, color: '#0000ff' }),
    });
    const item2 = await item2Res.json();

    const s1 = await (await startSession()).json();
    const res = await startSession({ item_id: item2.id });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.conflicting_item.id).toBe(itemId);
    expect(body.conflicting_item.name).toBe('Test Shoe');
    await endSession(s1.id);
  });
});

describe('POST /api/sessions/:id/end', () => {
  it('ends a session, leaves target/max unchanged, and sets rest_seconds', async () => {
    const started = await (await startSession()).json();
    const res = await endSession(started.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ended_at).toBeTypeOf('number');
    expect(body.target_wear_seconds).toBe(started.target_wear_seconds);
    expect(body.max_wear_seconds).toBe(started.max_wear_seconds);
    expect(body.rest_seconds).toBeTypeOf('number');
    expect(body.rest_seconds).toBeGreaterThan(0);
  });

  it('accepts an explicit ended_at timestamp', async () => {
    const startTs = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
    const endTs = Math.floor(Date.now() / 1000) - 3600;   // 1 hour ago
    const started = await (await startSession({ started_at: startTs })).json();
    const res = await endSession(started.id, { ended_at: endTs });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ended_at).toBe(endTs);
    expect(body.rest_seconds).toBe(86400);
  });

  it('returns 400 when ended_at is not a number', async () => {
    const started = await (await startSession()).json();
    const res = await endSession(started.id, { ended_at: 'just now' });
    expect(res.status).toBe(400);
    await endSession(started.id);
  });

  it('returns 400 when session is already ended', async () => {
    const started = await (await startSession()).json();
    await endSession(started.id);
    const res = await endSession(started.id);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown session', async () => {
    const res = await endSession(99999);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/sessions/current', () => {
  it('returns one entry per category', async () => {
    const res = await app.request(`${SESSIONS}/current`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // At least the one category created in beforeAll
    expect(body.length).toBeGreaterThan(0);
    body.forEach((entry: { category: object }) => {
      expect(entry.category).toBeDefined();
    });
  });

  it('returns null item and session for an idle category', async () => {
    // No open sessions at this point
    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === categoryId);
    expect(entry).toBeDefined();
    expect(entry.item).toBeNull();
    expect(entry.session).toBeNull();
  });

  it('returns enriched entry when a session is active', async () => {
    const s = await (await startSession()).json();

    const res = await app.request(`${SESSIONS}/current`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === categoryId);

    expect(entry.item).not.toBeNull();
    expect(entry.item.id).toBe(itemId);
    expect(entry.item.name).toBe('Test Shoe');
    expect(entry.session).not.toBeNull();
    expect(entry.session.id).toBe(s.id);
    expect(entry.session.ended_at).toBeNull();
    expect(entry.category.risk_levels).toBeInstanceOf(Array);

    await endSession(s.id);
  });
});

describe('GET /api/sessions', () => {
  it('returns a list of sessions', async () => {
    const s = await (await startSession()).json();
    await endSession(s.id);
    const res = await app.request(SESSIONS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('filters by item_id', async () => {
    const res = await app.request(`${SESSIONS}?item_id=${itemId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    body.forEach((s: { item_id: number }) => expect(s.item_id).toBe(itemId));
  });
});

describe('GET /api/sessions/:id', () => {
  it('returns a single session', async () => {
    const s = await (await startSession()).json();
    await endSession(s.id);
    const res = await app.request(`${SESSIONS}/${s.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(s.id);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request(`${SESSIONS}/99999`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/sessions/current — items field', () => {
  it('includes an items array on every entry', async () => {
    const res = await app.request(`${SESSIONS}/current`);
    expect(res.status).toBe(200);
    const body = await res.json();
    body.forEach((entry: { items: unknown }) => {
      expect(Array.isArray(entry.items)).toBe(true);
    });
  });

  it('lists the item with null last-session fields when it has no history', async () => {
    // Create a fresh category + item with no sessions
    const catRes = await app.request(CATEGORIES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Fresh Cat',
        icon: 'ph:sneaker',
        initial_target_wear_duration_seconds: 900,
        initial_max_wear_duration_seconds: 1800,
        rest_multiplier: 6,
        minimum_rest: 86400,
        risk_levels: [{ lower: null, upper: null, text: 'safe', severity: 1 }],
        break_decay_multiplier: 0.91,
        break_grace_time: 86400,
      }),
    });
    const cat = await catRes.json();

    const itemRes = await app.request(ITEMS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Fresh Shoe', category_id: cat.id, color: '#123456' }),
    });
    const item = await itemRes.json();

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === cat.id);
    expect(entry).toBeDefined();
    expect(entry.items).toHaveLength(1);

    const ourItem = entry.items[0];
    expect(ourItem.item_id).toBe(item.id);
    expect(ourItem.name).toBe('Fresh Shoe');
    expect(ourItem.difficulty_multiplier).toBeTypeOf('number');
    expect(ourItem.ended_at).toBeNull();
    expect(ourItem.target_wear_seconds).toBeNull();
    expect(ourItem.max_wear_seconds).toBeNull();
    expect(ourItem.rest_seconds).toBeNull();
  });

  it('populates last-session fields after a session ends', async () => {
    const s = await (await startSession()).json();
    await endSession(s.id);

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === categoryId);
    const ourItem = entry.items.find((i: { item_id: number }) => i.item_id === itemId);

    expect(ourItem).toBeDefined();
    expect(ourItem.ended_at).toBeTypeOf('number');
    expect(ourItem.max_wear_seconds).toBeTypeOf('number');
    expect(ourItem.rest_seconds).toBeTypeOf('number');
  });
});

describe('Stats updates after session end', () => {
  it('increments per-item session_count and total_wear_seconds', async () => {
    const statsBefore = prepare('SELECT * FROM stats WHERE item_id = ?').get(itemId) as {
      session_count: number;
      total_wear_seconds: number;
    };
    const startTs = Math.floor(Date.now() / 1000) - 3600;
    const s = await (await startSession({ started_at: startTs })).json();
    await endSession(s.id);
    const statsAfter = prepare('SELECT * FROM stats WHERE item_id = ?').get(itemId) as {
      session_count: number;
      total_wear_seconds: number;
    };
    expect(statsAfter.session_count).toBe(statsBefore.session_count + 1);
    expect(statsAfter.total_wear_seconds).toBeGreaterThan(statsBefore.total_wear_seconds);
  });

  it('increments category streak_count after a session', async () => {
    const catStatsBefore = prepare('SELECT * FROM category_stats WHERE category_id = ?').get(categoryId) as {
      streak_count: number;
    };
    const s = await (await startSession()).json();
    await endSession(s.id);
    const catStatsAfter = prepare('SELECT * FROM category_stats WHERE category_id = ?').get(categoryId) as {
      streak_count: number;
    };
    expect(catStatsAfter.streak_count).toBe(catStatsBefore.streak_count + 1);
  });
});
