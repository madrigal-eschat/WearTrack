import { describe, it, expect, beforeAll } from 'vitest'
import db from '../../src/db/index.js'
import { runMigrations } from '../../src/db/migrations/index.js'
import { sessionStore } from '../../src/db/stores/session-store.js'
import { categoryStore } from '../../src/db/stores/category-store.js'
import { statsStore } from '../../src/db/stores/stats-store.js'

beforeAll(() => {
  runMigrations()
  categoryStore.create({
    name: 'C',
    icon: 'x',
    initial_target_wear_duration_seconds: 900,
    initial_max_wear_duration_seconds: 1800,
    rest_multiplier: 2,
    minimum_rest: 86400,
    risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
    break_decay_multiplier: 0.91,
    break_grace_time: 86400,
  })
  db.prepare(
    `INSERT INTO items (category_id, name, color, difficulty_multiplier)
     VALUES (1,'i','#fff',1)`,
  ).run()
})

const rawCat = () =>
  db.prepare('SELECT * FROM categories WHERE id = 1').get() as never
const item = { difficulty_multiplier: 1 }

describe('sessionStore.start', () => {
  it('writes target and max at start (first session = initial values)', () => {
    const s = sessionStore.start(1, rawCat(), item, 1000)
    expect(s.target_wear_seconds).toBe(900)
    expect(s.max_wear_seconds).toBe(1800)
    expect(s.ended_at).toBeNull()
  })
})

describe('sessionStore.end', () => {
  it(
    'derives elapsed and writes rest_seconds without changing ' + 'target/max',
    () => {
      const started = sessionStore.start(1, rawCat(), item, 10_000)
      const ended = sessionStore.end(started, rawCat(), 10_000 + 1800)
      expect(ended.target_wear_seconds).toBe(900) // unchanged
      expect(ended.max_wear_seconds).toBe(1800) // unchanged
      // elapsed 1800, weight 0, mult 2 => 3600, floored to minimum_rest 86400
      expect(ended.rest_seconds).toBe(86400)
    },
  )
})

describe('sessionStore rotation category behaviour', () => {
  it(
    'start() uses the fixed target and null max for a rotation ' + 'category',
    () => {
      const rotationCat = categoryStore.create({
        name: 'Rotation',
        icon: 'x',
        initial_target_wear_duration_seconds: 57600, // 16h "all day"
        initial_max_wear_duration_seconds: null,
        rest_multiplier: 2,
        minimum_rest: 0,
        risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
        break_decay_multiplier: 0.91,
        break_grace_time: 86400,
        type: 'rotation',
        consecutive_wear_days: 1,
      })
      db.prepare(
        `INSERT INTO items (category_id, name, color, difficulty_multiplier)
     VALUES (?,'ri','#fff',1)`,
      ).run(rotationCat.id)
      const rawRotationCat = db
        .prepare('SELECT * FROM categories WHERE id = ?')
        .get(rotationCat.id) as never
      const rotationItemId = (
        db
          .prepare('SELECT id FROM items WHERE category_id = ?')
          .get(rotationCat.id) as { id: number }
      ).id

      const s = sessionStore.start(rotationItemId, rawRotationCat, item, 1000)
      expect(s.target_wear_seconds).toBe(57600)
      expect(s.max_wear_seconds).toBeNull()
    },
  )

  it('end() leaves rest_seconds null for a rotation category', () => {
    const rotationCat = categoryStore.create({
      name: 'Rotation2',
      icon: 'x',
      initial_target_wear_duration_seconds: 57600,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 2,
      minimum_rest: 0,
      risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
      break_decay_multiplier: 0.91,
      break_grace_time: 86400,
      type: 'rotation',
      consecutive_wear_days: 1,
    })
    db.prepare(
      `INSERT INTO items (category_id, name, color, difficulty_multiplier)
     VALUES (?,'ri2','#fff',1)`,
    ).run(rotationCat.id)
    const rawRotationCat = db
      .prepare('SELECT * FROM categories WHERE id = ?')
      .get(rotationCat.id) as never
    const rotationItemId = (
      db
        .prepare('SELECT id FROM items WHERE category_id = ? AND name = ?')
        .get(rotationCat.id, 'ri2') as { id: number }
    ).id

    const started = sessionStore.start(
      rotationItemId,
      rawRotationCat,
      item,
      20_000,
    )
    const ended = sessionStore.end(started, rawRotationCat, 20_000 + 57600)
    expect(ended.rest_seconds).toBeNull()
    expect(ended.target_wear_seconds).toBe(57600)
  })
})

describe('sessionStore.findRecentInCategory', () => {
  it('returns sessions newest first, limited', () => {
    const cat = categoryStore.create({
      name: 'Recent',
      icon: 'x',
      initial_target_wear_duration_seconds: 100,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 1,
      minimum_rest: 0,
      risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
      break_decay_multiplier: 0.91,
      break_grace_time: 86400,
      type: 'rotation',
      consecutive_wear_days: 1,
    })
    db.prepare(
      `INSERT INTO items (category_id, name, color, difficulty_multiplier)
     VALUES (?,'ra','#fff',1)`,
    ).run(cat.id)
    db.prepare(
      `INSERT INTO items (category_id, name, color, difficulty_multiplier)
     VALUES (?,'rb','#fff',1)`,
    ).run(cat.id)
    const rawCat2 = db
      .prepare('SELECT * FROM categories WHERE id = ?')
      .get(cat.id) as never
    const itemA = (
      db
        .prepare('SELECT id FROM items WHERE category_id = ? AND name = ?')
        .get(cat.id, 'ra') as { id: number }
    ).id
    const itemB = (
      db
        .prepare('SELECT id FROM items WHERE category_id = ? AND name = ?')
        .get(cat.id, 'rb') as { id: number }
    ).id

    const s1 = sessionStore.start(itemA, rawCat2, item, 1_000_000)
    sessionStore.end(s1, rawCat2, 1_000_100)
    const s2 = sessionStore.start(itemB, rawCat2, item, 1_000_200)
    sessionStore.end(s2, rawCat2, 1_000_300)

    const recent = sessionStore.findRecentInCategory(cat.id, 10)
    expect(recent.map((r) => r.item_id)).toEqual([itemB, itemA])
  })
})

describe('sessionStore.findSessionStartedTodayInCategory', () => {
  it(
    'finds a session that started on/after dayStart in the category ' +
      '(any item)',
    () => {
      const cat = categoryStore.create({
        name: 'DailyCapFind',
        icon: 'x',
        initial_target_wear_duration_seconds: 100,
        initial_max_wear_duration_seconds: null,
        rest_multiplier: 1,
        minimum_rest: 0,
        risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
        break_decay_multiplier: 0.91,
        break_grace_time: 86400,
        type: 'rotation',
        consecutive_wear_days: 1,
      })
      db.prepare(
        `INSERT INTO items (category_id, name, color, difficulty_multiplier)
     VALUES (?,'dcf','#fff',1)`,
      ).run(cat.id)
      const rawCat = db
        .prepare('SELECT * FROM categories WHERE id = ?')
        .get(cat.id) as never
      const itemId = (
        db
          .prepare('SELECT id FROM items WHERE category_id = ? AND name = ?')
          .get(cat.id, 'dcf') as { id: number }
      ).id

      const dayStart = 2_000_000
      // started 1h into the day
      const s = sessionStore.start(itemId, rawCat, item, dayStart + 3600)
      sessionStore.end(s, rawCat, dayStart + 3700)

      const found = sessionStore.findSessionStartedTodayInCategory(
        cat.id,
        dayStart,
      )
      expect(found).toBeDefined()
      expect(found!.started_at).toBe(dayStart + 3600)
    },
  )

  it('returns undefined when the only session started before dayStart', () => {
    const cat = categoryStore.create({
      name: 'DailyCapFind2',
      icon: 'x',
      initial_target_wear_duration_seconds: 100,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 1,
      minimum_rest: 0,
      risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
      break_decay_multiplier: 0.91,
      break_grace_time: 86400,
      type: 'rotation',
      consecutive_wear_days: 1,
    })
    db.prepare(
      `INSERT INTO items (category_id, name, color, difficulty_multiplier)
     VALUES (?,'dcf2','#fff',1)`,
    ).run(cat.id)
    const rawCat = db
      .prepare('SELECT * FROM categories WHERE id = ?')
      .get(cat.id) as never
    const itemId = (
      db
        .prepare('SELECT id FROM items WHERE category_id = ? AND name = ?')
        .get(cat.id, 'dcf2') as { id: number }
    ).id

    const dayStart = 5_000_000
    // started before dayStart (yesterday)
    const s = sessionStore.start(itemId, rawCat, item, dayStart - 3600)
    sessionStore.end(s, rawCat, dayStart - 3500)

    expect(
      sessionStore.findSessionStartedTodayInCategory(cat.id, dayStart),
    ).toBeUndefined()
  })
})

// Fresh category + items per test so timestamps/stats never interact.
function makeCategory(name: string, overrides: Record<string, unknown> = {}) {
  const cat = categoryStore.create({
    name,
    icon: 'x',
    initial_target_wear_duration_seconds: 900,
    initial_max_wear_duration_seconds: 1800,
    rest_multiplier: 2,
    minimum_rest: 0,
    risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
    break_decay_multiplier: 0.91,
    break_grace_time: 86400,
    ...overrides,
  })
  const addItem = (itemName: string): number => {
    const id = db
      .prepare(
        `INSERT INTO items (category_id, name, color, difficulty_multiplier)
         VALUES (?, ?, '#fff', 1)`,
      )
      .run(cat.id, itemName).lastInsertRowid as number
    statsStore.initItem(id)
    return id
  }
  statsStore.initCategory(cat.id)
  const raw = db
    .prepare('SELECT * FROM categories WHERE id = ?')
    .get(cat.id) as never
  return { id: cat.id, raw, addItem }
}

function completed(
  cat: ReturnType<typeof makeCategory>,
  itemId: number,
  startedAt: number,
  endedAt: number,
) {
  const s = sessionStore.start(itemId, cat.raw, item, startedAt)
  return sessionStore.end(s, cat.raw, endedAt)
}

describe('sessionStore.findOverlappingInCategory', () => {
  it('finds a session whose span intersects, on any item', () => {
    const cat = makeCategory('Overlap Find')
    const a = cat.addItem('a')
    const b = cat.addItem('b')
    const existing = completed(cat, a, 1000, 2000)

    const hit = sessionStore.findOverlappingInCategory(cat.id, -1, 1500, 1800)
    expect(hit?.session_id).toBe(existing.id)
    expect(hit?.item_id).toBe(a)
    expect(
      sessionStore.findOverlappingInCategory(cat.id, -1, 1900, 3000),
    ).toBeDefined()
    expect(b).not.toBe(a)
  })

  it('treats touching boundaries as non-overlapping', () => {
    const cat = makeCategory('Overlap Touch')
    completed(cat, cat.addItem('a'), 1000, 2000)

    expect(
      sessionStore.findOverlappingInCategory(cat.id, -1, 2000, 3000),
    ).toBeUndefined()
    expect(
      sessionStore.findOverlappingInCategory(cat.id, -1, 500, 1000),
    ).toBeUndefined()
  })

  it('treats an open session as extending indefinitely', () => {
    const cat = makeCategory('Overlap Open')
    const open = sessionStore.start(cat.addItem('a'), cat.raw, item, 5000)

    const hit = sessionStore.findOverlappingInCategory(
      cat.id,
      -1,
      9_000_000,
      9_000_100,
    )
    expect(hit?.session_id).toBe(open.id)
    expect(
      sessionStore.findOverlappingInCategory(cat.id, -1, 100, 5000),
    ).toBeUndefined()
  })

  it('excludes the given session id', () => {
    const cat = makeCategory('Overlap Exclude')
    const only = completed(cat, cat.addItem('a'), 1000, 2000)

    expect(
      sessionStore.findOverlappingInCategory(cat.id, only.id, 1000, 2000),
    ).toBeUndefined()
  })

  it('ignores sessions in other categories', () => {
    const cat = makeCategory('Overlap Mine')
    const other = makeCategory('Overlap Other')
    completed(other, other.addItem('a'), 1000, 2000)
    cat.addItem('b')

    expect(
      sessionStore.findOverlappingInCategory(cat.id, -1, 1000, 2000),
    ).toBeUndefined()
  })
})

describe('sessionStore.updateTimes', () => {
  it('writes start and end and recomputes rest_seconds', () => {
    const cat = makeCategory('Update Rest')
    const itemId = cat.addItem('a')
    const s = completed(cat, itemId, 10_000, 11_000)
    // rest = elapsed * rest_multiplier (2), minimum_rest 0
    expect(s.rest_seconds).toBe(2000)

    const updated = sessionStore.updateTimes(s, cat.raw, 10_500, 11_000)
    expect(updated.started_at).toBe(10_500)
    expect(updated.ended_at).toBe(11_000)
    expect(updated.rest_seconds).toBe(1000)
  })

  it('leaves target/max as set at start', () => {
    const cat = makeCategory('Update Target')
    const s = completed(cat, cat.addItem('a'), 10_000, 11_000)

    const updated = sessionStore.updateTimes(s, cat.raw, 9_000, 12_000)
    expect(updated.target_wear_seconds).toBe(s.target_wear_seconds)
    expect(updated.max_wear_seconds).toBe(s.max_wear_seconds)
  })

  it('recomputes item and category stats from the new times', () => {
    const cat = makeCategory('Update Stats')
    const itemId = cat.addItem('a')
    const s = completed(cat, itemId, 10_000, 11_000)
    expect(statsStore.findForItem(itemId)!.total_wear_seconds).toBe(1000)

    sessionStore.updateTimes(s, cat.raw, 9_000, 11_000)

    const itemStats = statsStore.findForItem(itemId)!
    expect(itemStats.total_wear_seconds).toBe(2000)
    expect(itemStats.max_single_session_wear_seconds).toBe(2000)
    const catStats = statsStore.findForCategory(cat.id)!
    expect(catStats.total_wear_seconds).toBe(2000)
    expect(catStats.session_count).toBe(1)
  })

  it('leaves rest_seconds null for a rotation category', () => {
    const cat = makeCategory('Update Rotation', {
      type: 'rotation',
      initial_max_wear_duration_seconds: null,
      consecutive_wear_days: 1,
    })
    const s = completed(cat, cat.addItem('a'), 10_000, 11_000)

    const updated = sessionStore.updateTimes(s, cat.raw, 9_000, 11_000)
    expect(updated.rest_seconds).toBeNull()
  })

  it('does not touch rest or stats for an injury-ended session', () => {
    const cat = makeCategory('Update Injury')
    const itemId = cat.addItem('a')
    const s = sessionStore.start(itemId, cat.raw, item, 10_000)
    sessionStore.endWithInjury(s.id, 11_000)
    const injured = sessionStore.find(s.id)!

    const updated = sessionStore.updateTimes(injured, cat.raw, 9_000, 12_000)
    expect(updated.started_at).toBe(9_000)
    expect(updated.ended_at).toBe(12_000)
    expect(updated.rest_seconds).toBeNull()
    expect(statsStore.findForItem(itemId)!.session_count).toBe(0)
  })

  const DAY = Date.UTC(2024, 5, 10) / 1000
  const dayRows = (catId: number, itemId: number) =>
    db
      .prepare(
        'SELECT day FROM session_day_index WHERE category_id = ? ' +
          'AND item_id = ? ORDER BY day',
      )
      .all(catId, itemId)

  it('moves the day index row when the start day changes', () => {
    const cat = makeCategory('Update Day Move')
    const itemId = cat.addItem('a')
    const s = completed(cat, itemId, DAY + 43_200, DAY + 46_800)
    expect(dayRows(cat.id, itemId)).toEqual([{ day: '2024-06-10' }])

    sessionStore.updateTimes(s, cat.raw, DAY - 3600, DAY + 46_800)

    expect(dayRows(cat.id, itemId)).toEqual([{ day: '2024-06-09' }])
  })

  it('keeps the old day indexed while a sibling session remains', () => {
    const cat = makeCategory('Update Day Sibling')
    const itemId = cat.addItem('a')
    const s = completed(cat, itemId, DAY + 43_200, DAY + 46_800)
    completed(cat, itemId, DAY + 50_000, DAY + 53_600)

    sessionStore.updateTimes(s, cat.raw, DAY - 3600, DAY + 46_800)

    expect(dayRows(cat.id, itemId)).toEqual([
      { day: '2024-06-09' },
      { day: '2024-06-10' },
    ])
  })

  it('leaves the day index alone when the start day is unchanged', () => {
    const cat = makeCategory('Update Day Same')
    const itemId = cat.addItem('a')
    const s = completed(cat, itemId, DAY + 43_200, DAY + 46_800)

    sessionStore.updateTimes(s, cat.raw, DAY + 40_000, DAY + 46_800)

    expect(dayRows(cat.id, itemId)).toEqual([{ day: '2024-06-10' }])
  })
})
