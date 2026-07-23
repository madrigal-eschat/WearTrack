import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/server.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { createCategory, createItem } from '../fixtures.js';

const INJURIES = '/api/injuries';
const SESSIONS = '/api/sessions';

let categoryId: number;
let itemId: number;

beforeAll(async () => {
  runMigrations();
  const cat = await (await createCategory()).json();
  categoryId = cat.id;

  const item = await (
    await createItem(categoryId, { name: 'Test Shoe' })
  ).json();
  itemId = item.id;
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
    // 5h → moderate severity 2
    const res = await createInjury({ wear_seconds: 18000 });
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
    const freshItem = await (
      await createItem(categoryId, { name: 'Fresh Shoe', color: '#00ff00' })
    ).json();

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

  it('ends an open session when one exists for the item', async () => {
    const item = await (
      await createItem(categoryId, { name: 'Session Shoe', color: '#abcdef' })
    ).json();

    // Start a session for the item
    const session = await (
      await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id }),
      })
    ).json();
    expect(session.ended_at).toBeNull();

    // Record an injury — should end the open session
    const injury = await (
      await app.request(INJURIES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id }),
      })
    ).json();
    expect(injury.id).toBeDefined();

    // The session should now be ended
    const sessionCheck = await (
      await app.request(`${SESSIONS}/${session.id}`)
    ).json();
    expect(sessionCheck.ended_at).not.toBeNull();
    expect(typeof sessionCheck.ended_at).toBe('number');

    await healInjury(injury.id);
  });

  it(
    'derives severity from last session wear when wear_seconds is omitted',
    async () => {
    const item = await (
      await createItem(categoryId, {
        name: 'Wear Derive Shoe',
        color: '#fedcba',
      })
    ).json();

    // Start and end a session with substantial wear (5h = 18000s → moderate =
    // severity 2)
    const now = Math.floor(Date.now() / 1000);
    const session = await (
      await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, started_at: now - 18000 }),
      })
    ).json();
    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: now }),
    });

    // Create an injury without specifying wear_seconds — should pick up
    // 18000s from last session
    const injury = await (
      await app.request(INJURIES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id }),
      })
    ).json();
    // 18000s is in the moderate band (14400..28800)
    expect(injury.severity).toBe(2);

    await healInjury(injury.id);
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
    body.forEach((inj: { item_id: number }) =>
      expect(inj.item_id).toBe(itemId),
    );
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

describe('POST /api/injuries — rotation categories', () => {
  it('rejects recording an injury for a rotation-category item', async () => {
    const cat = await (
      await createCategory({
        name: 'Injury Rotation',
        type: 'rotation',
        consecutive_wear_days: 1,
        initial_target_wear_duration_seconds: 57600,
        initial_max_wear_duration_seconds: null,
      })
    ).json();
    const item = await (
      await createItem(cat.id, { name: 'Injury Rotation Item' })
    ).json();

    const res = await app.request(INJURIES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id }),
    });
    expect(res.status).toBe(400);
  });
});
