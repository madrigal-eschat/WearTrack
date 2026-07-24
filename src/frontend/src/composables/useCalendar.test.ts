import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCalendar } from './useCalendar'
import type { Session } from './useWear'

// Helper to create a unix timestamp for a given date/time (local time)
function ts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  min = 0,
): number {
  const date = new Date(year, month - 1, day, hour, min)
  return Math.floor(date.getTime() / 1000)
}

// Helper to create a minimal Session fixture
function makeSession(
  id: number,
  started_at: number,
  ended_at: number | null,
): Session {
  return {
    id,
    item_id: 1,
    started_at,
    ended_at,
    target_wear_seconds: 3600,
    max_wear_seconds: null,
    rest_seconds: null,
    ended_in_injury: 0,
  }
}

// Known Monday for deterministic tests: 2024-01-08
const MONDAY = new Date(2024, 0, 8, 0, 0, 0, 0)

// Inject sessions by mocking fetch and calling loadWeekSessions
async function injectSessions(sessions: Session[]) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => sessions,
  } as Response)
  const { loadWeekSessions } = useCalendar()
  await loadWeekSessions()
}

describe('useCalendar – weekStart is always a Monday at midnight', () => {
  it('initial weekStart is a Monday (getDay() === 1) at midnight', () => {
    const { weekStart } = useCalendar()
    expect(weekStart.value.getDay()).toBe(1)
    expect(weekStart.value.getHours()).toBe(0)
    expect(weekStart.value.getMinutes()).toBe(0)
    expect(weekStart.value.getSeconds()).toBe(0)
  })
})

describe('useCalendar – weekDays structure', () => {
  beforeEach(() => {
    const { weekStart } = useCalendar()
    weekStart.value = new Date(MONDAY)
  })

  it('returns exactly 7 entries', () => {
    const { weekDays } = useCalendar()
    expect(weekDays.value).toHaveLength(7)
  })

  it('labels are Mon through Sun in order', () => {
    const { weekDays } = useCalendar()
    expect(weekDays.value.map((d) => d.label)).toEqual([
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    ])
  })

  it('dayNum values span the correct calendar days from weekStart', () => {
    const { weekDays } = useCalendar()
    // MONDAY = Jan 8, so Jan 8–14
    expect(weekDays.value[0].dayNum).toBe(8)
    expect(weekDays.value[6].dayNum).toBe(14)
  })
})

describe('useCalendar – session filtering in weekDays', () => {
  beforeEach(() => {
    const { weekStart } = useCalendar()
    weekStart.value = new Date(MONDAY)
    vi.resetAllMocks()
  })

  it('a completed session within a day is counted in that day', async () => {
    await injectSessions([
      makeSession(1, ts(2024, 1, 8, 10, 0), ts(2024, 1, 8, 11, 0)),
    ])
    const { weekDays } = useCalendar()
    expect(weekDays.value[0].sessionCount).toBe(1)
    expect(weekDays.value[0].totalWearSeconds).toBe(3600)
  })

  it(
    'an open session (ended_at === null) is excluded from day totals',
    async () => {
      await injectSessions([
        makeSession(1, ts(2024, 1, 8, 10, 0), null),
      ])
      const { weekDays } = useCalendar()
      expect(weekDays.value[0].sessionCount).toBe(0)
      expect(weekDays.value[0].totalWearSeconds).toBe(0)
    },
  )

  it(
    'a session starting at exactly dayStart (midnight) is included',
    async () => {
      // started_at === dayStart boundary — filter is `>= dayStart` so
      // this is included
      const start = ts(2024, 1, 8, 0, 0)
      await injectSessions([makeSession(1, start, start + 1800)])
      const { weekDays } = useCalendar()
      expect(weekDays.value[0].sessionCount).toBe(1)
    },
  )

  it('a session from the day before the week start is excluded', async () => {
    // Sunday Jan 7 2024 – outside the week
    await injectSessions([
      makeSession(1, ts(2024, 1, 7, 20, 0), ts(2024, 1, 7, 22, 0)),
    ])
    const { weekDays } = useCalendar()
    const total = weekDays.value.reduce((sum, d) => sum + d.sessionCount, 0)
    expect(total).toBe(0)
  })

  it(
    'a session starting at Tuesday midnight is in Tuesday, not Monday',
    async () => {
      const start = ts(2024, 1, 9, 0, 0) // Tuesday midnight, dayStart of Tue
      await injectSessions([makeSession(1, start, start + 3600)])
      const { weekDays } = useCalendar()
      expect(weekDays.value[0].sessionCount).toBe(0) // Monday
      expect(weekDays.value[1].sessionCount).toBe(1) // Tuesday
    },
  )

  it('multiple sessions on different days are counted correctly', async () => {
    await injectSessions([
      makeSession(1, ts(2024, 1, 8, 9, 0), ts(2024, 1, 8, 10, 0)), // Mon 1h
      // Wed 1h30m
      makeSession(2, ts(2024, 1, 10, 14, 0), ts(2024, 1, 10, 15, 30)),
    ])
    const { weekDays } = useCalendar()
    expect(weekDays.value[0].sessionCount).toBe(1)
    expect(weekDays.value[0].totalWearSeconds).toBe(3600)
    expect(weekDays.value[2].sessionCount).toBe(1)
    expect(weekDays.value[2].totalWearSeconds).toBe(5400)
    // Other days untouched
    expect(weekDays.value[1].sessionCount).toBe(0)
  })
})

describe('useCalendar – formatWeekRange', () => {
  it('returns a non-empty string', () => {
    const { formatWeekRange } = useCalendar()
    expect(formatWeekRange()).toBeTruthy()
  })

  it('contains an en-dash separator', () => {
    const { formatWeekRange } = useCalendar()
    expect(formatWeekRange()).toMatch(/–/)
  })

  it('reflects weekStart: Mon 8 Jan 2024 → "8 Jan – 14 Jan"', () => {
    const { weekStart, formatWeekRange } = useCalendar()
    weekStart.value = new Date(MONDAY)
    const range = formatWeekRange()
    expect(range).toContain('8 Jan')
    expect(range).toContain('14 Jan')
  })

  it('end date advances by 6 days from weekStart', () => {
    const { weekStart, formatWeekRange } = useCalendar()
    // Set to Mon 15 Jan 2024
    weekStart.value = new Date(2024, 0, 15, 0, 0, 0, 0)
    const range = formatWeekRange()
    expect(range).toContain('15 Jan')
    expect(range).toContain('21 Jan')
  })
})
