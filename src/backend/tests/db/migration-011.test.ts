import { describe, it, expect } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { prepare } from '../../src/db/index.js';

describe('migration 011: rotation categories', () => {
  it('adds type and consecutive_wear_days columns with correct defaults', () => {
    runMigrations();
    const columns = prepare(`PRAGMA table_info(categories)`).all() as { name: string }[];
    const names = columns.map((c) => c.name);
    expect(names).toContain('type');
    expect(names).toContain('consecutive_wear_days');
  });

  it('existing categories default to type=duration, consecutive_wear_days=1', () => {
    runMigrations();
    prepare(
      `INSERT INTO categories
         (name, icon, rest_multiplier, risk_levels, break_decay_multiplier,
          initial_target_wear_duration_seconds, initial_max_wear_duration_seconds,
          break_grace_time, minimum_rest)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('Migration011 Test', 'x', 2, '[]', 0.91, 900, 1800, 86400, 86400);
    const row = prepare(`SELECT type, consecutive_wear_days FROM categories WHERE name = ?`).get(
      'Migration011 Test',
    ) as { type: string; consecutive_wear_days: number };
    expect(row.type).toBe('duration');
    expect(row.consecutive_wear_days).toBe(1);
  });
});
