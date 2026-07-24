export type BucketGranularity = 'day' | 'week' | 'month' | 'year';

export interface DateIndexEntry {
  granularity: BucketGranularity;
  label: string;
  /**
   * `before` cursor to pass to the sessions API: start of the day after
   * this bucket's range ends (unix seconds, UTC).
   */
  cursor: number;
}

function parseDayUTC(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function toDayString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function startOfWeekUTC(date: Date): Date {
  const day = date.getUTCDay() // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day // Monday-first
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + diff)
  return d
}

/**
 * Buckets 'YYYY-MM-DD' day strings (days that have session data) into a jump
 * index: last 14 days daily (offsets 0-13), weeks 3-8 back weekly
 * (Monday-labelled, offsets 14-55, i.e. exactly 6 weeks / 42 days), 12 months
 * back monthly (from offset 56 up to the 12-month mark), older than 12 months
 * yearly. Nearest granularity wins — no day is covered by more than one tier.
 * Empty buckets are omitted. `today` is injectable for deterministic tests.
 */
export function buildDateIndex(
  days: string[],
  today: Date = new Date(),
): DateIndexEntry[] {
  const todayUTC = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  ))
  const dayDates = days.map(parseDayUTC)

  const dailyStart = new Date(todayUTC)
  // last 14 days, inclusive of today
  dailyStart.setUTCDate(dailyStart.getUTCDate() - 13)
  const weeklyStart = new Date(todayUTC)
  weeklyStart.setUTCDate(weeklyStart.getUTCDate() - 56) // 8 weeks back
  const monthlyStart = new Date(todayUTC)
  monthlyStart.setUTCMonth(monthlyStart.getUTCMonth() - 12)

  const entries: DateIndexEntry[] = []

  // Daily tier: last 14 days, newest first
  for (let i = 0; i < 14; i++) {
    const d = new Date(todayUTC)
    d.setUTCDate(d.getUTCDate() - i)
    if (dayDates.some((x) => x.getTime() === d.getTime())) {
      const cursor = new Date(d)
      cursor.setUTCDate(cursor.getUTCDate() + 1)
      entries.push({
        granularity: 'day',
        label: toDayString(d),
        cursor: cursor.getTime() / 1000,
      })
    }
  }

  // Weekly tier: Mondays for days in (weeklyStart, dailyStart) — weeklyStart
  // itself is the weekly/monthly seam and belongs to the monthly tier.
  const seenWeeks = new Set<string>()
  for (const d of dayDates) {
    if (d <= weeklyStart || d >= dailyStart) {
      continue
    }
    seenWeeks.add(toDayString(startOfWeekUTC(d)))
  }
  for (const key of [...seenWeeks].sort().reverse()) {
    const weekStart = parseDayUTC(key)
    const cursor = new Date(weekStart)
    cursor.setUTCDate(cursor.getUTCDate() + 7)
    entries.push({
      granularity: 'week',
      label: key,
      cursor: cursor.getTime() / 1000,
    })
  }

  // Monthly tier: months for days in [monthlyStart, weeklyStart]
  const seenMonths = new Set<string>()
  for (const d of dayDates) {
    if (d < monthlyStart || d > weeklyStart) {
      continue
    }
    const month = String(d.getUTCMonth() + 1).padStart(2, '0')
    seenMonths.add(`${d.getUTCFullYear()}-${month}`)
  }
  for (const key of [...seenMonths].sort().reverse()) {
    const [y, m] = key.split('-').map(Number)
    entries.push({
      granularity: 'month',
      label: key,
      cursor: Date.UTC(y, m, 1) / 1000,
    })
  }

  // Yearly tier: days older than monthlyStart
  const seenYears = new Set<number>()
  for (const d of dayDates) {
    if (d >= monthlyStart) {
      continue
    }
    seenYears.add(d.getUTCFullYear())
  }
  for (const y of [...seenYears].sort().reverse()) {
    entries.push({
      granularity: 'year',
      label: String(y),
      cursor: Date.UTC(y + 1, 0, 1) / 1000,
    })
  }

  return entries
}
