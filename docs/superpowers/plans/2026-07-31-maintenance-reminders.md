# Periodic Maintenance Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each category define reminder schedules (interval + text) that fire as push notifications while a session is active, robust to server restarts.

**Architecture:** New `reminder_schedules` (config) and `reminder_state` (per-session fired-count) tables. A pure `computeReminderDueCount()` function drives both the events poller (which emits a `reminder_due` event when due count increases) and is unit-tested in isolation. The existing event-bus → notifications-runner pipeline delivers the push notification. Frontend gets a flat `/api/reminder-schedules` CRUD resource, a composable, and a `k-sheet` management UI wired into the existing category row.

**Tech Stack:** Hono (backend router), better-sqlite3, Vitest, Vue 3 `<script setup>`, Konsta UI (`k-sheet`, `k-list-item`, `k-button`).

## Global Constraints

- `remind_each_seconds` must be `>= 60` (poller ticks every 30s).
- Restart-robust: no "next fire time" is ever persisted — only `fired_count`, recomputed from `session.started_at` each tick.
- A long-downtime catch-up collapses to exactly one notification (never a backlog of missed ones).
- Rotation categories (`category.type === 'rotation'`) always have `session.max_wear_seconds === null`, so they use the target-only branch of the math with no special-casing.
- Notification title: `Maintenance for ${category_name}`; body: the schedule's `text`.
- Follow existing store/controller conventions exactly (see `category-store.ts`, `items.ts`) — flat resource, `ValidationError`/`NotFoundError` from `middleware/errors.js`.

---

### Task 1: Migration + DB stores

> **Post-execution correction:** this task was written against a stale copy
> of `main` and assumed migration version 12 was free. It was not — `main`
> already has a released `012_drop_mqtt_config.ts`. The actual migration
> shipped as **`013_reminder_schedules.ts` / version 13**, with
> `012_drop_mqtt_config.ts` left untouched. Every `012_reminder_schedules`
> reference below is historical; do not copy the number when planning
> migration 014+.

**Files:**
- Create: `src/backend/src/db/migrations/012_reminder_schedules.ts`
- Modify: `src/backend/src/db/migrations/index.ts`
- Create: `src/backend/src/db/stores/reminder-schedule-store.ts`
- Create: `src/backend/src/db/stores/reminder-state-store.ts`
- Test: `src/backend/tests/db/migration-012.test.ts`
- Test: `src/backend/tests/db/reminder-schedule-store.test.ts`
- Test: `src/backend/tests/db/reminder-state-store.test.ts`

**Interfaces:**
- Produces: `reminderScheduleStore: { findAllForCategory(categoryId: number): ReminderSchedule[]; find(id: number): ReminderSchedule | undefined; create(data: ReminderScheduleCreate): ReminderSchedule; update(id: number, data: ReminderScheduleUpdate): ReminderSchedule; delete(id: number): void }`
- Produces: `interface ReminderSchedule { id: number; category_id: number; remind_each_seconds: number; text: string }`
- Produces: `reminderStateStore: { get(sessionId: number, scheduleId: number): ReminderStateRow | undefined; upsert(sessionId: number, scheduleId: number, firedCount: number): void }`
- Produces: `interface ReminderStateRow { session_id: number; schedule_id: number; fired_count: number }`

- [ ] **Step 1: Write the failing migration test**

```ts
// src/backend/tests/db/migration-012.test.ts
import { describe, it, expect } from 'vitest'
import { runMigrations } from '../../src/db/migrations/index.js'
import { prepare } from '../../src/db/index.js'

describe('migration 012: reminder schedules', () => {
  it('creates reminder_schedules and reminder_state tables', () => {
    runMigrations()
    const tables = prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    ).all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('reminder_schedules')
    expect(names).toContain('reminder_state')
  })

  it('reminder_state enforces one row per (session_id, schedule_id)', () => {
    runMigrations()
    prepare(
      `INSERT INTO categories
         (name, icon, rest_multiplier, risk_levels, break_decay_multiplier,
          initial_target_wear_duration_seconds,
          initial_max_wear_duration_seconds, break_grace_time, minimum_rest)
       VALUES ('Migration012 Test', 'x', 2, '[]', 0.91, 900, 1800, 86400,
               86400)`,
    ).run()
    const categoryId = (
      prepare(`SELECT id FROM categories WHERE name = 'Migration012 Test'`)
        .get() as { id: number }
    ).id
    prepare(
      `INSERT INTO reminder_schedules (category_id, remind_each_seconds, text)
       VALUES (?, 3600, 'Change strap')`,
    ).run(categoryId)
    const scheduleId = (
      prepare(`SELECT id FROM reminder_schedules WHERE category_id = ?`)
        .get(categoryId) as { id: number }
    ).id
    prepare(
      `INSERT INTO items (category_id, name, color) VALUES (?, 'Item', '#fff')`,
    ).run(categoryId)
    const itemId = (
      prepare(`SELECT id FROM items WHERE category_id = ?`).get(categoryId) as
        { id: number }
    ).id
    prepare(
      `INSERT INTO sessions (item_id, started_at, target_wear_seconds)
       VALUES (?, 0, 900)`,
    ).run(itemId)
    const sessionId = (
      prepare(`SELECT id FROM sessions WHERE item_id = ?`).get(itemId) as
        { id: number }
    ).id
    prepare(
      `INSERT INTO reminder_state (session_id, schedule_id, fired_count)
       VALUES (?, ?, 1)`,
    ).run(sessionId, scheduleId)
    expect(() =>
      prepare(
        `INSERT INTO reminder_state (session_id, schedule_id, fired_count)
         VALUES (?, ?, 2)`,
      ).run(sessionId, scheduleId),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && npx vitest run tests/db/migration-012.test.ts`
Expected: FAIL — `no such table: reminder_schedules` (migration doesn't exist yet).

- [ ] **Step 3: Write the migration**

```ts
// src/backend/src/db/migrations/012_reminder_schedules.ts
import { dbExport } from '../index.js'

export default function runMigration012() {
  dbExport.exec(`
    CREATE TABLE reminder_schedules (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id         INTEGER NOT NULL
        REFERENCES categories(id) ON DELETE CASCADE,
      remind_each_seconds INTEGER NOT NULL,
      text                TEXT NOT NULL
    );

    CREATE TABLE reminder_state (
      session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      schedule_id INTEGER NOT NULL
        REFERENCES reminder_schedules(id) ON DELETE CASCADE,
      fired_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, schedule_id)
    );
  `)
}
```

Register it in `src/backend/src/db/migrations/index.ts`:

```ts
import runMigration012 from './012_reminder_schedules.js'
```

Add to the `migrations` array:

```ts
  { version: 12, name: '012_reminder_schedules', run: runMigration012 },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && npx vitest run tests/db/migration-012.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing store tests**

```ts
// src/backend/tests/db/reminder-schedule-store.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { runMigrations } from '../../src/db/migrations/index.js'
import { dbExport } from '../../src/db/index.js'
import { reminderScheduleStore } from
  '../../src/db/stores/reminder-schedule-store.js'
import { createCategory } from '../fixtures.js'

beforeAll(() => {
  runMigrations()
})

beforeEach(() => {
  dbExport.exec('DELETE FROM reminder_schedules; DELETE FROM categories;')
})

describe('reminderScheduleStore', () => {
  it('creates and lists schedules for a category', async () => {
    const cat = await (await createCategory()).json()
    const created = reminderScheduleStore.create({
      category_id: cat.id,
      remind_each_seconds: 3600,
      text: 'Change strap',
    })
    expect(created.id).toBeDefined()
    expect(reminderScheduleStore.findAllForCategory(cat.id)).toEqual([
      created,
    ])
  })

  it('updates remind_each_seconds and text', async () => {
    const cat = await (await createCategory()).json()
    const created = reminderScheduleStore.create({
      category_id: cat.id,
      remind_each_seconds: 3600,
      text: 'Change strap',
    })
    const updated = reminderScheduleStore.update(created.id, {
      remind_each_seconds: 7200,
      text: 'Change tape',
    })
    expect(updated.remind_each_seconds).toBe(7200)
    expect(updated.text).toBe('Change tape')
  })

  it('deletes a schedule', async () => {
    const cat = await (await createCategory()).json()
    const created = reminderScheduleStore.create({
      category_id: cat.id,
      remind_each_seconds: 3600,
      text: 'Change strap',
    })
    reminderScheduleStore.delete(created.id)
    expect(reminderScheduleStore.find(created.id)).toBeUndefined()
  })
})
```

```ts
// src/backend/tests/db/reminder-state-store.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { runMigrations } from '../../src/db/migrations/index.js'
import { dbExport } from '../../src/db/index.js'
import { reminderStateStore } from
  '../../src/db/stores/reminder-state-store.js'
import { reminderScheduleStore } from
  '../../src/db/stores/reminder-schedule-store.js'
import { createCategory, createItem } from '../fixtures.js'

const SESSIONS = '/api/sessions'
import app from '../../src/server.js'

beforeAll(() => {
  runMigrations()
})

beforeEach(() => {
  dbExport.exec(
    'DELETE FROM reminder_state; DELETE FROM reminder_schedules; ' +
      'DELETE FROM sessions; DELETE FROM items; DELETE FROM categories;',
  )
})

describe('reminderStateStore', () => {
  it('returns undefined when no row exists', async () => {
    const cat = await (await createCategory()).json()
    const item = await (await createItem(cat.id)).json()
    const schedule = reminderScheduleStore.create({
      category_id: cat.id,
      remind_each_seconds: 3600,
      text: 'Change strap',
    })
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, started_at: 0 }),
    })
    const session = await startRes.json()
    expect(reminderStateStore.get(session.id, schedule.id)).toBeUndefined()
  })

  it('upserts and reads back fired_count', async () => {
    const cat = await (await createCategory()).json()
    const item = await (await createItem(cat.id)).json()
    const schedule = reminderScheduleStore.create({
      category_id: cat.id,
      remind_each_seconds: 3600,
      text: 'Change strap',
    })
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, started_at: 0 }),
    })
    const session = await startRes.json()
    reminderStateStore.upsert(session.id, schedule.id, 2)
    expect(reminderStateStore.get(session.id, schedule.id)).toEqual({
      session_id: session.id,
      schedule_id: schedule.id,
      fired_count: 2,
    })
    reminderStateStore.upsert(session.id, schedule.id, 3)
    expect(reminderStateStore.get(session.id, schedule.id)?.fired_count).toBe(
      3,
    )
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd src/backend && npx vitest run tests/db/reminder-schedule-store.test.ts tests/db/reminder-state-store.test.ts`
Expected: FAIL — cannot find module `../../src/db/stores/reminder-schedule-store.js`

- [ ] **Step 7: Implement the stores**

```ts
// src/backend/src/db/stores/reminder-schedule-store.ts
import db from '../index.js'

export interface ReminderSchedule {
  id: number;
  category_id: number;
  remind_each_seconds: number;
  text: string;
}

export interface ReminderScheduleCreate {
  category_id: number;
  remind_each_seconds: number;
  text: string;
}

export type ReminderScheduleUpdate = Partial<
  Omit<ReminderScheduleCreate, 'category_id'>
>;

class ReminderScheduleStore {
  findAllForCategory(categoryId: number): ReminderSchedule[] {
    return db
      .prepare(
        'SELECT * FROM reminder_schedules WHERE category_id = ? ORDER BY id',
      )
      .all(categoryId) as ReminderSchedule[]
  }

  find(id: number): ReminderSchedule | undefined {
    return db
      .prepare('SELECT * FROM reminder_schedules WHERE id = ?')
      .get(id) as ReminderSchedule | undefined
  }

  create(data: ReminderScheduleCreate): ReminderSchedule {
    const result = db
      .prepare(
        `INSERT INTO reminder_schedules
           (category_id, remind_each_seconds, text)
         VALUES (?, ?, ?)`,
      )
      .run(data.category_id, data.remind_each_seconds, data.text)
    return this.find(result.lastInsertRowid as number)!
  }

  update(id: number, data: ReminderScheduleUpdate): ReminderSchedule {
    const ALLOWED_COLUMNS = new Set(['remind_each_seconds', 'text'])
    const entries = Object.entries(data).filter(([k]) =>
      ALLOWED_COLUMNS.has(k),
    )
    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ')
    db.prepare(
      `UPDATE reminder_schedules SET ${setClauses} WHERE id = ?`,
    ).run(...entries.map(([, v]) => v), id)
    return this.find(id)!
  }

  delete(id: number): void {
    db.prepare('DELETE FROM reminder_schedules WHERE id = ?').run(id)
  }
}

export const reminderScheduleStore = new ReminderScheduleStore()
```

```ts
// src/backend/src/db/stores/reminder-state-store.ts
import db from '../index.js'

export interface ReminderStateRow {
  session_id: number;
  schedule_id: number;
  fired_count: number;
}

class ReminderStateStore {
  get(sessionId: number, scheduleId: number): ReminderStateRow | undefined {
    return db
      .prepare(
        'SELECT * FROM reminder_state ' +
          'WHERE session_id = ? AND schedule_id = ?',
      )
      .get(sessionId, scheduleId) as ReminderStateRow | undefined
  }

  upsert(sessionId: number, scheduleId: number, firedCount: number): void {
    db.prepare(
      `INSERT INTO reminder_state (session_id, schedule_id, fired_count)
       VALUES (?, ?, ?)
       ON CONFLICT (session_id, schedule_id) DO UPDATE SET
         fired_count = excluded.fired_count`,
    ).run(sessionId, scheduleId, firedCount)
  }
}

export const reminderStateStore = new ReminderStateStore()
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd src/backend && npx vitest run tests/db/migration-012.test.ts tests/db/reminder-schedule-store.test.ts tests/db/reminder-state-store.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/backend/src/db/migrations/012_reminder_schedules.ts \
  src/backend/src/db/migrations/index.ts \
  src/backend/src/db/stores/reminder-schedule-store.ts \
  src/backend/src/db/stores/reminder-state-store.ts \
  src/backend/tests/db/migration-012.test.ts \
  src/backend/tests/db/reminder-schedule-store.test.ts \
  src/backend/tests/db/reminder-state-store.test.ts
git commit -m "feat(reminders): add reminder_schedules/reminder_state tables and stores"
```

---

### Task 2: `computeReminderDueCount` pure function

**Files:**
- Modify: `src/backend/src/db/calculations.ts`
- Test: `src/backend/tests/db/calculations.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no dependency on Tasks 1).
- Produces: `computeReminderDueCount(remindEachSeconds: number, targetWearSeconds: number, maxWearSeconds: number | null, elapsedSeconds: number): number`

- [ ] **Step 1: Write the failing tests**

Append to `src/backend/tests/db/calculations.test.ts`:

```ts
import { computeReminderDueCount } from '../../src/db/calculations.js'

describe('computeReminderDueCount', () => {
  describe('with a max duration', () => {
    it('spaces reminders evenly across the max, capped at n', () => {
      // max=3600, remind_each=1000 -> n=ceil(3600/1000)=4, interval=900
      expect(computeReminderDueCount(1000, 1500, 3600, 899)).toBe(0)
      expect(computeReminderDueCount(1000, 1500, 3600, 900)).toBe(1)
      expect(computeReminderDueCount(1000, 1500, 3600, 1800)).toBe(2)
      expect(computeReminderDueCount(1000, 1500, 3600, 3600)).toBe(4)
      expect(computeReminderDueCount(1000, 1500, 3600, 999999)).toBe(4)
    })
  })

  describe('without a max duration', () => {
    it('fires the first reminder at target/ceil(target/remind_each), then every remind_each', () => {
      // target=1500, remind_each=1000 -> n=2, firstFire=750
      expect(computeReminderDueCount(1000, 1500, null, 749)).toBe(0)
      expect(computeReminderDueCount(1000, 1500, null, 750)).toBe(1)
      expect(computeReminderDueCount(1000, 1500, null, 1749)).toBe(1)
      expect(computeReminderDueCount(1000, 1500, null, 1750)).toBe(2)
      expect(computeReminderDueCount(1000, 1500, null, 2750)).toBe(3)
    })

    it('fires exactly at target when remind_each >= target', () => {
      // n=max(1, ceil(900/1000))=1, firstFire=900
      expect(computeReminderDueCount(1000, 900, null, 899)).toBe(0)
      expect(computeReminderDueCount(1000, 900, null, 900)).toBe(1)
      expect(computeReminderDueCount(1000, 900, null, 1900)).toBe(2)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/backend && npx vitest run tests/db/calculations.test.ts -t computeReminderDueCount`
Expected: FAIL — `computeReminderDueCount is not a function`

- [ ] **Step 3: Implement the function**

Append to `src/backend/src/db/calculations.ts`:

```ts
/**
 * How many reminder occurrences should have fired by `elapsedSeconds` into
 * a session. No state beyond the session's known durations is needed —
 * this is why reminders survive a server restart: recompute, don't
 * schedule.
 */
export function computeReminderDueCount(
  remindEachSeconds: number,
  targetWearSeconds: number,
  maxWearSeconds: number | null,
  elapsedSeconds: number,
): number {
  if (maxWearSeconds !== null) {
    const n = Math.ceil(maxWearSeconds / remindEachSeconds)
    const interval = maxWearSeconds / n
    return Math.min(n, Math.floor(elapsedSeconds / interval))
  }
  const n = Math.max(1, Math.ceil(targetWearSeconds / remindEachSeconds))
  const firstFire = targetWearSeconds / n
  if (elapsedSeconds < firstFire) {
    return 0
  }
  return 1 + Math.floor((elapsedSeconds - firstFire) / remindEachSeconds)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/backend && npx vitest run tests/db/calculations.test.ts -t computeReminderDueCount`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/db/calculations.ts src/backend/tests/db/calculations.test.ts
git commit -m "feat(reminders): add computeReminderDueCount scheduling math"
```

---

### Task 3: Event bus type + poller integration

**Files:**
- Modify: `src/backend/src/events/bus.ts`
- Modify: `src/backend/src/events/poller.ts`
- Test: `src/backend/tests/events/poller.test.ts`

**Interfaces:**
- Consumes: `reminderScheduleStore.findAllForCategory` (Task 1), `reminderStateStore.get`/`upsert` (Task 1), `computeReminderDueCount` (Task 2).
- Produces: `EventPayloads['reminder_due']` shape consumed by Task 4.

- [ ] **Step 1: Write the failing poller test**

Append to `src/backend/tests/events/poller.test.ts`:

```ts
import { reminderScheduleStore } from
  '../../src/db/stores/reminder-schedule-store.js'
import { reminderStateStore } from
  '../../src/db/stores/reminder-state-store.js'

describe('events poller tick() — reminders', () => {
  beforeEach(() => {
    dbExport.exec('DELETE FROM reminder_state; DELETE FROM reminder_schedules;')
  })

  it('fires reminder_due once the first interval elapses in an active session', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem({
      initial_target_wear_duration_seconds: 1000,
      initial_max_wear_duration_seconds: null,
    })
    const schedule = reminderScheduleStore.create({
      category_id: categoryId,
      remind_each_seconds: 1000,
      text: 'Change strap',
    })
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    })
    const session = await startRes.json()

    tick(0) // baseline tick, no emit yet — matches existing "no backfire" rule

    const listener = vi.fn()
    eventBus.on('reminder_due', listener)

    tick(900) // n = ceil(1000/1000) = 1, firstFire = 1000 -> not yet due
    expect(listener).not.toHaveBeenCalled()

    tick(1000) // now due
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        category_id: categoryId,
        session_id: session.id,
        schedule_id: schedule.id,
        text: 'Change strap',
      }),
    )
    expect(reminderStateStore.get(session.id, schedule.id)?.fired_count).toBe(
      1,
    )

    listener.mockClear()
    tick(1500) // still only 1 due (n=1 cap for max case doesn't apply here;
    // target-only branch: n=1, firstFire=1000, next at 1000+1000=2000)
    expect(listener).not.toHaveBeenCalled()

    tick(2000)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(reminderStateStore.get(session.id, schedule.id)?.fired_count).toBe(
      2,
    )
  })

  it('does not fire reminder_due for a session that already existed on the first-ever tick', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem()
    reminderScheduleStore.create({
      category_id: categoryId,
      remind_each_seconds: 60,
      text: 'Change strap',
    })
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    })
    await startRes.json()

    const listener = vi.fn()
    eventBus.on('reminder_due', listener)
    tick(10000) // first-ever tick for this category: baseline only
    expect(listener).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && npx vitest run tests/events/poller.test.ts -t reminders`
Expected: FAIL — `eventBus.on('reminder_due', ...)` type error / event never emitted (test times out or listener never called on the due tick).

- [ ] **Step 3: Add the event type**

In `src/backend/src/events/bus.ts`, add after `SessionThresholdEvent`:

```ts
export interface ReminderDueEvent extends CategoryContext {
  session_id: number;
  schedule_id: number;
  text: string;
}
```

Add `reminder_due: ReminderDueEvent;` to the `EventPayloads` interface (after `overtime: SessionThresholdEvent;`).

- [ ] **Step 4: Wire the poller**

In `src/backend/src/events/poller.ts`, add imports:

```ts
import { reminderScheduleStore } from
  '../db/stores/reminder-schedule-store.js'
import { reminderStateStore } from '../db/stores/reminder-state-store.js'
import { computeReminderDueCount } from '../db/calculations.js'
```

Inside `tick()`, at the end of the existing `if (session) { ... }` block (right after the `if (session.max_wear_seconds !== null) { ... }` block, still inside `if (session) {`), add:

```ts
      const schedules = reminderScheduleStore.findAllForCategory(category.id)
      for (const schedule of schedules) {
        const elapsed = now - session.started_at
        const due = computeReminderDueCount(
          schedule.remind_each_seconds,
          session.target_wear_seconds,
          session.max_wear_seconds,
          elapsed,
        )
        const state = reminderStateStore.get(session.id, schedule.id)
        const fired = state?.fired_count ?? 0
        if (due > fired) {
          if (shouldEmit) {
            eventBus.emit('reminder_due', {
              category_id: category.id,
              category_name: category.name,
              timestamp: now,
              session_id: session.id,
              schedule_id: schedule.id,
              text: schedule.text,
            })
          }
          reminderStateStore.upsert(session.id, schedule.id, due)
        }
      }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src/backend && npx vitest run tests/events/poller.test.ts`
Expected: PASS (all poller tests, including the pre-existing ones)

- [ ] **Step 6: Commit**

```bash
git add src/backend/src/events/bus.ts src/backend/src/events/poller.ts \
  src/backend/tests/events/poller.test.ts
git commit -m "feat(reminders): emit reminder_due events from the poller"
```

---

### Task 4: Notifications runner integration

**Files:**
- Modify: `src/backend/src/notifications/runner.ts`
- Test: `src/backend/tests/notifications/runner.test.ts`

**Interfaces:**
- Consumes: `EventPayloads['reminder_due']` (Task 3).
- Produces: push notification with `title: 'Maintenance for ${category_name}'`, `body: text`, `tag: 'category-${category_id}'`.

- [ ] **Step 1: Write the failing test**

Append to `src/backend/tests/notifications/runner.test.ts`:

```ts
  it('sends a push notification when reminder_due fires', async () => {
    startScheduler()
    eventBus.emit('reminder_due', {
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 100,
      session_id: 42,
      schedule_id: 7,
      text: 'Change your wrist strap',
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(send).toHaveBeenCalledWith(
      '{"endpoint":"https://x"}',
      expect.objectContaining({
        title: 'Maintenance for Footwear',
        body: 'Change your wrist strap',
        tag: 'category-1',
      }),
    )
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && npx vitest run tests/notifications/runner.test.ts -t reminder_due`
Expected: FAIL — `expect(send).toHaveBeenCalledWith(...)` fails (no call, `copyFor` returns `null` for `reminder_due` and `notify()` returns early).

- [ ] **Step 3: Implement**

In `src/backend/src/notifications/runner.ts`, add a case in `copyFor()` (before the `default:` case):

```ts
  case 'reminder_due': {
    const p = payload as EventPayloads['reminder_due']
    return { title: `Maintenance for ${categoryName}`, body: p.text }
  }
```

Add `'reminder_due'` to the `NOTIFICATION_EVENTS` array.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && npx vitest run tests/notifications/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/notifications/runner.ts \
  src/backend/tests/notifications/runner.test.ts
git commit -m "feat(reminders): send push notification on reminder_due"
```

---

### Task 5: `reminder-schedules` API controller

**Files:**
- Create: `src/backend/src/controllers/reminder-schedules.ts`
- Modify: `src/backend/src/server.ts`
- Test: `src/backend/tests/reminder-schedules/controller.test.ts`

**Interfaces:**
- Consumes: `reminderScheduleStore` (Task 1), `categoryStore.find` (existing).
- Produces: HTTP routes mounted at `/api/reminder-schedules`, consumed by the frontend composable in Task 6.

- [ ] **Step 1: Write the failing controller tests**

```ts
// src/backend/tests/reminder-schedules/controller.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import app from '../../src/server.js'
import { runMigrations } from '../../src/db/migrations/index.js'
import { dbExport } from '../../src/db/index.js'
import { createCategory } from '../fixtures.js'

const BASE = '/api/reminder-schedules'

beforeAll(() => {
  runMigrations()
})

beforeEach(() => {
  dbExport.exec('DELETE FROM reminder_schedules; DELETE FROM categories;')
})

describe('reminder-schedules controller', () => {
  it('GET ?category_id=X lists schedules for that category', async () => {
    const cat = await (await createCategory()).json()
    await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: cat.id,
        remind_each_seconds: 3600,
        text: 'Change strap',
      }),
    })
    const res = await app.request(`${BASE}?category_id=${cat.id}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].text).toBe('Change strap')
  })

  it('POST creates a schedule and returns 201', async () => {
    const cat = await (await createCategory()).json()
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: cat.id,
        remind_each_seconds: 3600,
        text: 'Change strap',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBeDefined()
    expect(body.category_id).toBe(cat.id)
  })

  it('POST returns 400 when category_id does not exist', async () => {
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: 999999,
        remind_each_seconds: 3600,
        text: 'Change strap',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('POST returns 400 when remind_each_seconds < 60', async () => {
    const cat = await (await createCategory()).json()
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: cat.id,
        remind_each_seconds: 30,
        text: 'Change strap',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('POST returns 400 when text is empty', async () => {
    const cat = await (await createCategory()).json()
    const res = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: cat.id,
        remind_each_seconds: 3600,
        text: '',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('PATCH updates a schedule', async () => {
    const cat = await (await createCategory()).json()
    const createRes = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: cat.id,
        remind_each_seconds: 3600,
        text: 'Change strap',
      }),
    })
    const created = await createRes.json()
    const res = await app.request(`${BASE}/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Change tape' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.text).toBe('Change tape')
  })

  it('PATCH returns 404 for an unknown id', async () => {
    const res = await app.request(`${BASE}/999999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Change tape' }),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE removes a schedule', async () => {
    const cat = await (await createCategory()).json()
    const createRes = await app.request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: cat.id,
        remind_each_seconds: 3600,
        text: 'Change strap',
      }),
    })
    const created = await createRes.json()
    const res = await app.request(`${BASE}/${created.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
    const listRes = await app.request(`${BASE}?category_id=${cat.id}`)
    expect(await listRes.json()).toHaveLength(0)
  })

  it('DELETE returns 404 for an unknown id', async () => {
    const res = await app.request(`${BASE}/999999`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/backend && npx vitest run tests/reminder-schedules/controller.test.ts`
Expected: FAIL — 404s across the board (route not mounted yet).

- [ ] **Step 3: Implement the controller**

```ts
// src/backend/src/controllers/reminder-schedules.ts
import { Hono } from 'hono'
import { reminderScheduleStore } from
  '../db/stores/reminder-schedule-store.js'
import { categoryStore } from '../db/stores/category-store.js'
import { NotFoundError, ValidationError } from '../middleware/errors.js'

export const router = new Hono()

// GET /api/reminder-schedules?category_id=X
router.get('/', (c) => {
  const categoryId = c.req.query('category_id')
  if (categoryId === undefined) {
    throw new ValidationError('category_id query param is required')
  }
  return c.json(
    reminderScheduleStore.findAllForCategory(Number(categoryId)),
  )
})

// POST /api/reminder-schedules
router.post('/', async (c) => {
  const body = await c.req.json()
  const { category_id, remind_each_seconds, text } = body

  if (typeof category_id !== 'number') {
    throw new ValidationError('category_id must be a number')
  }
  if (!categoryStore.find(category_id)) {
    throw new ValidationError(`Category ${category_id} does not exist`)
  }
  if (typeof remind_each_seconds !== 'number' || remind_each_seconds < 60) {
    throw new ValidationError('remind_each_seconds must be a number >= 60')
  }
  if (!text || typeof text !== 'string') {
    throw new ValidationError('text is required')
  }

  const schedule = reminderScheduleStore.create({
    category_id,
    remind_each_seconds,
    text,
  })
  return c.json(schedule, 201)
})

// PATCH /api/reminder-schedules/:id
router.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const existing = reminderScheduleStore.find(id)
  if (!existing) {
    throw new NotFoundError(`Reminder schedule ${id} not found`)
  }

  const body = await c.req.json()
  const updates: { remind_each_seconds?: number; text?: string } = {}
  if ('remind_each_seconds' in body) {
    if (
      typeof body.remind_each_seconds !== 'number' ||
      body.remind_each_seconds < 60
    ) {
      throw new ValidationError('remind_each_seconds must be a number >= 60')
    }
    updates.remind_each_seconds = body.remind_each_seconds
  }
  if ('text' in body) {
    if (!body.text || typeof body.text !== 'string') {
      throw new ValidationError('text must be a non-empty string')
    }
    updates.text = body.text
  }

  return c.json(reminderScheduleStore.update(id, updates))
})

// DELETE /api/reminder-schedules/:id
router.delete('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const existing = reminderScheduleStore.find(id)
  if (!existing) {
    throw new NotFoundError(`Reminder schedule ${id} not found`)
  }
  reminderScheduleStore.delete(id)
  return c.body(null, 204)
})
```

Register in `src/backend/src/server.ts`:

```ts
import { router as reminderSchedulesRouter } from
  './controllers/reminder-schedules.js'
```

```ts
app.route('/api/reminder-schedules', reminderSchedulesRouter)
```

Also add `DELETE FROM reminder_schedules;` and `DELETE FROM reminder_state;` to the `/api/__reset` handler's SQL block in `server.ts` (alongside the existing `DELETE FROM event_poller_state;` line), so E2E tests get a clean slate.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/backend && npx vitest run tests/reminder-schedules/controller.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full backend test suite**

Run: `cd src/backend && npx vitest run`
Expected: PASS (no regressions in categories/items/sessions/events/notifications tests)

- [ ] **Step 6: Commit**

```bash
git add src/backend/src/controllers/reminder-schedules.ts src/backend/src/server.ts \
  src/backend/tests/reminder-schedules/controller.test.ts
git commit -m "feat(reminders): add /api/reminder-schedules CRUD endpoints"
```

---

### Task 6: `useReminderSchedules` composable

**Files:**
- Create: `src/frontend/src/composables/useReminderSchedules.ts`

**Interfaces:**
- Consumes: `apiFetch` (existing, `src/frontend/src/utils/apiFetch.ts`), backend routes from Task 5.
- Produces:
  ```ts
  interface ReminderSchedule {
    id: number;
    category_id: number;
    remind_each_seconds: number;
    text: string;
  }
  function useReminderSchedules(): {
    schedules: Ref<Record<number, ReminderSchedule[]>>; // keyed by category_id
    loadSchedules(categoryId: number): Promise<void>;
    createSchedule(data: { category_id: number; remind_each_seconds: number; text: string }): Promise<ReminderSchedule>;
    updateSchedule(id: number, data: Partial<{ remind_each_seconds: number; text: string }>): Promise<ReminderSchedule>;
    deleteSchedule(categoryId: number, id: number): Promise<void>;
  }
  ```
  Consumed by Task 7 (`ReminderSchedulesSheet.vue`) and Task 8 (`CategoriesSection.vue`).

No backend/DB work in this task — matches the existing repo convention that simple CRUD composables (`useCategories.ts`, `useItems.ts`) are untested directly; correctness is covered by the controller tests in Task 5 and manual verification in Task 8.

- [ ] **Step 1: Implement the composable**

```ts
// src/frontend/src/composables/useReminderSchedules.ts
import { ref } from 'vue'
import { apiFetch } from '../utils/apiFetch.js'

export interface ReminderSchedule {
  id: number;
  category_id: number;
  remind_each_seconds: number;
  text: string;
}

export type ReminderScheduleCreate = Omit<ReminderSchedule, 'id'>;
export type ReminderScheduleUpdate = Partial<
  Omit<ReminderSchedule, 'id' | 'category_id'>
>;

// Module-level state shared across all component instances, keyed by
// category_id — mirrors how CategoriesSection needs a count per row.
const schedules = ref<Record<number, ReminderSchedule[]>>({})

async function loadSchedules(categoryId: number): Promise<void> {
  const res = await apiFetch(
    `/api/reminder-schedules?category_id=${categoryId}`,
  )
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  schedules.value[categoryId] = await res.json()
}

async function createSchedule(
  data: ReminderScheduleCreate,
): Promise<ReminderSchedule> {
  const res = await apiFetch('/api/reminder-schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  const created: ReminderSchedule = await res.json()
  const list = schedules.value[data.category_id] ?? []
  schedules.value[data.category_id] = [...list, created]
  return created
}

async function updateSchedule(
  id: number,
  data: ReminderScheduleUpdate,
): Promise<ReminderSchedule> {
  const res = await apiFetch(`/api/reminder-schedules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  const updated: ReminderSchedule = await res.json()
  const list = schedules.value[updated.category_id] ?? []
  schedules.value[updated.category_id] = list.map((s) =>
    s.id === id ? updated : s,
  )
  return updated
}

async function deleteSchedule(categoryId: number, id: number): Promise<void> {
  const res = await apiFetch(`/api/reminder-schedules/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  const list = schedules.value[categoryId] ?? []
  schedules.value[categoryId] = list.filter((s) => s.id !== id)
}

export function useReminderSchedules() {
  return { schedules, loadSchedules, createSchedule, updateSchedule, deleteSchedule }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/composables/useReminderSchedules.ts
git commit -m "feat(reminders): add useReminderSchedules composable"
```

---

### Task 7: `ReminderSchedulesSheet.vue`

**Files:**
- Create: `src/frontend/src/components/ReminderSchedulesSheet.vue`

**Interfaces:**
- Consumes: `useReminderSchedules()` (Task 6), `useNotifications()` (existing, `src/frontend/src/composables/useNotifications.ts`), `DurationPickerSheet.vue` (existing, `modelValue: number` / `open: boolean`, emits `update:modelValue`/`update:open`), `TextField.vue` (existing, `modelValue: string`, emits `update:modelValue`), `SectionTitle.vue` (existing, `variant` prop), `shortDuration` from `src/frontend/src/utils/formatDuration.ts`, `DeleteButton.vue` (existing, props `title`/`message`, emits `confirm`, slot `#trigger="{ open }"`).
- Produces: component with props `{ categoryId: number; categoryName: string; open: boolean }`, emits `update:open: [value: boolean]`. Consumed by Task 8.

- [ ] **Step 1: Implement the component**

```vue
<!-- src/frontend/src/components/ReminderSchedulesSheet.vue -->
<template>
  <k-sheet
    v-if="open"
    :opened="open"
    @backdropclick="close"
    class="pb-safe bg-white dark:bg-gray-900 flex flex-col overflow-hidden h-[70vh]"
  >
    <k-toolbar innerClass="!h-6 !w-full">
      <div class="relative flex w-full items-center justify-center">
        <button
          type="button"
          class="absolute left-0 flex items-center justify-center w-8 h-full text-primary text-xl"
          @click="close"
        >✕</button>
        <SectionTitle variant="sheet">Reminders — {{ categoryName }}</SectionTitle>
      </div>
    </k-toolbar>

    <div class="overflow-y-auto flex-1 px-4 py-2 space-y-2">
      <div
        v-if="
          !notifications.isSubscribed.value &&
          notifications.isConfigured.value &&
          (schedules.schedules.value[categoryId] ?? []).length === 0
        "
        class="rounded-lg bg-blue-50 dark:bg-blue-950 p-3 text-sm space-y-2"
      >
        <p>Enable notifications to receive maintenance reminders.</p>
        <button
          type="button"
          class="px-3 py-1 rounded-lg text-sm font-medium bg-blue-500 text-white"
          @click="notifications.enable"
        >Enable notifications</button>
      </div>

      <div
        v-for="schedule in schedules.schedules.value[categoryId] ?? []"
        :key="schedule.id"
        class="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2"
      >
        <div>
          <p class="text-sm font-medium">{{ schedule.text }}</p>
          <p class="text-xs text-gray-400">
            every {{ shortDuration(schedule.remind_each_seconds) }}
          </p>
        </div>
        <DeleteButton
          title="Delete this reminder?"
          message="This cannot be undone."
          @confirm="onDelete(schedule.id)"
        >
          <template #trigger="{ open: openConfirm }">
            <button
              type="button"
              class="text-xs text-red-500 underline"
              @click="openConfirm"
            >Delete</button>
          </template>
        </DeleteButton>
      </div>

      <div v-if="showAddForm" class="border border-gray-200 rounded-lg p-3 space-y-2">
        <DurationTrigger
          label="Remind every"
          :displayValue="shortDuration(newIntervalSeconds)"
          @click="showDurationPicker = true"
        />
        <TextField id="reminder-text" label="Reminder text" v-model="newText" />
        <div class="flex gap-2">
          <button
            type="button"
            class="px-3 py-1 rounded-lg text-sm font-medium bg-blue-500 text-white disabled:opacity-40"
            :disabled="!newText || newIntervalSeconds < 60"
            @click="onAdd"
          >Save</button>
          <button
            type="button"
            class="px-3 py-1 rounded-lg text-sm font-medium border border-gray-300"
            @click="showAddForm = false"
          >Cancel</button>
        </div>
      </div>
      <button
        v-else
        type="button"
        class="w-full px-3 py-2 rounded-lg text-sm font-medium border border-gray-300"
        @click="showAddForm = true"
      >+ Add reminder</button>
    </div>

    <DurationPickerSheet
      :modelValue="newIntervalSeconds"
      :open="showDurationPicker"
      @update:modelValue="newIntervalSeconds = $event"
      @update:open="showDurationPicker = $event"
    />
  </k-sheet>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { kSheet, kToolbar } from 'konsta/vue'
import SectionTitle from './SectionTitle.vue'
import DurationTrigger from './DurationTrigger.vue'
import DurationPickerSheet from './DurationPickerSheet.vue'
import TextField from './TextField.vue'
import DeleteButton from './DeleteButton.vue'
import { shortDuration } from '../utils/formatDuration.js'
import { useReminderSchedules } from '../composables/useReminderSchedules.js'
import { useNotifications } from '../composables/useNotifications.js'

const props = defineProps<{
  categoryId: number;
  categoryName: string;
  open: boolean;
}>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const schedules = useReminderSchedules()
const notifications = useNotifications()

const showAddForm = ref(false)
const showDurationPicker = ref(false)
const newIntervalSeconds = ref(3600)
const newText = ref('')

function close() {
  emit('update:open', false)
}

async function onAdd() {
  await schedules.createSchedule({
    category_id: props.categoryId,
    remind_each_seconds: newIntervalSeconds.value,
    text: newText.value,
  })
  newText.value = ''
  newIntervalSeconds.value = 3600
  showAddForm.value = false
}

async function onDelete(id: number) {
  await schedules.deleteSchedule(props.categoryId, id)
}
</script>
```

- [ ] **Step 2: Typecheck**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/components/ReminderSchedulesSheet.vue
git commit -m "feat(reminders): add ReminderSchedulesSheet management UI"
```

---

### Task 8: Wire into `CategoriesSection.vue`

**Files:**
- Modify: `src/frontend/src/components/CategoriesSection.vue`

**Interfaces:**
- Consumes: `useReminderSchedules()` (Task 6), `ReminderSchedulesSheet.vue` (Task 7, props `categoryId`/`categoryName`/`open`, emits `update:open`).

- [ ] **Step 1: Add imports and state**

In `<script setup>`, add:

```ts
import { useReminderSchedules } from '../composables/useReminderSchedules.js'
import ReminderSchedulesSheet from './ReminderSchedulesSheet.vue'
```

```ts
const { schedules, loadSchedules } = useReminderSchedules()
const remindersSheetCategoryId = ref<number | null>(null)
```

- [ ] **Step 2: Load schedules alongside categories**

Replace the `onMounted` body:

```ts
onMounted(async () => {
  try {
    await loadCategories()
    await Promise.all(categories.value.map((c) => loadSchedules(c.id)))
  } finally {
    loading.value = false
  }
})
```

- [ ] **Step 3: Load schedules for a newly-created category**

In `onAddCategory`, after `await createCategory(...)` succeeds, add a call to load that category's (empty) schedule list so the label renders correctly without a page reload:

```ts
async function onAddCategory(data: CategoryFormState) {
  try {
    const created = await createCategory(formStateToApiPayload(data))
    await loadSchedules(created.id)
    showCatForm.value = false
  } catch (e) {
    showError(String(e))
  }
}
```

(`createCategory` already returns the created category — see `useCategories.ts`.)

- [ ] **Step 4: Add the row UI**

In the template, inside the `#after` slot's `<div class="flex gap-1">`, add the reminders controls before the Edit button so they read left-to-right as: reminders, edit, delete. Actually — per the "always visible" placement decision, put the label + button on their own line below the existing button row, not inside it. Replace the `<k-list-item>` block with:

```html
<k-list-item :title="cat.name">
  <template #media>
    <Icon
      v-if="cat.icon?.includes(':')"
      :icon="cat.icon"
      class="text-2xl w-8 h-8"
    />
    <span v-else class="text-2xl">{{ cat.icon }}</span>
  </template>
  <template #subtitle>
    <div class="flex items-center gap-2">
      <span class="text-xs text-gray-400">
        {{ (schedules[cat.id] ?? []).length }} reminders scheduled
      </span>
      <button
        type="button"
        class="text-xs text-blue-500 underline"
        @click="remindersSheetCategoryId = cat.id"
      >Manage Reminders</button>
    </div>
  </template>
  <template #after>
    <div class="flex gap-1">
      <k-button
        small
        outline
        type="button"
        @click="onToggleEdit(cat.id)"
      >Edit</k-button>
      <DeleteButton
        title="Delete this category and all its items?"
        message="This cannot be undone."
        @confirm="onConfirmDeleteCategory(cat.id)"
      >
        <template #trigger="{ open }">
          <k-button
            small
            outline
            type="button"
            @click="open"
          >Delete</k-button>
        </template>
      </DeleteButton>
    </div>
  </template>
</k-list-item>
```

(`k-list-item` from Konsta supports a `#subtitle` slot for a secondary line under the title — matches how the icon/title/after slots already compose in this file.)

- [ ] **Step 5: Mount the sheet once, at the end of the component template**

After the closing `</template>` of the `v-for` loop (i.e. as a sibling of `<k-list>`, still inside the top-level `<div>`):

```html
<ReminderSchedulesSheet
  v-if="remindersSheetCategoryId !== null"
  :categoryId="remindersSheetCategoryId"
  :categoryName="categories.find((c) => c.id === remindersSheetCategoryId)?.name ?? ''"
  :open="remindersSheetCategoryId !== null"
  @update:open="(v) => { if (!v) remindersSheetCategoryId = null }"
/>
```

- [ ] **Step 6: Typecheck**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Manual verification**

Run: `cd src/backend && npm run dev` (one terminal) and `cd src/frontend && npm run dev` (another terminal). Open the app, go to Settings, and confirm:
- Each category row shows "0 reminders scheduled" + "Manage Reminders".
- Clicking "Manage Reminders" opens the sheet, "+ Add reminder" lets you pick an interval and enter text, "Save" adds it and the row's count updates to "1 reminders scheduled" after closing the sheet and re-opening (or immediately, if the count is reactive off the same `schedules` ref — confirm it is: `schedules` is the same module-level ref returned from `useReminderSchedules()` in both `CategoriesSection.vue` and `ReminderSchedulesSheet.vue`, so it updates live).
- Delete removes it and the count drops back to 0.

- [ ] **Step 8: Commit**

```bash
git add src/frontend/src/components/CategoriesSection.vue
git commit -m "feat(reminders): show reminder count and management button on category rows"
```

---

### Task 9: Open the pull request

**Files:** none (git/GitHub operations only)

- [ ] **Step 1: Run the full test suite one more time**

Run: `cd src/backend && npx vitest run && cd ../frontend && npx vue-tsc --noEmit`
Expected: PASS / no errors

- [ ] **Step 2: Push the branch**

```bash
git push -u origin issue-3-maintenance-reminders
```

- [ ] **Step 3: Open the PR**

Use `mcp__github__create_pull_request` (owner `madrigal-eschat`, repo `weartrack`, base `main`, head `issue-3-maintenance-reminders`) with a summary referencing "Closes #3" and a test plan checklist covering the manual verification from Task 8.
