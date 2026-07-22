import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { CurrentSessionsQuery } from '../../src/queries/sessions.js';
import { categoryStore } from '../../src/db/stores/category-store.js';
import { itemStore } from '../../src/db/stores/item-store.js';
import { sessionStore } from '../../src/db/stores/session-store.js';
import { nowSeconds } from '../../src/utils/time.js';

const baseCategory = {
  name: 'Query Sessions Test',
  icon: 'ring',
  initial_target_wear_duration_seconds: 3600,
  initial_max_wear_duration_seconds: 7200 as number | null,
  rest_multiplier: 2,
  minimum_rest: 1800,
  risk_levels: [{ lower: null, upper: null, text: 'Default', severity: 1 }],
  break_decay_multiplier: 0.9,
  break_grace_time: 3600,
};

beforeAll(() => {
  runMigrations();
});

describe('CurrentSessionsQuery', () => {
  it('returns an entry per category with item=null/session=null when nothing is open', () => {
    const category = categoryStore.create({ ...baseCategory, name: 'Idle Query Cat' });
    const entries = new CurrentSessionsQuery().run();
    const entry = entries.find((e) => e.category.id === category.id)!;
    expect(entry).toBeDefined();
    expect(entry.item).toBeNull();
    expect(entry.session).toBeNull();
    expect(entry.decay_state).toBe('none');
  });

  it('returns item and session when a session is open', () => {
    const category = categoryStore.create({ ...baseCategory, name: 'Open Query Cat' });
    const item = itemStore.create({ name: 'Query Item', category_id: category.id, color: '#fff' });
    const raw = categoryStore.findRaw(category.id)!;
    sessionStore.start(item.id, raw, item, 1000);

    const entries = new CurrentSessionsQuery().run();
    const entry = entries.find((e) => e.category.id === category.id)!;
    expect(entry.item).not.toBeNull();
    expect(entry.item!.id).toBe(item.id);
    expect(entry.session).not.toBeNull();
    expect(entry.session!.item_id).toBe(item.id);
  });

  it('reports resting_until for a rotation category with a session already started today', () => {
    const category = categoryStore.create({ ...baseCategory, name: 'Rotation Query Cat', type: 'rotation' });
    const item = itemStore.create({ name: 'Rotation Item', category_id: category.id, color: '#fff' });
    const raw = categoryStore.findRaw(category.id)!;
    const now = nowSeconds();
    const session = sessionStore.start(item.id, raw, item, now - 500);
    sessionStore.end(session, raw, now - 100);

    const entries = new CurrentSessionsQuery().run();
    const entry = entries.find((e) => e.category.id === category.id)!;
    expect(entry.resting_until).not.toBeNull();
  });
});
