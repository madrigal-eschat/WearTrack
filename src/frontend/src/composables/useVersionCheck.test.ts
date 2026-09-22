import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchBackendVersion, fetchVersion } from './useVersionCheck.js'

describe('fetchBackendVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns backend metadata on a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.2.3', commit: 'abc1234' }),
    }))
    expect(await fetchBackendVersion()).toEqual({
      version: '1.2.3',
      commit: 'abc1234',
    })
  })

  it('returns null when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await fetchBackendVersion()).toBeNull()
  })

  it('returns null on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network error')),
    )
    expect(await fetchBackendVersion()).toBeNull()
  })

  it.each([
    {},
    { version: '1.2.3' },
    { commit: 'abc1234' },
    { version: 1.2, commit: 'abc1234' },
    { version: '1.2.3', commit: 123 },
  ])('returns null for malformed metadata: %s', async (metadata) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => metadata,
    }))
    expect(await fetchBackendVersion()).toBeNull()
  })

  it('fetches from /api/version', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.2.3', commit: 'abc1234' }),
    })
    vi.stubGlobal('fetch', mockFetch)
    await fetchBackendVersion()
    expect(mockFetch).toHaveBeenCalledWith('/api/version', {
      redirect: 'manual',
    })
  })
})

describe('fetchVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the backend commit for compatibility', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.2.3', commit: 'abc1234' }),
    }))
    expect(await fetchVersion()).toBe('abc1234')
  })
})
