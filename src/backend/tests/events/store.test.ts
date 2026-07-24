import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { runMigrations } from '../../src/db/migrations/index.js'
import { dbExport } from '../../src/db/index.js'
import { eventPollerStore } from '../../src/events/store.js'

beforeAll(() => {
  runMigrations()
})

beforeEach(() => {
  dbExport.exec('DELETE FROM event_poller_state; DELETE FROM categories;')
  dbExport.exec(`
    INSERT INTO categories
      (id, name, icon, initial_target_wear_duration_seconds,
       initial_max_wear_duration_seconds, rest_multiplier, minimum_rest,
       risk_levels, break_decay_multiplier, break_grace_time)
    VALUES (1, 'Test', 'icon', 900, 1800, 2, 86400, '[]', 0.91, 86400)
  `)
})

describe('eventPollerStore', () => {
  it('returns undefined for a category with no stored row', () => {
    expect(eventPollerStore.get(1)).toBeUndefined()
  })

  it('upserts and reads back a row', () => {
    eventPollerStore.upsert({
      category_id: 1,
      decay_state: 'decaying',
      resting: 1,
      halfway_notified: 0,
      decay_soon_notified: 1,
      last_session_id: 42,
      target_met_notified: 0,
      overtime_warning_30_notified: 0,
      overtime_warning_5_notified: 0,
      overtime_notified: 0,
    })
    expect(eventPollerStore.get(1)).toEqual({
      category_id: 1,
      decay_state: 'decaying',
      resting: 1,
      halfway_notified: 0,
      decay_soon_notified: 1,
      last_session_id: 42,
      target_met_notified: 0,
      overtime_warning_30_notified: 0,
      overtime_warning_5_notified: 0,
      overtime_notified: 0,
    })
  })

  it('overwrites an existing row on repeat upsert', () => {
    eventPollerStore.upsert({
      category_id: 1,
      decay_state: 'none',
      resting: 0,
      halfway_notified: 0,
      decay_soon_notified: 0,
      last_session_id: null,
      target_met_notified: 0,
      overtime_warning_30_notified: 0,
      overtime_warning_5_notified: 0,
      overtime_notified: 0,
    })
    eventPollerStore.upsert({
      category_id: 1,
      decay_state: 'fully_decayed',
      resting: 0,
      halfway_notified: 1,
      decay_soon_notified: 1,
      last_session_id: 7,
      target_met_notified: 1,
      overtime_warning_30_notified: 1,
      overtime_warning_5_notified: 1,
      overtime_notified: 1,
    })
    expect(eventPollerStore.get(1)?.decay_state).toBe('fully_decayed')
    expect(eventPollerStore.get(1)?.last_session_id).toBe(7)
  })
})
