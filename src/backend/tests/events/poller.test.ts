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
});
