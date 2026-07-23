import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSessionLog, type SessionLogEntry } from './useSessionLog';

function makeEntry(overrides: Partial<SessionLogEntry> = {}): SessionLogEntry {
  return {
    id: 1,
    item_id: 1,
    category_id: 1,
    started_at: 1000,
    ended_at: 2000,
    target_wear_seconds: 900,
    max_wear_seconds: null,
    rest_seconds: 100,
    ended_in_injury: 0,
    item_name: 'Test Shoe',
    item_color: '#ff0000',
    category_name: 'Footwear',
    category_icon: 'ph:sneaker',
    ...overrides,
  };
}

function mockFetchOnce(body: unknown, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response);
}

describe('useSessionLog', () => {
  beforeEach(() => {
    const { sessions, categoryFilter, itemFilter } = useSessionLog();
    sessions.value = [];
    categoryFilter.value = null;
    itemFilter.value = null;
    vi.resetAllMocks();
  });

  it(
    'loadInitial populates sessions and sets hasMore based on page size',
    async () => {
      mockFetchOnce([makeEntry({ id: 1 })]);
      const { sessions, hasMore, loadInitial } = useSessionLog();
      await loadInitial();
      expect(sessions.value).toHaveLength(1);
      expect(hasMore.value).toBe(false); // fewer than 100 rows returned
    },
  );

  it(
    'loadMore appends using the last session\'s started_at as the before' +
      ' cursor',
    async () => {
      mockFetchOnce(
        Array.from({ length: 100 }, (_, i) =>
          makeEntry({ id: i + 1, started_at: 1000 - i })),
      );
      const { sessions, loadInitial, loadMore } = useSessionLog();
      await loadInitial();
      expect(sessions.value).toHaveLength(100);

      mockFetchOnce([makeEntry({ id: 200, started_at: 500 })]);
      await loadMore();
      expect(sessions.value).toHaveLength(101);
      expect(sessions.value[100].id).toBe(200);

      const lastCallUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(lastCallUrl).toContain(`before=${1000 - 99}`);
    },
  );

  it('loadMore does nothing once hasMore is false', async () => {
    mockFetchOnce([makeEntry({ id: 1 })]);
    const { loadInitial, loadMore } = useSessionLog();
    await loadInitial();
    vi.resetAllMocks();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    await loadMore();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('setCategoryFilter resets the list and reloads', async () => {
    mockFetchOnce([makeEntry({ id: 1 })]);
    const { sessions, categoryFilter, setCategoryFilter } = useSessionLog();
    await setCategoryFilter(5);
    expect(categoryFilter.value).toBe(5);
    expect(sessions.value).toHaveLength(1);
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain('category_id=5');
  });

  it(
    'editableRangeFor delegates to the edit policy' +
      ' (shrink-only before any edit)',
    () => {
      const { editableRangeFor } = useSessionLog();
      const entry = makeEntry({ id: 42, started_at: 1000, ended_at: 2000 });
      expect(editableRangeFor(entry)).toEqual({ min: 1000, max: 2000 });
    },
  );

  it(
    'editSession updates the row in place and records lastEdited',
    async () => {
      mockFetchOnce([
        makeEntry({ id: 1, started_at: 1000, ended_at: 2000 }),
      ]);
      const { sessions, loadInitial, editSession, editableRangeFor } =
        useSessionLog();
      await loadInitial();

      mockFetchOnce(makeEntry({ id: 1, started_at: 1000, ended_at: 1500 }));
      await editSession(sessions.value[0], 1500);
      expect(sessions.value[0].ended_at).toBe(1500);

      // Now the "last chance" range should widen back to the original 2000
      expect(editableRangeFor(sessions.value[0])).toEqual({
        min: 1000,
        max: 2000,
      });
    },
  );

  it('deleteSession removes the row from the list', async () => {
    mockFetchOnce([makeEntry({ id: 1 })]);
    const { sessions, loadInitial, deleteSession } = useSessionLog();
    await loadInitial();

    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 204 } as Response);
    await deleteSession(sessions.value[0]);
    expect(sessions.value).toHaveLength(0);
  });
});
