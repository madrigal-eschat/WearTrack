import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/server.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { prepare } from '../../src/db/index.js';
import { createCategory, createItem } from '../fixtures.js';

const SESSIONS = '/api/sessions';
const ITEMS = '/api/items';
const CATEGORIES = '/api/categories';
const INJURIES = '/api/injuries';

let categoryId: number;
let itemId: number;
let decayCategoryId: number;
let decayItemId: number;

beforeAll(async () => {
  runMigrations();
  const cat = await (await createCategory()).json();
  categoryId = cat.id;

  const item = await (await createItem(categoryId, { name: 'Test Shoe' })).json();
  itemId = item.id;
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

  it('halves expected_target and expected_max when an active injury exists for an item', async () => {
    // Create a fresh category and item with no history
    const cat = await (await createCategory({ name: 'Injury Halve Cat' })).json();
    const item = await (await createItem(cat.id, { name: 'Injury Shoe', color: '#aabbcc' })).json();

    // Verify baseline expected values (first session: target=900, max=1800)
    const resBefore = await app.request(`${SESSIONS}/current`);
    const bodyBefore = await resBefore.json();
    const entryBefore = bodyBefore.find((e: { category: { id: number } }) => e.category.id === cat.id);
    const itemBefore = entryBefore.items.find((i: { item_id: number }) => i.item_id === item.id);
    expect(itemBefore.expected_target).toBe(900);
    expect(itemBefore.expected_max).toBe(1800);

    // Record an injury for the item
    const injury = await (await app.request(INJURIES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id }),
    })).json();

    // Now expected_target and expected_max should be halved
    const resAfter = await app.request(`${SESSIONS}/current`);
    const bodyAfter = await resAfter.json();
    const entryAfter = bodyAfter.find((e: { category: { id: number } }) => e.category.id === cat.id);
    const itemAfter = entryAfter.items.find((i: { item_id: number }) => i.item_id === item.id);
    expect(itemAfter.expected_target).toBe(450);   // 900 / 2
    expect(itemAfter.expected_max).toBe(900);      // 1800 / 2

    // Heal the injury to clean up
    await app.request(`${INJURIES}/${injury.id}/heal`, { method: 'POST' });
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

describe('GET /api/sessions/current — decay fields', () => {
  it('returns decay_start_time null and decay_state none when no prior session', async () => {
    // Use the existing categoryId (fresh DB in beforeAll, all sessions ended cleanly)
    // At test-suite start there are no sessions yet for this category
    const catRes = await app.request(CATEGORIES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'DecayCat',
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
      body: JSON.stringify({ name: 'Decay Shoe', category_id: cat.id, color: '#aabbcc' }),
    });
    const item = await itemRes.json();

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === cat.id);

    expect(entry.decay_start_time).toBeNull();
    expect(entry.decay_state).toBe('none');

    // Store for later tests
    decayCategoryId = cat.id;
    decayItemId = item.id;
  });

  it('returns decay_start_time and state none when within grace period', async () => {
    // End a session 1 second ago — still in rest period (minimum_rest = 86400)
    const now = Math.floor(Date.now() / 1000);
    const startTs = now - 3600;
    const endTs = now - 1;
    const s = await (await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: decayItemId, started_at: startTs }),
    })).json();
    await app.request(`${SESSIONS}/${s.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: endTs }),
    });

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === decayCategoryId);

    // decay_start_time = endTs + rest_seconds + break_grace_time — well in the future
    expect(entry.decay_start_time).toBeGreaterThan(now);
    expect(entry.decay_state).toBe('none');
  });

  it('returns decay_state decaying when past grace period', async () => {
    // Use a fresh category so findLastEndedInCategory only sees this test's session
    const now = Math.floor(Date.now() / 1000);
    const decayingCatRes = await app.request(CATEGORIES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'DecayingCat',
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
    const decayingCat = await decayingCatRes.json();
    const decayingItemRes = await app.request(ITEMS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Decaying Shoe', category_id: decayingCat.id, color: '#ccddee' }),
    });
    const decayingItem = await decayingItemRes.json();

    // End a session 5 days ago so decay_start_time is in the past but not fully decayed
    // (0.91^3 ≈ 0.75 * 1800 > 900 initial, so still decaying)
    const endTs = now - 5 * 86400;
    const s = await (await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: decayingItem.id, started_at: endTs - 3600 }),
    })).json();
    // End with ended_at so rest_seconds is minimal (elapsed is small → rest ≈ minimum)
    await app.request(`${SESSIONS}/${s.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: endTs }),
    });

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === decayingCat.id);

    expect(entry.decay_state).toBe('decaying');
    expect(entry.decay_start_time).toBeLessThan(now);
  });

  it('returns decay_state fully_decayed when target has decayed to initial', async () => {
    // Use a fresh category so findLastEndedInCategory only sees this test's session
    const now = Math.floor(Date.now() / 1000);
    const fullyCatRes = await app.request(CATEGORIES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'FullyDecayedCat',
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
    const fullyCat = await fullyCatRes.json();
    const fullyItemRes = await app.request(ITEMS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Fully Decayed Shoe', category_id: fullyCat.id, color: '#ffeedd' }),
    });
    const fullyItem = await fullyItemRes.json();

    // End a session 10 000 days ago — 0.91^10000 rounds to 0, definitely fully decayed
    const endTs = now - 10_000 * 86400;
    const s = await (await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: fullyItem.id, started_at: endTs - 3600 }),
    })).json();
    await app.request(`${SESSIONS}/${s.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: endTs }),
    });

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === fullyCat.id);

    expect(entry.decay_state).toBe('fully_decayed');
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

describe('session_day_index population', () => {
  it('adds a row when a session ends normally', async () => {
    const startTs = Math.floor(Date.now() / 1000) - 3600;
    const s = await (await startSession({ started_at: startTs })).json();
    const day = new Date(startTs * 1000).toISOString().slice(0, 10);

    prepare('DELETE FROM session_day_index WHERE day = ?').run(day);
    await endSession(s.id);

    const row = prepare(
      'SELECT * FROM session_day_index WHERE day = ? AND item_id = ?',
    ).get(day, itemId);
    expect(row).toBeDefined();
  });

  it('is a no-op on a second session ending the same day for the same item', async () => {
    const startTs = Math.floor(Date.now() / 1000) - 3600;
    const day = new Date(startTs * 1000).toISOString().slice(0, 10);

    const s1 = await (await startSession({ started_at: startTs })).json();
    await endSession(s1.id);
    const countAfterFirst = (
      prepare('SELECT COUNT(*) AS n FROM session_day_index WHERE day = ? AND item_id = ?').get(day, itemId) as {
        n: number;
      }
    ).n;

    const s2 = await (await startSession({ started_at: startTs + 60 })).json();
    await endSession(s2.id);
    const countAfterSecond = (
      prepare('SELECT COUNT(*) AS n FROM session_day_index WHERE day = ? AND item_id = ?').get(day, itemId) as {
        n: number;
      }
    ).n;

    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('also adds a row when a session ends in injury', async () => {
    const startTs = Math.floor(Date.now() / 1000) - 3600;
    const day = new Date(startTs * 1000).toISOString().slice(0, 10);
    await startSession({ started_at: startTs });

    await app.request(`${INJURIES}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId }),
    });

    const row = prepare(
      'SELECT * FROM session_day_index WHERE day = ? AND item_id = ?',
    ).get(day, itemId);
    expect(row).toBeDefined();

    // Heal to clean up for later tests
    const injury = await (
      await app.request(`${INJURIES}?item_id=${itemId}`)
    ).json();
    const active = injury.find((i: { healed_at: number | null }) => i.healed_at === null);
    if (active) await app.request(`${INJURIES}/${active.id}/heal`, { method: 'POST' });
  });
});

describe('GET /api/sessions — pagination, category filter, enrichment', () => {
  it('only returns completed sessions', async () => {
    const s = await (await startSession()).json(); // left open
    const res = await app.request(SESSIONS);
    const body = await res.json();
    expect(body.find((x: { id: number }) => x.id === s.id)).toBeUndefined();
    await endSession(s.id);
  });

  it('enriches rows with item/category name/icon/color', async () => {
    const s = await (await startSession()).json();
    await endSession(s.id);
    const res = await app.request(`${SESSIONS}?item_id=${itemId}`);
    const body = await res.json();
    const row = body.find((x: { id: number }) => x.id === s.id);
    expect(row.item_name).toBe('Test Shoe');
    expect(row.category_id).toBe(categoryId);
    expect(row.category_name).toBeTypeOf('string');
    expect(row.category_icon).toBeTypeOf('string');
    expect(row.item_color).toBeTypeOf('string');
  });

  it('filters by category_id', async () => {
    const otherCat = await (await createCategory({ name: 'Other Cat' })).json();
    const otherItem = await (await createItem(otherCat.id, { name: 'Other Item' })).json();
    const s1 = await (
      await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: otherItem.id }),
      })
    ).json();
    await app.request(`${SESSIONS}/${s1.id}/end`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

    const res = await app.request(`${SESSIONS}?category_id=${otherCat.id}`);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
    body.forEach((row: { category_id: number }) => expect(row.category_id).toBe(otherCat.id));
  });

  it('combines category_id and item_id filters', async () => {
    const res = await app.request(`${SESSIONS}?category_id=${categoryId}&item_id=${itemId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    body.forEach((row: { category_id: number; item_id: number }) => {
      expect(row.category_id).toBe(categoryId);
      expect(row.item_id).toBe(itemId);
    });
  });

  it('paginates with before/limit, newest first', async () => {
    // Use a dedicated item so earlier tests' completed sessions (which share this file's
    // real-clock second with `now` since the whole suite runs in milliseconds) can't
    // outrank these offset-based rows and make the ordering assertions flaky.
    const pagCat = await (await createCategory({ name: 'Pagination Cat' })).json();
    const pagItem = await (await createItem(pagCat.id, { name: 'Pagination Item' })).json();

    // Create 3 fresh completed sessions with distinct started_at values, oldest to newest
    const now = Math.floor(Date.now() / 1000);
    const ids: number[] = [];
    for (const offset of [300, 200, 100]) {
      const s = await (
        await app.request(`${SESSIONS}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: pagItem.id, started_at: now - offset }),
        })
      ).json();
      await app.request(`${SESSIONS}/${s.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_at: now - offset + 10 }),
      });
      ids.push(s.id);
    }

    const page1 = await (await app.request(`${SESSIONS}?item_id=${pagItem.id}&limit=2`)).json();
    expect(page1.length).toBe(2);
    expect(page1[0].id).toBe(ids[2]); // newest (offset 100) first
    expect(page1[1].id).toBe(ids[1]);

    const page2 = await (
      await app.request(`${SESSIONS}?item_id=${pagItem.id}&limit=2&before=${page1[1].started_at}`)
    ).json();
    expect(page2[0].id).toBe(ids[0]);
  });

  it('defaults limit to 100', async () => {
    const res = await app.request(`${SESSIONS}?item_id=${itemId}`);
    const body = await res.json();
    expect(body.length).toBeLessThanOrEqual(100);
  });
});

describe('GET /api/sessions/dates', () => {
  it('returns distinct days with completed sessions for an item', async () => {
    const res = await app.request(`${SESSIONS}/dates?item_id=${itemId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    body.forEach((d: string) => expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('filters by category_id', async () => {
    const res = await app.request(`${SESSIONS}/dates?category_id=${categoryId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns all days with no filters', async () => {
    const res = await app.request(`${SESSIONS}/dates`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
  });
});

describe('stats recompute-from-scratch', () => {
  it('recomputeItem reproduces the same totals as incremental recording', async () => {
    const cat = await (await createCategory({ name: 'Recompute Cat' })).json();
    const item = await (await createItem(cat.id, { name: 'Recompute Shoe' })).json();

    const now = Math.floor(Date.now() / 1000);
    for (const offset of [300, 200, 100]) {
      const s = await (
        await app.request(`${SESSIONS}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: item.id, started_at: now - offset }),
        })
      ).json();
      await app.request(`${SESSIONS}/${s.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_at: now - offset + 10 }),
      });
    }

    const before = prepare('SELECT * FROM stats WHERE item_id = ?').get(item.id) as {
      total_wear_seconds: number;
      session_count: number;
      max_single_session_wear_seconds: number;
    };

    const { statsStore } = await import('../../src/db/stores/stats-store.js');
    statsStore.recomputeItem(item.id);

    const after = prepare('SELECT * FROM stats WHERE item_id = ?').get(item.id) as typeof before;
    expect(after).toEqual(before);
  });

  it('recomputeCategory reproduces the same streak state as incremental recording', async () => {
    const cat = await (await createCategory({ name: 'Recompute Streak Cat' })).json();
    const item = await (await createItem(cat.id, { name: 'Recompute Streak Shoe' })).json();

    const now = Math.floor(Date.now() / 1000);
    for (const offset of [300, 200, 100]) {
      const s = await (
        await app.request(`${SESSIONS}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: item.id, started_at: now - offset }),
        })
      ).json();
      await app.request(`${SESSIONS}/${s.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_at: now - offset + 10 }),
      });
    }

    const before = prepare('SELECT * FROM category_stats WHERE category_id = ?').get(cat.id);

    const { statsStore } = await import('../../src/db/stores/stats-store.js');
    statsStore.recomputeCategory(cat.id, cat.break_grace_time);

    const after = prepare('SELECT * FROM category_stats WHERE category_id = ?').get(cat.id);
    expect(after).toEqual(before);
  });

  it('recomputeItem excludes injury-ended sessions, same as incremental recording', async () => {
    const cat = await (await createCategory({ name: 'Recompute Injury Cat' })).json();
    const item = await (await createItem(cat.id, { name: 'Recompute Injury Shoe' })).json();

    await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id }),
    });
    await app.request(INJURIES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id }),
    });

    const { statsStore } = await import('../../src/db/stores/stats-store.js');
    statsStore.recomputeItem(item.id);

    const stats = prepare('SELECT * FROM stats WHERE item_id = ?').get(item.id) as { session_count: number };
    expect(stats.session_count).toBe(0);
  });
});
