import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import app from '../../src/server.js'
import { runMigrations } from '../../src/db/migrations/index.js'
import { prepare } from '../../src/db/index.js'

beforeAll(() => {
  runMigrations()
})

beforeEach(() => {
  prepare('DELETE FROM push_subscriptions').run()
})

const NOTIFICATIONS = '/api/notifications'

describe('GET /api/notifications/vapid-public-key', () => {
  it('returns publicKey field', async () => {
    const res = await app.request(`${NOTIFICATIONS}/vapid-public-key`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { publicKey: string | null }
    expect('publicKey' in body).toBe(true)
    // In test env VAPID vars are not set, so null is expected. As such, no test
    // for public key value.
  })
})

describe('POST /api/notifications/subscribe', () => {
  it('stores a subscription and returns 200', async () => {
    const sub = {
      endpoint: 'https://push.example.com/test',
      keys: { p256dh: 'fake-p256dh', auth: 'fake-auth' },
    }
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    })
    expect(res.status).toBe(200)
  })

  it('updates the same endpoint and keeps other devices', async () => {
    const sub1 = {
      endpoint: 'https://push.example.com/first',
      keys: { p256dh: 'a', auth: 'b' },
    }
    const sub2 = {
      endpoint: 'https://push.example.com/second',
      keys: { p256dh: 'c', auth: 'd' },
    }
    await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub1),
    })
    await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub2),
    })
    const updated = { ...sub1, keys: { p256dh: 'updated', auth: 'b' } }
    await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
    const rows = prepare(
      'SELECT subscription_json FROM push_subscriptions ORDER BY id',
    ).all() as { subscription_json: string }[]
    expect(rows.map((row) => JSON.parse(row.subscription_json)))
      .toEqual([updated, sub2])
  })

  it('returns 400 when body is missing endpoint', async () => {
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: { p256dh: 'x', auth: 'y' } }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is missing keys.p256dh', async () => {
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'https://push.example.com/x',
        keys: { auth: 'y' },
      }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is missing keys.auth', async () => {
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'https://push.example.com/x',
        keys: { p256dh: 'x' },
      }),
    })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/notifications/subscribe', () => {
  it('removes only the specified device', async () => {
    const first = 'https://push.example.com/first'
    const second = 'https://push.example.com/second'
    for (const endpoint of [first, second]) {
      await app.request(`${NOTIFICATIONS}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, keys: { p256dh: 'x', auth: 'y' } }),
      })
    }
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: first }),
    })
    expect(res.status).toBe(200)
    const rows = prepare(
      "SELECT json_extract(subscription_json, '$.endpoint') AS endpoint " +
        'FROM push_subscriptions',
    ).all()
    expect(rows).toEqual([{ endpoint: second }])
  })

  it('returns 200 when nothing is subscribed (idempotent delete)', async () => {
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example.com/unknown' }),
    })
    expect(res.status).toBe(200)
  })

  it('rejects a delete without an endpoint', async () => {
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(400)
  })
})
