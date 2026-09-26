import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useLogDateIndex } from './useLogDateIndex'

function mockFetch(body: unknown, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response)
}

describe('useLogDateIndex', () => {
  it('builds the index from the days the API returns', async () => {
    mockFetch(['2025-03-10', '2025-03-11'])
    const { dateIndex, refreshDateIndex } = useLogDateIndex(
      ref(null),
      ref(null),
    )

    await refreshDateIndex()

    expect(dateIndex.value.length).toBeGreaterThan(0)
  })

  it('sends only the filters that are set', async () => {
    mockFetch([])
    const { refreshDateIndex } = useLogDateIndex(ref(3), ref(null))

    await refreshDateIndex()

    const url = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string
    expect(url).toBe('/api/sessions/dates?category_id=3')
  })

  it('sends both filters when both are set', async () => {
    mockFetch([])
    const { refreshDateIndex } = useLogDateIndex(ref(3), ref(9))

    await refreshDateIndex()

    const url = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string
    expect(url).toBe('/api/sessions/dates?category_id=3&item_id=9')
  })

  it('leaves the index empty when the request fails', async () => {
    mockFetch({ error: 'nope' }, false)
    const { dateIndex, refreshDateIndex } = useLogDateIndex(
      ref(null),
      ref(null),
    )

    await refreshDateIndex()

    expect(dateIndex.value).toEqual([])
  })
})
