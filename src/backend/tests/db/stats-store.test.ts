// src/backend/tests/db/stats-store.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import db from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { statsStore } from '../../src/db/stores/stats-store.js';
import { categoryStore } from '../../src/db/stores/category-store.js';

beforeAll(() => {
  runMigrations();
  categoryStore.create({
    name: 'C', icon: 'x',
    initial_target_wear_duration_seconds: 900, initial_max_wear_duration_seconds: 1800,
    rest_multiplier: 2, minimum_rest: 0,
    risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
    break_decay_multiplier: 0.91, break_grace_time: 86400,
  });
  db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (1,'i','#fff',1)`).run();
  statsStore.initItem(1);
});

describe('recordItemSession', () => {
  it('counts wear as elapsed (ended_at - started_at), not the stored max', () => {
    statsStore.recordItemSession({
      id: 1, item_id: 1, started_at: 100, ended_at: 100 + 3600,
      target_wear_seconds: 900, max_wear_seconds: 1800, rest_seconds: 0,
    });
    const stats = statsStore.findForItem(1)!;
    expect(stats.total_wear_seconds).toBe(3600);
    expect(stats.max_single_session_wear_seconds).toBe(3600);
  });
});
