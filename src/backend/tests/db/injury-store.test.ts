// src/backend/tests/db/injury-store.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import db from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { injuryStore } from '../../src/db/stores/injury-store.js';
import { categoryStore } from '../../src/db/stores/category-store.js';
import { itemStore } from '../../src/db/stores/item-store.js';

const defaultCategory = {
  name: 'Ears',
  icon: 'ear',
  initial_target_wear_duration_seconds: 3600,
  initial_max_wear_duration_seconds: 7200,
  rest_multiplier: 2,
  minimum_rest: 3600,
  risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
  break_decay_multiplier: 0.9,
  break_grace_time: 3600,
};

let categoryId: number;
let itemId: number;
let item2Id: number;

beforeAll(() => {
  runMigrations();
  const cat = categoryStore.create(defaultCategory);
  categoryId = cat.id;
  const item = itemStore.create({
    name: 'Ring',
    category_id: categoryId,
    color: '#fff',
  });
  itemId = item.id;
  const item2 = itemStore.create({
    name: 'Stud',
    category_id: categoryId,
    color: '#000',
  });
  item2Id = item2.id;
});

// Helper: insert a session directly so we can control timestamps
function insertSession(iid: number, startedAt: number, endedAt: number | null) {
  db.prepare(
    `INSERT INTO sessions
       (item_id, started_at, ended_at, target_wear_seconds,
        max_wear_seconds, rest_seconds)
     VALUES (?, ?, ?, 3600, 7200, 3600)`,
  ).run(iid, startedAt, endedAt);
}

describe('lastSessionWear', () => {
  it('returns 0 when no sessions exist for the item', () => {
    expect(injuryStore.lastSessionWear(itemId)).toBe(0);
  });

  it('returns 0 for open (no ended_at) sessions', () => {
    insertSession(itemId, 1000, null);
    expect(injuryStore.lastSessionWear(itemId)).toBe(0);
  });

  it('returns elapsed seconds of the most recent ended session', () => {
    insertSession(itemId, 2000, 2000 + 1800);
    insertSession(itemId, 5000, 5000 + 900); // most recent
    expect(injuryStore.lastSessionWear(itemId)).toBe(900);
  });
});

describe('hasActiveInCategory', () => {
  it('returns false when there are no injuries in the category', () => {
    expect(injuryStore.hasActiveInCategory(categoryId)).toBe(false);
  });

  it('returns false when all injuries in the category are healed', () => {
    injuryStore.record(item2Id, 2);
    injuryStore.heal(item2Id);
    expect(injuryStore.hasActiveInCategory(categoryId)).toBe(false);
  });

  it('returns true when an unhealed injury exists in the category', () => {
    injuryStore.record(itemId, 3);
    expect(injuryStore.hasActiveInCategory(categoryId)).toBe(true);
    // clean up so subsequent tests start clean
    injuryStore.heal(itemId);
  });
});

describe('findActive', () => {
  it('returns undefined when there is no active injury', () => {
    expect(injuryStore.findActive(itemId)).toBeUndefined();
  });

  it(
    'returns only the unhealed injury when both healed and unhealed ' + 'exist',
    () => {
      // Record first injury then heal it
      injuryStore.record(itemId, 1);
      injuryStore.heal(itemId);

      // Record a second injury — this stays active
      const active = injuryStore.record(itemId, 2);

      const found = injuryStore.findActive(itemId);
      expect(found).toBeDefined();
      expect(found!.id).toBe(active.id);
      expect(found!.healed_at).toBeNull();

      // clean up
      injuryStore.heal(itemId);
    },
  );
});

describe('heal', () => {
  it(
    'sets healed_at only for the active injury, leaving already-healed ' +
      'ones unchanged',
    () => {
      // First injury: record and heal it
      const first = injuryStore.record(itemId, 1);
      injuryStore.heal(itemId);
      const firstHealed = injuryStore.find(first.id)!;
      expect(firstHealed.healed_at).not.toBeNull();
      const firstHealedAt = firstHealed.healed_at;

      // Second injury: record but don't heal yet
      const second = injuryStore.record(itemId, 2);
      expect(injuryStore.find(second.id)!.healed_at).toBeNull();

      // Heal active (second injury)
      injuryStore.heal(itemId);

      // First injury's healed_at must be unchanged
      expect(injuryStore.find(first.id)!.healed_at).toBe(firstHealedAt);
      // Second injury now healed
      expect(injuryStore.find(second.id)!.healed_at).not.toBeNull();
    },
  );
});
