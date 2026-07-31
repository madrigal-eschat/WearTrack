import { describe, it, expect } from 'vitest'
import { runMigrations } from '../../src/db/migrations/index.js'
import { prepare } from '../../src/db/index.js'

describe('migration 013: reminder schedules', () => {
  it('creates reminder_schedules and reminder_state tables', () => {
    runMigrations()
    const tables = prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    ).all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('reminder_schedules')
    expect(names).toContain('reminder_state')
  })

  it('reminder_state enforces one row per (session_id, schedule_id)', () => {
    runMigrations()
    prepare(
      `INSERT INTO categories
         (name, icon, rest_multiplier, risk_levels, break_decay_multiplier,
          initial_target_wear_duration_seconds,
          initial_max_wear_duration_seconds, break_grace_time, minimum_rest)
       VALUES ('Migration013 Test', 'x', 2, '[]', 0.91, 900, 1800, 86400,
               86400)`,
    ).run()
    const categoryId = (
      prepare(`SELECT id FROM categories WHERE name = 'Migration013 Test'`)
        .get() as { id: number }
    ).id
    prepare(
      `INSERT INTO reminder_schedules (category_id, remind_each_seconds, text)
       VALUES (?, 3600, 'Change strap')`,
    ).run(categoryId)
    const scheduleId = (
      prepare(`SELECT id FROM reminder_schedules WHERE category_id = ?`)
        .get(categoryId) as { id: number }
    ).id
    prepare(
      `INSERT INTO items (category_id, name, color) VALUES (?, 'Item', '#fff')`,
    ).run(categoryId)
    const itemId = (
      prepare(`SELECT id FROM items WHERE category_id = ?`).get(categoryId) as
        { id: number }
    ).id
    prepare(
      `INSERT INTO sessions (item_id, started_at, target_wear_seconds)
       VALUES (?, 0, 900)`,
    ).run(itemId)
    const sessionId = (
      prepare(`SELECT id FROM sessions WHERE item_id = ?`).get(itemId) as
        { id: number }
    ).id
    prepare(
      `INSERT INTO reminder_state (session_id, schedule_id, fired_count)
       VALUES (?, ?, 1)`,
    ).run(sessionId, scheduleId)
    expect(() =>
      prepare(
        `INSERT INTO reminder_state (session_id, schedule_id, fired_count)
         VALUES (?, ?, 2)`,
      ).run(sessionId, scheduleId),
    ).toThrow()
  })
})
