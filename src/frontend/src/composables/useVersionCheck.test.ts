import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchVersion } from './useVersionCheck.js';

describe('fetchVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the version string on a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 'abc1234' }),
    }));
    expect(await fetchVersion()).toBe('abc1234');
  });

  it('returns null when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchVersion()).toBeNull();
  });

  it('returns null on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network error')),
    );
    expect(await fetchVersion()).toBeNull();
  });

  it('fetches from /api/version', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 'abc1234' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchVersion();
    expect(mockFetch).toHaveBeenCalledWith('/api/version', {
      redirect: 'manual',
    });
  });
});
