import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { dbExport } from '../../src/db/index.js';
import { eventBus } from '../../src/events/bus.js';
import { createCategory, createItem } from '../fixtures.js';
import app from '../../src/server.js';

const SESSIONS = '/api/sessions';

runMigrations();

beforeEach(() => {
  dbExport.exec('DELETE FROM sessions; DELETE FROM items; DELETE FROM categories;');
});

describe('session-store event hooks', () => {
  it('emits session_start with target/max on session start', async () => {
    const cat = await (await createCategory()).json();
    const item = await (await createItem(cat.id)).json();

    const listener = vi.fn();
    eventBus.on('session_start', listener);

    const res = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, started_at: 500 }),
    });
    const session = await res.json();

    expect(listener).toHaveBeenCalledWith({
      category_id: cat.id,
      category_name: cat.name,
      timestamp: 500,
      session_id: session.id,
      item_id: item.id,
      target_wear_seconds: session.target_wear_seconds,
      max_wear_seconds: session.max_wear_seconds,
    });
  });

  it('emits session_end with actual duration, rest, and risk level on session end', async () => {
    const cat = await (await createCategory()).json();
    const item = await (await createItem(cat.id)).json();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, started_at: 0 }),
    });
    const session = await startRes.json();

    const listener = vi.fn();
    eventBus.on('session_end', listener);

    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 600 }),
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const payload = listener.mock.calls[0][0];
    expect(payload).toMatchObject({
      category_id: cat.id,
      category_name: cat.name,
      timestamp: 600,
      session_id: session.id,
      item_id: item.id,
      actual_duration_seconds: 600,
    });
    expect(typeof payload.rest_seconds).toBe('number');
    expect(payload.risk_level === null || typeof payload.risk_level === 'string').toBe(true);
  });
});
