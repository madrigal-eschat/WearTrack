import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { StartSessionCommand } from '../../src/commands/sessions.js';
import { itemStore } from '../../src/db/stores/item-store.js';
import { categoryStore } from '../../src/db/stores/category-store.js';
import { sessionStore } from '../../src/db/stores/session-store.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../../src/middleware/errors.js';

const baseCategory = {
  name: 'Command Sessions Test',
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

describe('StartSessionCommand', () => {
  it('throws ValidationError when item_id is not a number', () => {
    expect(() => new StartSessionCommand({ item_id: 'x' }).run()).toThrow(
      ValidationError,
    );
  });

  it('throws NotFoundError for an unknown item', () => {
    expect(() => new StartSessionCommand({ item_id: 999999 }).run()).toThrow(
      NotFoundError,
    );
  });

  it('starts a duration-category session for a valid item', () => {
    const category = categoryStore.create({
      ...baseCategory,
      name: 'Duration Cmd Cat',
    });
    const item = itemStore.create({
      name: 'Item A',
      category_id: category.id,
      color: '#fff',
    });
    const session = new StartSessionCommand({
      item_id: item.id,
      started_at: 1000,
    }).run();
    expect(session.item_id).toBe(item.id);
    expect(session.started_at).toBe(1000);
  });

  it(
    'throws ConflictError when the category already has an open ' + 'session',
    () => {
      const category = categoryStore.create({
        ...baseCategory,
        name: 'Conflict Cmd Cat',
      });
      const itemA = itemStore.create({
        name: 'A',
        category_id: category.id,
        color: '#fff',
      });
      const itemB = itemStore.create({
        name: 'B',
        category_id: category.id,
        color: '#000',
      });
      new StartSessionCommand({ item_id: itemA.id, started_at: 2000 }).run();
      expect(() =>
        new StartSessionCommand({ item_id: itemB.id, started_at: 2001 }).run(),
      ).toThrow(ConflictError);
    },
  );

  it(
    'throws ValidationError for a rotation item whose turn has not ' +
      'come up',
    () => {
      const category = categoryStore.create({
        ...baseCategory,
        name: 'Rotation Cmd Cat',
        type: 'rotation',
      });
      const itemA = itemStore.create({
        name: 'A',
        category_id: category.id,
        color: '#fff',
      });
      const itemB = itemStore.create({
        name: 'B',
        category_id: category.id,
        color: '#000',
      });

      // A's session is on a prior day, so today's attempts don't trip the
      // same-day daily cap —
      // this test is about rotation-availability, mirroring the existing
      // controller test's convention.
      const yesterday = Math.floor(Date.now() / 1000) - 90000;
      const session = new StartSessionCommand({
        item_id: itemA.id,
        started_at: yesterday,
      }).run();
      sessionStore.end(
        sessionStore.find(session.id)!,
        categoryStore.findRaw(category.id)!,
        yesterday + 100,
      );

      // itemA just went — itemB's turn now, itemA is not available yet.
      expect(() =>
        new StartSessionCommand({ item_id: itemA.id }).run(),
      ).toThrow(ValidationError);
      expect(() =>
        new StartSessionCommand({ item_id: itemB.id }).run(),
      ).not.toThrow();
    },
  );
});
