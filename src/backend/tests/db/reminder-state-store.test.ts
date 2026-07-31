import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { runMigrations } from '../../src/db/migrations/index.js'
import { dbExport } from '../../src/db/index.js'
import { reminderStateStore } from
  '../../src/db/stores/reminder-state-store.js'
import { reminderScheduleStore } from
  '../../src/db/stores/reminder-schedule-store.js'
import { createCategory, createItem } from '../fixtures.js'

const SESSIONS = '/api/sessions'
import app from '../../src/server.js'

beforeAll(() => {
  runMigrations()
})

beforeEach(() => {
  dbExport.exec(
    'DELETE FROM reminder_state; DELETE FROM reminder_schedules; ' +
      'DELETE FROM sessions; DELETE FROM items; DELETE FROM categories;',
  )
})

describe('reminderStateStore', () => {
  it('returns undefined when no row exists', async () => {
    const cat = await (await createCategory()).json()
    const item = await (await createItem(cat.id)).json()
    const schedule = reminderScheduleStore.create({
      category_id: cat.id,
      remind_each_seconds: 3600,
      text: 'Change strap',
    })
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, started_at: 0 }),
    })
    const session = await startRes.json()
    expect(reminderStateStore.get(session.id, schedule.id)).toBeUndefined()
  })

  it('upserts and reads back fired_count', async () => {
    const cat = await (await createCategory()).json()
    const item = await (await createItem(cat.id)).json()
    const schedule = reminderScheduleStore.create({
      category_id: cat.id,
      remind_each_seconds: 3600,
      text: 'Change strap',
    })
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, started_at: 0 }),
    })
    const session = await startRes.json()
    reminderStateStore.upsert(session.id, schedule.id, 2)
    expect(reminderStateStore.get(session.id, schedule.id)).toEqual({
      session_id: session.id,
      schedule_id: schedule.id,
      fired_count: 2,
    })
    reminderStateStore.upsert(session.id, schedule.id, 3)
    expect(reminderStateStore.get(session.id, schedule.id)?.fired_count).toBe(
      3,
    )
  })
})
