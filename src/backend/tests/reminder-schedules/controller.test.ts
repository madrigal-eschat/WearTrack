import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import app from '../../src/server.js'
import { runMigrations } from '../../src/db/migrations/index.js'
import { dbExport } from '../../src/db/index.js'
import { createCategory } from '../fixtures.js'

const BASE = '/api/reminder-schedules'

beforeAll(() => {
  runMigrations()
})

beforeEach(() => {
  dbExport.exec('DELETE FROM reminder_schedules; DELETE FROM categories;')
})

describe('reminder-schedules controller', () => {
  it('GET ?category_id=X lists schedules for that category', async () => {
    const cat = await (await createCategory()).json()
    await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: cat.id,
        remind_each_seconds: 3600,
        text: 'Change strap',
      }),
    })
    const res = await app.request(`${BASE}?category_id=${cat.id}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].text).toBe('Change strap')
  })

  it('POST creates a schedule and returns 201', async () => {
    const cat = await (await createCategory()).json()
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: cat.id,
        remind_each_seconds: 3600,
        text: 'Change strap',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBeDefined()
    expect(body.category_id).toBe(cat.id)
  })

  it('POST returns 400 when category_id does not exist', async () => {
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: 999999,
        remind_each_seconds: 3600,
        text: 'Change strap',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('POST returns 400 when remind_each_seconds < 60', async () => {
    const cat = await (await createCategory()).json()
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: cat.id,
        remind_each_seconds: 30,
        text: 'Change strap',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('POST returns 400 when text is empty', async () => {
    const cat = await (await createCategory()).json()
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: cat.id,
        remind_each_seconds: 3600,
        text: '',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('PATCH updates a schedule', async () => {
    const cat = await (await createCategory()).json()
    const createRes = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: cat.id,
        remind_each_seconds: 3600,
        text: 'Change strap',
      }),
    })
    const created = await createRes.json()
    const res = await app.request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Change tape' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.text).toBe('Change tape')
  })

  it('PATCH returns 404 for an unknown id', async () => {
    const res = await app.request(`${BASE}/999999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Change tape' }),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE removes a schedule', async () => {
    const cat = await (await createCategory()).json()
    const createRes = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: cat.id,
        remind_each_seconds: 3600,
        text: 'Change strap',
      }),
    })
    const created = await createRes.json()
    const res = await app.request(`${BASE}/${created.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
    const listRes = await app.request(`${BASE}?category_id=${cat.id}`)
    expect(await listRes.json()).toHaveLength(0)
  })

  it('DELETE returns 404 for an unknown id', async () => {
    const res = await app.request(`${BASE}/999999`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})
