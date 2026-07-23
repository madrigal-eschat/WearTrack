// src/backend/tests/db/category-store.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { categoryStore } from '../../src/db/stores/category-store.js';

const baseCategory = {
  name: 'Rings',
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

describe('categoryStore.create and find', () => {
  it('creates a category and retrieves it by id', () => {
    const cat = categoryStore.create({ ...baseCategory, name: 'Bracelets' });
    expect(cat.id).toBeTypeOf('number');
    expect(cat.name).toBe('Bracelets');
    expect(cat.icon).toBe('ring');
    expect(cat.initial_target_wear_duration_seconds).toBe(3600);
    expect(cat.risk_levels).toEqual(baseCategory.risk_levels);

    const found = categoryStore.find(cat.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(cat.id);
    expect(found!.name).toBe('Bracelets');
  });

  it('returns undefined for a non-existent id', () => {
    expect(categoryStore.find(99999)).toBeUndefined();
  });

  it('deserializes risk_levels from JSON into an array', () => {
    const cat = categoryStore.create({
      ...baseCategory,
      name: 'Necklaces',
      risk_levels: [
        { lower: null, upper: 3600, text: 'Low', severity: 0 },
        { lower: 3600, upper: null, text: 'High', severity: 2 },
      ],
    });
    const found = categoryStore.find(cat.id)!;
    expect(Array.isArray(found.risk_levels)).toBe(true);
    expect(found.risk_levels).toHaveLength(2);
    expect(found.risk_levels[0].text).toBe('Low');
  });
});

describe('categoryStore.findRaw', () => {
  it('returns risk_levels as a JSON string', () => {
    const cat = categoryStore.create({ ...baseCategory, name: 'Anklets' });
    const raw = categoryStore.findRaw(cat.id);
    expect(raw).toBeDefined();
    expect(typeof raw!.risk_levels).toBe('string');
    const parsed = JSON.parse(raw!.risk_levels);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('returns undefined for a non-existent id', () => {
    expect(categoryStore.findRaw(99999)).toBeUndefined();
  });
});

describe('categoryStore.findAll', () => {
  it('returns all categories ordered by id (insertion order)', () => {
    const before = categoryStore.findAll();
    const newCat = categoryStore.create({ ...baseCategory, name: 'Toe Rings' });
    const after = categoryStore.findAll();
    expect(after.length).toBe(before.length + 1);
    // Last item in list should be the one we just created
    expect(after[after.length - 1].id).toBe(newCat.id);
    // IDs should be in ascending order
    for (let i = 1; i < after.length; i++) {
      expect(after[i].id).toBeGreaterThan(after[i - 1].id);
    }
  });
});

describe('categoryStore.update', () => {
  it('updates the name', () => {
    const cat = categoryStore.create({ ...baseCategory, name: 'Old Name' });
    const updated = categoryStore.update(cat.id, { name: 'New Name' });
    expect(updated.name).toBe('New Name');
    expect(updated.icon).toBe(baseCategory.icon); // unchanged
  });

  it('updates the icon', () => {
    const cat = categoryStore.create({
      ...baseCategory,
      name: 'IconTest',
      icon: 'old-icon',
    });
    const updated = categoryStore.update(cat.id, { icon: 'new-icon' });
    expect(updated.icon).toBe('new-icon');
  });

  it('updates initial_target_wear_duration_seconds', () => {
    const cat = categoryStore.create({ ...baseCategory, name: 'DurationTest' });
    const updated = categoryStore.update(cat.id, {
      initial_target_wear_duration_seconds: 1200,
    });
    expect(updated.initial_target_wear_duration_seconds).toBe(1200);
  });

  it('updates break_grace_time', () => {
    const cat = categoryStore.create({ ...baseCategory, name: 'GraceTest' });
    const updated = categoryStore.update(cat.id, { break_grace_time: 9999 });
    expect(updated.break_grace_time).toBe(9999);
  });

  it('updates risk_levels (re-serializes from array to JSON and back)', () => {
    const cat = categoryStore.create({ ...baseCategory, name: 'RiskTest' });
    const newLevels = [{ lower: 0, upper: 100, text: 'Updated', severity: 3 }];
    const updated = categoryStore.update(cat.id, { risk_levels: newLevels });
    expect(updated.risk_levels).toEqual(newLevels);
  });
});

describe('categoryStore.delete', () => {
  it('removes the category from the DB', () => {
    const cat = categoryStore.create({
      ...baseCategory,
      name: 'Temp Category',
    });
    expect(categoryStore.find(cat.id)).toBeDefined();
    categoryStore.delete(cat.id);
    expect(categoryStore.find(cat.id)).toBeUndefined();
  });
});

describe('categoryStore rotation fields', () => {
  it(
    'defaults type to duration and consecutive_wear_days to 1 when ' +
      'omitted',
    () => {
      const cat = categoryStore.create({
        ...baseCategory,
        name: 'Default Type',
      });
      expect(cat.type).toBe('duration');
      expect(cat.consecutive_wear_days).toBe(1);
    },
  );

  it('persists an explicit rotation type and consecutive_wear_days', () => {
    const cat = categoryStore.create({
      ...baseCategory,
      name: 'Rotation Cat',
      type: 'rotation',
      consecutive_wear_days: 2,
    });
    expect(cat.type).toBe('rotation');
    expect(cat.consecutive_wear_days).toBe(2);

    const found = categoryStore.find(cat.id)!;
    expect(found.type).toBe('rotation');
    expect(found.consecutive_wear_days).toBe(2);
  });

  it('update() can change type and consecutive_wear_days', () => {
    const cat = categoryStore.create({ ...baseCategory, name: 'Update Type' });
    const updated = categoryStore.update(cat.id, {
      type: 'rotation',
      consecutive_wear_days: 3,
    });
    expect(updated.type).toBe('rotation');
    expect(updated.consecutive_wear_days).toBe(3);
  });
});
