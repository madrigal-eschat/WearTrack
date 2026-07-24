import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runMigrations } from '../../src/db/migrations/index.js'
import { dbExport } from '../../src/db/index.js'
import { eventBus } from '../../src/events/bus.js'
import { eventPollerStore } from '../../src/events/store.js'
import { createCategory, createItem } from '../fixtures.js'
import app from '../../src/server.js'

const SESSIONS = '/api/sessions'

runMigrations()

beforeEach(() => {
  dbExport.exec(
    'DELETE FROM sessions; DELETE FROM session_day_index; ' +
      'DELETE FROM items; DELETE FROM categories;',
  )
})

describe('session-store event hooks', () => {
  it('emits session_start with target/max on session start', async () => {
    const cat = await (await createCategory()).json()
    const item = await (await createItem(cat.id)).json()

    const listener = vi.fn()
    eventBus.on('session_start', listener)

    const res = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, started_at: 500 }),
    })
    const session = await res.json()

    expect(listener).toHaveBeenCalledWith({
      category_id: cat.id,
      category_name: cat.name,
      timestamp: 500,
      session_id: session.id,
      item_id: item.id,
      target_wear_seconds: session.target_wear_seconds,
      max_wear_seconds: session.max_wear_seconds,
    })
  })

  it(
    'emits session_end with actual duration, rest, and risk level on ' +
      'session end',
    async () => {
      const cat = await (await createCategory()).json()
      const item = await (await createItem(cat.id)).json()
      const startRes = await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, started_at: 0 }),
      })
      const session = await startRes.json()

      const listener = vi.fn()
      eventBus.on('session_end', listener)

      await app.request(`${SESSIONS}/${session.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_at: 600 }),
      })

      expect(listener).toHaveBeenCalledTimes(1)
      const payload = listener.mock.calls[0][0]
      expect(payload).toMatchObject({
        category_id: cat.id,
        category_name: cat.name,
        timestamp: 600,
        session_id: session.id,
        item_id: item.id,
        actual_duration_seconds: 600,
      })
      expect(typeof payload.rest_seconds).toBe('number')
      expect(
        payload.risk_level === null || typeof payload.risk_level === 'string',
      ).toBe(true)
    },
  )

  it(
    'synchronously emits rest_end (before session_start) when a new ' +
      "session starts during the previous session's active rest " +
      'window',
    async () => {
      const cat = await (await createCategory()).json()
      const item = await (await createItem(cat.id)).json()

      const startResA = await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, started_at: 0 }),
      })
      const sessionA = await startResA.json()
      await app.request(`${SESSIONS}/${sessionA.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_at: 100 }),
      })
      // rest_seconds is floored at minimum_rest = 86400, so rest window runs to
      // 86500.

      const order: string[] = []
      const restEnd = vi.fn(() => order.push('rest_end'))
      const decayFinish = vi.fn(() => order.push('decay_finish'))
      const sessionStart = vi.fn(() => order.push('session_start'))
      eventBus.on('rest_end', restEnd)
      eventBus.on('decay_finish', decayFinish)
      eventBus.on('session_start', sessionStart)

      // Session B starts at 200: well within A's rest window (ends 86500).
      await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, started_at: 200 }),
      })

      expect(restEnd).toHaveBeenCalledTimes(1)
      expect(restEnd.mock.calls[0][0]).toMatchObject({
        category_id: cat.id,
        category_name: cat.name,
        timestamp: 200,
        rest_seconds: 86400,
        elapsed_rest_seconds: 100, // 200 - 100 (previous.ended_at)
      })
      expect(decayFinish).not.toHaveBeenCalled()
      expect(sessionStart).toHaveBeenCalledTimes(1)
      expect(order).toEqual(['rest_end', 'session_start'])
    },
  )

  it(
    'synchronously emits decay_finish (before session_start) when a ' +
      'new session starts after the previous session has fully decayed',
    async () => {
      const cat = await (await createCategory()).json()
      const item = await (await createItem(cat.id)).json()

      const startResA = await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, started_at: 0 }),
      })
      const sessionA = await startResA.json()
      await app.request(`${SESSIONS}/${sessionA.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_at: 100 }),
      })
      // rest ends at 86500; decay starts at 86500 + break_grace_time(86400) =
      // 172900;
      // fully decayed 8 days later, at 864100.

      const order: string[] = []
      const restEnd = vi.fn(() => order.push('rest_end'))
      const decayFinish = vi.fn(() => order.push('decay_finish'))
      const sessionStart = vi.fn(() => order.push('session_start'))
      eventBus.on('rest_end', restEnd)
      eventBus.on('decay_finish', decayFinish)
      eventBus.on('session_start', sessionStart)

      await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, started_at: 900_000 }),
      })

      expect(decayFinish).toHaveBeenCalledTimes(1)
      expect(decayFinish.mock.calls[0][0]).toMatchObject({
        category_id: cat.id,
        category_name: cat.name,
        timestamp: 900_000,
        decay_state: 'fully_decayed',
      })
      expect(restEnd).not.toHaveBeenCalled()
      expect(sessionStart).toHaveBeenCalledTimes(1)
      expect(order).toEqual(['decay_finish', 'session_start'])
    },
  )

  it(
    'does not re-emit decay_finish on session start when the poller ' +
      'already reported fully_decayed for this category',
    async () => {
      const cat = await (await createCategory()).json()
      const item = await (await createItem(cat.id)).json()

      const startResA = await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, started_at: 0 }),
      })
      const sessionA = await startResA.json()
      await app.request(`${SESSIONS}/${sessionA.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_at: 100 }),
      })
      // rest ends at 86500; decay starts at 172900; fully decayed by 864100.

      // Simulate the poller having already ticked and reported decay_finish for
      // this category.
      eventPollerStore.upsert({
        category_id: cat.id,
        decay_state: 'fully_decayed',
        resting: 0,
        halfway_notified: 0,
        decay_soon_notified: 0,
        last_session_id: null,
        target_met_notified: 0,
        overtime_warning_30_notified: 0,
        overtime_warning_5_notified: 0,
        overtime_notified: 0,
      })

      const decayFinish = vi.fn()
      eventBus.on('decay_finish', decayFinish)

      await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, started_at: 900_000 }),
      })

      expect(decayFinish).not.toHaveBeenCalled()
    },
  )

  it(
    'emits neither rest_end nor decay_finish when a new session ' +
      'starts while merely decaying (not fully decayed)',
    async () => {
      const cat = await (await createCategory()).json()
      const item = await (await createItem(cat.id)).json()

      const startResA = await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, started_at: 0 }),
      })
      const sessionA = await startResA.json()
      await app.request(`${SESSIONS}/${sessionA.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_at: 100 }),
      })
      // decay starts at 172900. Pick a time on the same day decay starts
      // (daysSinceGrace
      // still 0, i.e. before 172900 + 86400 = 259300): no decay step has been
      // applied yet
      // under any decay curve, so decay_state is reliably 'decaying' regardless
      // of exactly
      // how fast the category's decay formula tapers off after that first day.
      const restEnd = vi.fn()
      const decayFinish = vi.fn()
      eventBus.on('rest_end', restEnd)
      eventBus.on('decay_finish', decayFinish)

      await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, started_at: 200_000 }),
      })

      expect(restEnd).not.toHaveBeenCalled()
      expect(decayFinish).not.toHaveBeenCalled()
    },
  )
})
