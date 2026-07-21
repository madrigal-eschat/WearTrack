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

describe('sessionStore rotation category behaviour', () => {
  it('start() uses the fixed target and null max for a rotation category', () => {
    const rotationCat = categoryStore.create({
      name: 'Rotation', icon: 'x',
      initial_target_wear_duration_seconds: 57600, // 16h "all day"
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 2, minimum_rest: 0,
      risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
      break_decay_multiplier: 0.91, break_grace_time: 86400,
      type: 'rotation', consecutive_wear_days: 1,
    });
    db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (?,'ri','#fff',1)`).run(rotationCat.id);
    const rawRotationCat = db.prepare('SELECT * FROM categories WHERE id = ?').get(rotationCat.id) as never;
    const rotationItemId = (db.prepare('SELECT id FROM items WHERE category_id = ?').get(rotationCat.id) as { id: number }).id;

    const s = sessionStore.start(rotationItemId, rawRotationCat, item, 1000);
    expect(s.target_wear_seconds).toBe(57600);
    expect(s.max_wear_seconds).toBeNull();
  });

  it('end() leaves rest_seconds null for a rotation category', () => {
    const rotationCat = categoryStore.create({
      name: 'Rotation2', icon: 'x',
      initial_target_wear_duration_seconds: 57600,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 2, minimum_rest: 0,
      risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
      break_decay_multiplier: 0.91, break_grace_time: 86400,
      type: 'rotation', consecutive_wear_days: 1,
    });
    db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (?,'ri2','#fff',1)`).run(rotationCat.id);
    const rawRotationCat = db.prepare('SELECT * FROM categories WHERE id = ?').get(rotationCat.id) as never;
    const rotationItemId = (db.prepare('SELECT id FROM items WHERE category_id = ? AND name = ?').get(rotationCat.id, 'ri2') as { id: number }).id;

    const started = sessionStore.start(rotationItemId, rawRotationCat, item, 20_000);
    const ended = sessionStore.end(started, rawRotationCat, 20_000 + 57600);
    expect(ended.rest_seconds).toBeNull();
    expect(ended.target_wear_seconds).toBe(57600);
  });
});

describe('sessionStore.findRecentInCategory', () => {
  it('returns sessions newest first, limited', () => {
    const cat = categoryStore.create({
      name: 'Recent', icon: 'x',
      initial_target_wear_duration_seconds: 100,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 1, minimum_rest: 0,
      risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
      break_decay_multiplier: 0.91, break_grace_time: 86400,
      type: 'rotation', consecutive_wear_days: 1,
    });
    db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (?,'ra','#fff',1)`).run(cat.id);
    db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (?,'rb','#fff',1)`).run(cat.id);
    const rawCat2 = db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id) as never;
    const itemA = (db.prepare('SELECT id FROM items WHERE category_id = ? AND name = ?').get(cat.id, 'ra') as { id: number }).id;
    const itemB = (db.prepare('SELECT id FROM items WHERE category_id = ? AND name = ?').get(cat.id, 'rb') as { id: number }).id;

    const s1 = sessionStore.start(itemA, rawCat2, item, 1_000_000);
    sessionStore.end(s1, rawCat2, 1_000_100);
    const s2 = sessionStore.start(itemB, rawCat2, item, 1_000_200);
    sessionStore.end(s2, rawCat2, 1_000_300);

    const recent = sessionStore.findRecentInCategory(cat.id, 10);
    expect(recent.map((r) => r.item_id)).toEqual([itemB, itemA]);
  });
});

describe('sessionStore.findSessionStartedTodayInCategory', () => {
  it('finds a session that started on/after dayStart in the category (any item)', () => {
    const cat = categoryStore.create({
      name: 'DailyCapFind', icon: 'x',
      initial_target_wear_duration_seconds: 100,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 1, minimum_rest: 0,
      risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
      break_decay_multiplier: 0.91, break_grace_time: 86400,
      type: 'rotation', consecutive_wear_days: 1,
    });
    db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (?,'dcf','#fff',1)`).run(cat.id);
    const rawCat = db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id) as never;
    const itemId = (db.prepare('SELECT id FROM items WHERE category_id = ? AND name = ?').get(cat.id, 'dcf') as { id: number }).id;

    const dayStart = 2_000_000;
    const s = sessionStore.start(itemId, rawCat, item, dayStart + 3600); // started 1h into the day
    sessionStore.end(s, rawCat, dayStart + 3700);

    const found = sessionStore.findSessionStartedTodayInCategory(cat.id, dayStart);
    expect(found).toBeDefined();
    expect(found!.started_at).toBe(dayStart + 3600);
  });

  it('returns undefined when the only session started before dayStart', () => {
    const cat = categoryStore.create({
      name: 'DailyCapFind2', icon: 'x',
      initial_target_wear_duration_seconds: 100,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 1, minimum_rest: 0,
      risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
      break_decay_multiplier: 0.91, break_grace_time: 86400,
      type: 'rotation', consecutive_wear_days: 1,
    });
    db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (?,'dcf2','#fff',1)`).run(cat.id);
    const rawCat = db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id) as never;
    const itemId = (db.prepare('SELECT id FROM items WHERE category_id = ? AND name = ?').get(cat.id, 'dcf2') as { id: number }).id;

    const dayStart = 5_000_000;
    const s = sessionStore.start(itemId, rawCat, item, dayStart - 3600); // started before dayStart (yesterday)
    sessionStore.end(s, rawCat, dayStart - 3500);

    expect(sessionStore.findSessionStartedTodayInCategory(cat.id, dayStart)).toBeUndefined();
  });
});
