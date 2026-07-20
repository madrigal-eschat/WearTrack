import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { dbExport } from '../../src/db/index.js';
import { eventBus } from '../../src/events/bus.js';
import { eventPollerStore } from '../../src/events/store.js';
import { tick } from '../../src/events/poller.js';
import { createCategory, createItem } from '../fixtures.js';
import app from '../../src/server.js';

const SESSIONS = '/api/sessions';

runMigrations();

beforeEach(() => {
  dbExport.exec(
    'DELETE FROM sessions; DELETE FROM session_day_index; DELETE FROM items; DELETE FROM categories; DELETE FROM event_poller_state;',
  );
});

async function setupCategoryAndItem(overrides: Record<string, unknown> = {}) {
  const cat = await (await createCategory(overrides)).json();
  const item = await (await createItem(cat.id)).json();
  return { categoryId: cat.id as number, itemId: item.id as number };
}

describe('events poller tick()', () => {
  it('does not fire rest_start/decay_start on the first-ever tick for existing history (no backfire)', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json();
    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 100 }),
    });

    const listener = vi.fn();
    eventBus.on('rest_start', listener);
    tick(150); // first-ever tick for this category: baseline only, no emit
    expect(listener).not.toHaveBeenCalled();
    expect(eventPollerStore.get(categoryId)?.resting).toBe(1);
  });

  it('fires rest_start on the tick after baseline, once', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json();
    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 100 }),
    });

    // Seed baseline as if a prior tick already ran before resting began.
    eventPollerStore.upsert({
      category_id: categoryId, decay_state: 'none', resting: 0, halfway_notified: 0,
      decay_soon_notified: 0, last_session_id: null, target_met_notified: 0,
      overtime_warning_30_notified: 0, overtime_warning_5_notified: 0, overtime_notified: 0,
    });

    const listener = vi.fn();
    eventBus.on('rest_start', listener);
    tick(150);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ category_id: categoryId });

    // Re-running the same tick again does not refire (restart-safety).
    tick(151);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires target_met once for an open session, resets on a new session', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json(); // target_wear_seconds: 900 (first session)

    eventPollerStore.upsert({
      category_id: categoryId, decay_state: 'none', resting: 0, halfway_notified: 0,
      decay_soon_notified: 0, last_session_id: session.id, target_met_notified: 0,
      overtime_warning_30_notified: 0, overtime_warning_5_notified: 0, overtime_notified: 0,
    });

    const listener = vi.fn();
    eventBus.on('target_met', listener);
    tick(900); // now >= started_at(0) + target(900)
    expect(listener).toHaveBeenCalledTimes(1);
    tick(901);
    expect(listener).toHaveBeenCalledTimes(1); // no refire

    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 1000 }),
    });
    const startRes2 = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 100_000 }),
    });
    const session2 = await startRes2.json();
    tick(100_000 + session2.target_wear_seconds);
    expect(listener).toHaveBeenCalledTimes(2); // fires again for the new session
  });

  it('does not fire rest_start/rest_end/halfway/decay events for a stale previous session while a new session is open in the same category', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem();

    // Session A: ends with rest owed (rest_seconds floored at minimum_rest = 86400).
    const startResA = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const sessionA = await startResA.json();
    await app.request(`${SESSIONS}/${sessionA.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 100 }),
    });

    // Seed baseline as if a prior tick already ran before resting began.
    eventPollerStore.upsert({
      category_id: categoryId, decay_state: 'none', resting: 0, halfway_notified: 0,
      decay_soon_notified: 0, last_session_id: null, target_met_notified: 0,
      overtime_warning_30_notified: 0, overtime_warning_5_notified: 0, overtime_notified: 0,
    });

    // Session B starts (and stays open) in the same category while A's rest/decay clock is still ticking.
    await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 200 }),
    });

    const restStart = vi.fn();
    const restEnd = vi.fn();
    const halfway = vi.fn();
    const decaySoon = vi.fn();
    const decayStart = vi.fn();
    const decayFinish = vi.fn();
    eventBus.on('rest_start', restStart);
    eventBus.on('rest_end', restEnd);
    eventBus.on('idle_halfway_reached', halfway);
    eventBus.on('decay_soon', decaySoon);
    eventBus.on('decay_start', decayStart);
    eventBus.on('decay_finish', decayFinish);

    // now=300: session A's rest window (ends ~86500) would put resting 0 -> 1, and this is
    // well past A's halfway point too. With session B open, none of A's previous-session
    // events should fire.
    tick(300);

    expect(restStart).not.toHaveBeenCalled();
    expect(restEnd).not.toHaveBeenCalled();
    expect(halfway).not.toHaveBeenCalled();
    expect(decaySoon).not.toHaveBeenCalled();
    expect(decayStart).not.toHaveBeenCalled();
    expect(decayFinish).not.toHaveBeenCalled();
  });

  it('fires rest_end once when now crosses previous.ended_at + previous.rest_seconds, does not refire', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json();
    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 100 }),
    });
    // rest_seconds floored at minimum_rest = 86400 -> rest ends at 86500.

    eventPollerStore.upsert({
      category_id: categoryId, decay_state: 'none', resting: 1, halfway_notified: 0,
      decay_soon_notified: 0, last_session_id: null, target_met_notified: 0,
      overtime_warning_30_notified: 0, overtime_warning_5_notified: 0, overtime_notified: 0,
    });

    const listener = vi.fn();
    eventBus.on('rest_end', listener);
    tick(86500);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      category_id: categoryId,
      rest_seconds: 86400,
      elapsed_rest_seconds: 86400,
    });

    tick(86501);
    expect(listener).toHaveBeenCalledTimes(1); // no refire
  });

  it('fires decay_start once when decay_state transitions from none to decaying, does not refire', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json();
    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 100 }),
    });
    // rest ends at 86500; decay starts at 86500 + break_grace_time(86400) = 172900.

    eventPollerStore.upsert({
      category_id: categoryId, decay_state: 'none', resting: 0, halfway_notified: 0,
      decay_soon_notified: 0, last_session_id: null, target_met_notified: 0,
      overtime_warning_30_notified: 0, overtime_warning_5_notified: 0, overtime_notified: 0,
    });

    const listener = vi.fn();
    eventBus.on('decay_start', listener);
    tick(172901);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ category_id: categoryId, decay_state: 'decaying' });

    tick(172902);
    expect(listener).toHaveBeenCalledTimes(1); // no refire
  });

  it('fires decay_finish once when decay_state transitions to fully_decayed, does not refire', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json();
    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 100 }),
    });
    // fully decayed 8 days after decay starts (172900): at 864100.

    eventPollerStore.upsert({
      category_id: categoryId, decay_state: 'decaying', resting: 0, halfway_notified: 1,
      decay_soon_notified: 1, last_session_id: null, target_met_notified: 0,
      overtime_warning_30_notified: 0, overtime_warning_5_notified: 0, overtime_notified: 0,
    });

    const listener = vi.fn();
    eventBus.on('decay_finish', listener);
    tick(864100);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ category_id: categoryId, decay_state: 'fully_decayed' });

    tick(864101);
    expect(listener).toHaveBeenCalledTimes(1); // no refire
  });

  it('fires idle_halfway_reached once when now crosses the halfway point, does not refire', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json();
    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 100 }),
    });
    // halfway = floor((restEnd(86500) + decayStart(172900)) / 2) = 129700.

    eventPollerStore.upsert({
      category_id: categoryId, decay_state: 'none', resting: 0, halfway_notified: 0,
      decay_soon_notified: 0, last_session_id: null, target_met_notified: 0,
      overtime_warning_30_notified: 0, overtime_warning_5_notified: 0, overtime_notified: 0,
    });

    const listener = vi.fn();
    eventBus.on('idle_halfway_reached', listener);
    tick(129700);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ category_id: categoryId, decay_start_time: 172900 });

    tick(129701);
    expect(listener).toHaveBeenCalledTimes(1); // no refire
  });

  it('fires decay_soon once when now crosses the decay-soon fire time, does not refire', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json();
    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 100 }),
    });
    // decay_soon fire time = decayStart(172900) - 3600 = 169300. With break_grace_time
    // 86400, this is well clear of both the rest-end+3600 and halfway suppression windows.

    eventPollerStore.upsert({
      category_id: categoryId, decay_state: 'none', resting: 0, halfway_notified: 1,
      decay_soon_notified: 0, last_session_id: null, target_met_notified: 0,
      overtime_warning_30_notified: 0, overtime_warning_5_notified: 0, overtime_notified: 0,
    });

    const listener = vi.fn();
    eventBus.on('decay_soon', listener);
    tick(169300);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ category_id: categoryId });

    tick(169301);
    expect(listener).toHaveBeenCalledTimes(1); // no refire
  });

  it('fires overtime_warning_30 and overtime_warning_5 once each for an open session with max_wear_seconds set', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem({ initial_max_wear_duration_seconds: 7200 });
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json(); // max_wear_seconds: 7200 (first session)

    eventPollerStore.upsert({
      category_id: categoryId, decay_state: 'none', resting: 0, halfway_notified: 0,
      decay_soon_notified: 0, last_session_id: session.id, target_met_notified: 1,
      overtime_warning_30_notified: 0, overtime_warning_5_notified: 0, overtime_notified: 0,
    });

    const warning30 = vi.fn();
    const warning5 = vi.fn();
    eventBus.on('overtime_warning_30', warning30);
    eventBus.on('overtime_warning_5', warning5);

    tick(5400); // started_at(0) + max(7200) - 1800
    expect(warning30).toHaveBeenCalledTimes(1);
    expect(warning30.mock.calls[0][0]).toMatchObject({ category_id: categoryId, session_id: session.id });
    expect(warning5).not.toHaveBeenCalled();

    tick(5401);
    expect(warning30).toHaveBeenCalledTimes(1); // no refire

    tick(6900); // started_at(0) + max(7200) - 300
    expect(warning5).toHaveBeenCalledTimes(1);
    expect(warning5.mock.calls[0][0]).toMatchObject({ category_id: categoryId, session_id: session.id });

    tick(6901);
    expect(warning5).toHaveBeenCalledTimes(1); // no refire
  });

  it('fires overtime once when now crosses started_at + max_wear_seconds, does not refire', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem({ initial_max_wear_duration_seconds: 7200 });
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json();

    eventPollerStore.upsert({
      category_id: categoryId, decay_state: 'none', resting: 0, halfway_notified: 0,
      decay_soon_notified: 0, last_session_id: session.id, target_met_notified: 1,
      overtime_warning_30_notified: 1, overtime_warning_5_notified: 1, overtime_notified: 0,
    });

    const listener = vi.fn();
    eventBus.on('overtime', listener);
    tick(7200); // started_at(0) + max(7200)
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ category_id: categoryId, session_id: session.id });

    tick(7201);
    expect(listener).toHaveBeenCalledTimes(1); // no refire
  });

  it('resets halfway_notified/decay_soon_notified to 0 when a new rest cycle starts (resting flips 0 -> 1)', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json();
    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 100 }),
    });
    // rest ends at 86500; seed as if halfway/decay_soon already fired for a PRIOR rest cycle,
    // with `resting` recorded as 0 (i.e. the poller last observed the category not resting).

    eventPollerStore.upsert({
      category_id: categoryId, decay_state: 'none', resting: 0, halfway_notified: 1,
      decay_soon_notified: 1, last_session_id: null, target_met_notified: 0,
      overtime_warning_30_notified: 0, overtime_warning_5_notified: 0, overtime_notified: 0,
    });

    // now=150 is well inside the rest window (ends 86500): freshly computed resting is 1,
    // so this tick observes a fresh 0 -> 1 transition and should reset both notified flags.
    tick(150);

    const row = eventPollerStore.get(categoryId);
    expect(row?.resting).toBe(1);
    expect(row?.halfway_notified).toBe(0);
    expect(row?.decay_soon_notified).toBe(0);
  });
});
