import { describe, it, expect, beforeAll } from 'vitest';
import db from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { sessionStore } from '../../src/db/stores/session-store.js';
import { categoryStore } from '../../src/db/stores/category-store.js';

beforeAll(() => {
  runMigrations();
  categoryStore.create({
    name: 'C', icon: 'x',
    initial_target_wear_duration_seconds: 900,
    initial_max_wear_duration_seconds: 1800,
    rest_multiplier: 2, minimum_rest: 86400,
    risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
    break_decay_multiplier: 0.91, break_grace_time: 86400,
  });
  db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (1,'i','#fff',1)`).run();
});

const rawCat = () => db.prepare('SELECT * FROM categories WHERE id = 1').get() as never;
const item = { difficulty_multiplier: 1 };

describe('sessionStore.start', () => {
  it('writes target and max at start (first session = initial values)', () => {
    const s = sessionStore.start(1, rawCat(), item, 1000);
    expect(s.target_wear_seconds).toBe(900);
    expect(s.max_wear_seconds).toBe(1800);
    expect(s.ended_at).toBeNull();
  });
});

describe('sessionStore.end', () => {
  it('derives elapsed and writes rest_seconds without changing target/max', () => {
    const started = sessionStore.start(1, rawCat(), item, 10_000);
    const ended = sessionStore.end(started, rawCat(), 10_000 + 1800);
    expect(ended.target_wear_seconds).toBe(900); // unchanged
    expect(ended.max_wear_seconds).toBe(1800); // unchanged
    // elapsed 1800, weight 0, mult 2 => 3600, floored to minimum_rest 86400
    expect(ended.rest_seconds).toBe(86400);
  });
});
