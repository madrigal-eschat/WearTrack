import { describe, it, expect } from 'vitest'
import { runMigrations } from '../../src/db/migrations/index.js'
import { prepare } from '../../src/db/index.js'

describe('migration 008: session_day_index', () => {
  it('creates the session_day_index table with the expected columns', () => {
    runMigrations()
    const row = prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = 'session_day_index'`,
    ).get()
    expect(row).toBeDefined()

    const columns = prepare(`PRAGMA table_info(session_day_index)`).all() as {
      name: string;
    }[]
    const names = columns.map((c) => c.name).sort()
    expect(names).toEqual(['category_id', 'day', 'item_id'])
  })

  it('rejects duplicate (day, category_id, item_id) rows', () => {
    runMigrations()

    // Ensure test data exists
    const catExists = prepare('SELECT id FROM categories WHERE id = 1').get()
    if (!catExists) {
      prepare(
        `INSERT INTO categories
           (name, icon, rest_multiplier, risk_levels,
            break_decay_multiplier,
            initial_target_wear_duration_seconds,
            initial_max_wear_duration_seconds,
            break_grace_time, minimum_rest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('Test', 'x', 2, '[]', 0.75, 1200, 1800, 86400, 86400)
      prepare(
        `INSERT INTO items
           (category_id, name, color, difficulty_multiplier)
         VALUES (?, ?, ?, ?)`,
      ).run(1, 'Test Item', '#ffffff', 1)
    }

    prepare('DELETE FROM session_day_index').run()
    prepare(
      'INSERT INTO session_day_index (day, category_id, item_id) ' +
        'VALUES (?, ?, ?)',
    ).run('2026-01-01', 1, 1)
    expect(() =>
      prepare(
        'INSERT INTO session_day_index (day, category_id, item_id) ' +
          'VALUES (?, ?, ?)',
      ).run('2026-01-01', 1, 1),
    ).toThrow()
  })
})
