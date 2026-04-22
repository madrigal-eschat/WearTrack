import { describe, it, expect, beforeAll } from 'vitest';
import { dbExport } from '../../src/db/index.js';
import runMigration from '../../src/db/migrations/001_initial.js';

beforeAll(() => {
  runMigration();
});

describe('001_initial migration', () => {
  const expectedTables = ['categories', 'items', 'sessions', 'injuries', 'stats'];

  it.each(expectedTables)('creates table: %s', (table) => {
    const row = dbExport
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(table);
    expect(row).toBeDefined();
  });

  it('categories has formula fields', () => {
    const info = dbExport.prepare('PRAGMA table_info(categories)').all() as Array<{ name: string }>;
    const cols = info.map((r) => r.name);
    expect(cols).toContain('initial_wear_duration_seconds');
    expect(cols).toContain('rest_multiplier');
    expect(cols).toContain('rest_constant_seconds');
    expect(cols).toContain('risk_levels');
    expect(cols).toContain('break_decay_multiplier');
    expect(cols).toContain('break_starts_after_seconds');
    expect(cols).not.toContain('points_per_hour');
    expect(cols).not.toContain('emoji');
  });

  it('injuries has occurred_at, healed_at, severity', () => {
    const info = dbExport.prepare('PRAGMA table_info(injuries)').all() as Array<{ name: string }>;
    const cols = info.map((r) => r.name);
    expect(cols).toContain('occurred_at');
    expect(cols).toContain('healed_at');
    expect(cols).toContain('severity');
    expect(cols).not.toContain('started_at');
    expect(cols).not.toContain('heals_at');
  });

  it('stats has cumulative fields and no points', () => {
    const info = dbExport.prepare('PRAGMA table_info(stats)').all() as Array<{ name: string }>;
    const cols = info.map((r) => r.name);
    expect(cols).toContain('total_wear_seconds');
    expect(cols).toContain('session_count');
    expect(cols).toContain('max_single_session_wear_seconds');
    expect(cols).toContain('streak_wear_seconds');
    expect(cols).toContain('streak_count');
    expect(cols).toContain('best_streak_wear_seconds');
    expect(cols).toContain('best_streak_count');
    expect(cols).not.toContain('points');
  });
});
