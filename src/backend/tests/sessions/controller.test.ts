import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/server.js';
import runMigration from '../../src/db/migrations/001_initial.js';
import { prepare } from '../../src/db/index.js';

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

let categoryId: number;
let itemId: number;

beforeAll(async () => {
  runMigration();
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

async function endSession(sessionId: number) {
  return app.request(`${SESSIONS}/${sessionId}/end`, { method: 'POST' });
}

describe('POST /api/sessions/start', () => {
  it('starts a session and returns 201', async () => {
    const res = await startSession();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.item_id).toBe(itemId);
    expect(body.started_at).toBeTypeOf('number');
    expect(body.ended_at).toBeNull();
    expect(body.calculated_wear).toBeTypeOf('number');

    // Clean up: end the session
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

  it('returns 404 when item does not exist', async () => {
    const res = await startSession({ item_id: 99999 });
    expect(res.status).toBe(404);
  });

  it('returns 400 when item already has an open session', async () => {
    const s1 = await (await startSession()).json();
    const res = await startSession();
    expect(res.status).toBe(400);
    await endSession(s1.id);
  });
});

describe('POST /api/sessions/:id/end', () => {
  it('ends a session and sets calculated_wear and calculated_rest', async () => {
    const started = await (await startSession()).json();
    const res = await endSession(started.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ended_at).toBeTypeOf('number');
    expect(body.calculated_wear).toBeGreaterThanOrEqual(started.calculated_wear);
    expect(body.calculated_rest).toBeTypeOf('number');
    expect(body.calculated_rest).toBeGreaterThan(0);
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

describe('Stats updates after session end', () => {
  it('increments session_count and total_wear', async () => {
    const statsBefore = prepare('SELECT * FROM stats WHERE item_id = ?').get(itemId) as {
      session_count: number;
      total_wear: number;
    };
    const s = await (await startSession()).json();
    await endSession(s.id);
    const statsAfter = prepare('SELECT * FROM stats WHERE item_id = ?').get(itemId) as {
      session_count: number;
      total_wear: number;
    };
    expect(statsAfter.session_count).toBe(statsBefore.session_count + 1);
    expect(statsAfter.total_wear).toBeGreaterThan(statsBefore.total_wear);
  });
});
