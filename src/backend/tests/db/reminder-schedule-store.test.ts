import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { runMigrations } from '../../src/db/migrations/index.js'
import { dbExport } from '../../src/db/index.js'
import { reminderScheduleStore } from
  '../../src/db/stores/reminder-schedule-store.js'
import { createCategory } from '../fixtures.js'

beforeAll(() => {
  runMigrations()
})

beforeEach(() => {
  dbExport.exec('DELETE FROM reminder_schedules; DELETE FROM categories;')
})

describe('reminderScheduleStore', () => {
  it('creates and lists schedules for a category', async () => {
    const cat = await (await createCategory()).json()
    const created = reminderScheduleStore.create({
      category_id: cat.id,
      remind_each_seconds: 3600,
      text: 'Change strap',
    })
    expect(created.id).toBeDefined()
    expect(reminderScheduleStore.findAllForCategory(cat.id)).toEqual([
      created,
    ])
  })

  it('updates remind_each_seconds and text', async () => {
    const cat = await (await createCategory()).json()
    const created = reminderScheduleStore.create({
      category_id: cat.id,
      remind_each_seconds: 3600,
      text: 'Change strap',
    })
    const updated = reminderScheduleStore.update(created.id, {
      remind_each_seconds: 7200,
      text: 'Change tape',
    })
    expect(updated.remind_each_seconds).toBe(7200)
    expect(updated.text).toBe('Change tape')
  })

  it('deletes a schedule', async () => {
    const cat = await (await createCategory()).json()
    const created = reminderScheduleStore.create({
      category_id: cat.id,
      remind_each_seconds: 3600,
      text: 'Change strap',
    })
    reminderScheduleStore.delete(created.id)
    expect(reminderScheduleStore.find(created.id)).toBeUndefined()
  })
})
