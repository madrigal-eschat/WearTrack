import { describe, it, expect } from 'vitest';
import { buildDateIndex } from './sessionDateIndex';

// Fixed "today" for deterministic tests: Wed 2026-07-15 (UTC)
const TODAY = new Date(Date.UTC(2026, 6, 15));

describe('buildDateIndex', () => {
  it('returns no entries when there are no days with data', () => {
    expect(buildDateIndex([], TODAY)).toEqual([]);
  });

  it('creates a daily entry for a day within the last 14 days', () => {
    const entries = buildDateIndex(['2026-07-14'], TODAY);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      granularity: 'day',
      label: '2026-07-14',
    });
  });

  it('daily-tier cursor is the start of the day after the entry', () => {
    const entries = buildDateIndex(['2026-07-14'], TODAY);
    const expectedCursor = Date.UTC(2026, 6, 15) / 1000;
    expect(entries[0].cursor).toBe(expectedCursor);
  });

  it(
    'a day older than 14 days but within 8 weeks becomes a weekly entry,' +
      ' not daily',
    () => {
      // 20 days back = 2026-06-25 (a Thursday)
      const entries = buildDateIndex(['2026-06-25'], TODAY);
      expect(entries).toHaveLength(1);
      expect(entries[0].granularity).toBe('week');
    },
  );

  it('weekly entries are labelled by the Monday of that week', () => {
    // 2026-06-25 is a Thursday; that week's Monday is 2026-06-22
    const entries = buildDateIndex(['2026-06-25'], TODAY);
    expect(entries[0].label).toBe('2026-06-22');
  });

  it(
    'two days in the same week 3-8 weeks back collapse into one weekly' +
      ' entry',
    () => {
      const entries = buildDateIndex(['2026-06-22', '2026-06-25'], TODAY);
      const weekEntries = entries.filter((e) => e.granularity === 'week');
      expect(weekEntries).toHaveLength(1);
    },
  );

  it(
    'a day older than 8 weeks but within 12 months becomes a monthly entry',
    () => {
      // ~4 months back
      const entries = buildDateIndex(['2026-03-10'], TODAY);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        granularity: 'month',
        label: '2026-03',
      });
    },
  );

  it('a day older than 12 months becomes a yearly entry', () => {
    const entries = buildDateIndex(['2024-01-05'], TODAY);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ granularity: 'year', label: '2024' });
  });

  it('entries across all four tiers are ordered newest-first', () => {
    const entries = buildDateIndex(
      ['2026-07-14', '2026-06-25', '2026-03-10', '2024-01-05'],
      TODAY,
    );
    expect(entries.map((e) => e.granularity)).toEqual([
      'day',
      'week',
      'month',
      'year',
    ]);
  });

  it('a day exactly 13 days back is the last DAILY day', () => {
    // 2026-07-02 = today - 13 days
    const entries = buildDateIndex(['2026-07-02'], TODAY);
    expect(entries).toHaveLength(1);
    expect(entries[0].granularity).toBe('day');
  });

  it(
    'a day exactly 14 days back is the first WEEKLY day' +
      ' (daily/weekly seam)',
    () => {
      // 2026-07-01 = today - 14 days
      const entries = buildDateIndex(['2026-07-01'], TODAY);
      expect(entries).toHaveLength(1);
      expect(entries[0].granularity).toBe('week');
    },
  );

  it('a day exactly 55 days back is the last WEEKLY day', () => {
    // 2026-05-21 = today - 55 days
    const entries = buildDateIndex(['2026-05-21'], TODAY);
    expect(entries).toHaveLength(1);
    expect(entries[0].granularity).toBe('week');
  });

  it(
    'a day exactly 56 days back is the first MONTHLY day' +
      ' (weekly/monthly seam)',
    () => {
      // 2026-05-20 = today - 56 days
      const entries = buildDateIndex(['2026-05-20'], TODAY);
      expect(entries).toHaveLength(1);
      expect(entries[0].granularity).toBe('month');
    },
  );

  it('the day the monthly cutoff lands on (12 months back) is MONTHLY', () => {
    // monthlyStart = today with month -12 = 2025-07-15
    const entries = buildDateIndex(['2025-07-15'], TODAY);
    expect(entries).toHaveLength(1);
    expect(entries[0].granularity).toBe('month');
  });

  it(
    'one day before the monthly cutoff (12 months + 1 day back) is YEARLY',
    () => {
      const entries = buildDateIndex(['2025-07-14'], TODAY);
      expect(entries).toHaveLength(1);
      expect(entries[0].granularity).toBe('year');
    },
  );

  it('monthly cursor is the start of the following month', () => {
    const entries = buildDateIndex(['2026-03-10'], TODAY);
    expect(entries[0].cursor).toBe(Date.UTC(2026, 3, 1) / 1000);
  });

  it('yearly cursor is the start of the following year', () => {
    const entries = buildDateIndex(['2024-01-05'], TODAY);
    expect(entries[0].cursor).toBe(Date.UTC(2025, 0, 1) / 1000);
  });
});
