import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/server.js'

describe('GET /api/version', () => {
  const originalAppVersion = process.env.APP_VERSION
  const originalCommitHash = process.env.COMMIT_HASH

  afterEach(() => {
    if (originalAppVersion === undefined) {
      delete process.env.APP_VERSION
    } else {
      process.env.APP_VERSION = originalAppVersion
    }
    if (originalCommitHash === undefined) {
      delete process.env.COMMIT_HASH
    } else {
      process.env.COMMIT_HASH = originalCommitHash
    }
  })

  it('returns the APP_VERSION and COMMIT_HASH env vars', async () => {
    process.env.APP_VERSION = '1.2.3'
    process.env.COMMIT_HASH = 'abc1234'
    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      version: '1.2.3',
      commit: 'abc1234',
    })
  })

  it.each([
    ['APP_VERSION', 'version'],
    ['COMMIT_HASH', 'commit'],
  ])('returns "unknown" when %s is not set', async (envVar, field) => {
    process.env.APP_VERSION = '1.2.3'
    process.env.COMMIT_HASH = 'abc1234'
    delete process.env[envVar]
    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      version: field === 'version' ? 'unknown' : '1.2.3',
      commit: field === 'commit' ? 'unknown' : 'abc1234',
    })
  })

  it.each([
    ['APP_VERSION', 'version'],
    ['COMMIT_HASH', 'commit'],
  ])('returns "unknown" when %s is blank', async (envVar, field) => {
    process.env.APP_VERSION = '1.2.3'
    process.env.COMMIT_HASH = 'abc1234'
    process.env[envVar] = '  '
    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      version: field === 'version' ? 'unknown' : '1.2.3',
      commit: field === 'commit' ? 'unknown' : 'abc1234',
    })
  })

  it('trims configured metadata values', async () => {
    process.env.APP_VERSION = ' 1.2.3 '
    process.env.COMMIT_HASH = ' abc1234 '
    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      version: '1.2.3',
      commit: 'abc1234',
    })
  })

  it('preserves the route response status', async () => {
    delete process.env.COMMIT_HASH
    const res = await app.request('/api/version')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ version: 'unknown', commit: 'unknown' })
  })
})
