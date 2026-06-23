import { describe, it, expect, beforeAll } from 'vitest';
import { dbExport } from '../../src/db/index.js';
import runMigration001 from '../../src/db/migrations/001_initial.js';
import runMigration003 from '../../src/db/migrations/003_target_max_wear.js';
import runMigration004 from '../../src/db/migrations/004_drop_legacy_columns.js';

beforeAll(() => {
  runMigration001();
  // Seed a pre-migration category + session using the OLD schema
  dbExport
    .prepare(
      `INSERT INTO categories
         (name, icon, initial_wear_duration_seconds, rest_multiplier, rest_constant_seconds,
          risk_levels, break_decay_multiplier, break_starts_after_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('Legacy', 'x', 1800, 2, 86400, '[]', 0.75, 604800);
  dbExport
    .prepare(
      `INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (1, 'i', '#fff', 1)`,
    )
    .run();
  dbExport
    .prepare(
      `INSERT INTO sessions (item_id, started_at, ended_at, calculated_wear_seconds, calculated_rest_seconds)
       VALUES (1, 100, 1000, 1800, 90000)`,
    )
    .run();
  runMigration003();
  runMigration004();
});

function categoryCols(): string[] {
  return (dbExport.prepare('PRAGMA table_info(categories)').all() as Array<{ name: string }>).map((r) => r.name);
}
function sessionCols(): string[] {
  return (dbExport.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>).map((r) => r.name);
}

describe('migration 003 + 004', () => {
  it('adds the new category columns and drops the legacy ones', () => {
    const cols = categoryCols();
    expect(cols).toContain('initial_target_wear_duration_seconds');
    expect(cols).toContain('initial_max_wear_duration_seconds');
    expect(cols).toContain('break_grace_time');
    expect(cols).toContain('minimum_rest');
    expect(cols).not.toContain('break_starts_after_seconds');
    expect(cols).not.toContain('initial_wear_duration_seconds');
    expect(cols).not.toContain('rest_constant_seconds');
  });

  it('renames + adds the session columns', () => {
    const cols = sessionCols();
    expect(cols).toContain('max_wear_seconds');
    expect(cols).toContain('target_wear_seconds');
    expect(cols).toContain('rest_seconds');
    expect(cols).not.toContain('calculated_wear_seconds');
    expect(cols).not.toContain('calculated_rest_seconds');
  });

  it('backfills category values from legacy data', () => {
    const cat = dbExport.prepare('SELECT * FROM categories WHERE id = 1').get() as Record<string, number>;
    expect(cat.initial_max_wear_duration_seconds).toBe(1800);
    expect(cat.initial_target_wear_duration_seconds).toBe(1200); // floor(1800 * 2/3)
    expect(cat.minimum_rest).toBe(86400);
    expect(cat.break_grace_time).toBe(86400);
    expect(cat.break_decay_multiplier).toBeCloseTo(0.91);
  });

  it('backfills session target as 2/3 of max', () => {
    const s = dbExport.prepare('SELECT * FROM sessions WHERE id = 1').get() as Record<string, number>;
    expect(s.max_wear_seconds).toBe(1800);
    expect(s.target_wear_seconds).toBe(1200);
    expect(s.rest_seconds).toBe(90000);
  });
});
