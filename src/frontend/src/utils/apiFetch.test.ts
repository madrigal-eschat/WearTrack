import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiFetch } from './apiFetch.js'

function makeResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response
}

describe('apiFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the response on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200)))
    const reloadSpy = vi.fn()
    vi.stubGlobal('location', { reload: reloadSpy })

    const res = await apiFetch('/api/test')

    expect(res.status).toBe(200)
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('returns the response on 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(500)))
    const reloadSpy = vi.fn()
    vi.stubGlobal('location', { reload: reloadSpy })

    const res = await apiFetch('/api/test')

    expect(res.status).toBe(500)
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('reloads and throws on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(401)))
    const reloadSpy = vi.fn()
    vi.stubGlobal('location', { reload: reloadSpy })

    await expect(apiFetch('/api/test')).rejects.toThrow()
    expect(reloadSpy).toHaveBeenCalledOnce()
  })

  it('reloads and throws on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(403)))
    const reloadSpy = vi.fn()
    vi.stubGlobal('location', { reload: reloadSpy })

    await expect(apiFetch('/api/test')).rejects.toThrow()
    expect(reloadSpy).toHaveBeenCalledOnce()
  })

  it('passes through args to fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(200))
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('location', { reload: vi.fn() })

    await apiFetch('/api/test', { method: 'POST' })

    expect(mockFetch).toHaveBeenCalledWith('/api/test', {
      method: 'POST',
      redirect: 'manual',
    })
  })
})
