import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/server.js'

describe('GET /api/version', () => {
  const original = process.env.COMMIT_HASH

  afterEach(() => {
    if (original === undefined) {
      delete process.env.COMMIT_HASH
    } else {
      process.env.COMMIT_HASH = original
    }
  })

  it('returns the COMMIT_HASH env var', async () => {
    process.env.COMMIT_HASH = 'abc1234'
    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ version: 'abc1234' })
  })

  it('returns "unknown" when COMMIT_HASH is not set', async () => {
    delete process.env.COMMIT_HASH
    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ version: 'unknown' })
  })

  it('returns "unknown" when COMMIT_HASH is blank', async () => {
    process.env.COMMIT_HASH = ''
    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ version: 'unknown' })
  })
})
