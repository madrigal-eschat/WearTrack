# Events Bus & Notifications Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the backend's two independent DB-polling mechanisms (the decay/rest derivation used ad-hoc by callers, and the notification scheduler's due-check) with a single shared, DB-backed, edge-detecting poller that emits typed events on an internal bus. `notifications/` becomes a pure subscriber with no polling of its own. This is PR 1 of 2 — PR 2 (a separate plan) adds MQTT publishing as a second subscriber to the same bus.

**Architecture:** New `src/backend/src/events/` module: `bus.ts` (typed `EventEmitter` wrapper, 12 event names), `store.ts` (DB-backed last-known-state per category, survives restarts), `poller.ts` (single 30s tick that recomputes rest/decay state and four kinds of time-threshold per category, diffs against stored state, emits bus events on transitions). `session-store.ts`'s `start()`/`end()` emit `session_start`/`session_end` synchronously. `notifications/scheduler.ts`, `store.ts`'s scheduler-related methods, `types.ts`, and the `sent_notifications` table are deleted; `runner.ts` becomes a bus listener.

**Tech Stack:** TypeScript, Hono, better-sqlite3, Vitest. No new dependencies.

## Global Constraints

- All new/changed backend code lives under `src/backend/src/`; tests under `src/backend/tests/`, mirroring the module they cover (per `CLAUDE.md`-adjacent convention already used by `tests/notifications/`).
- Timestamps are Unix seconds (`number`) everywhere, matching every existing table/column in this codebase.
- No new npm dependencies in this PR (Node's built-in `EventEmitter` only).
- Existing `notifications/sender.ts`, `controllers/notifications.ts`, and the push-subscription flow are unchanged — only the scheduling/dedup layer changes.
- Every DB write goes through the existing `db`/`dbExport` singleton from `src/backend/src/db/index.ts` (no new connection).

---

### Task 1: Migration 009 — `event_poller_state` table, drop `sent_notifications`

**Files:**
- Create: `src/backend/src/db/migrations/009_events_bus.ts`
- Modify: `src/backend/src/db/migrations/index.ts`
- Test: `src/backend/tests/db/migration-009.test.ts`

**Interfaces:**
- Produces: `event_poller_state` table with columns `category_id` (PK, FK→categories, cascade delete), `decay_state` (TEXT, default `'none'`), `resting` (INTEGER, default `0`), `halfway_notified` (INTEGER, default `0`), `decay_soon_notified` (INTEGER, default `0`), `last_session_id` (INTEGER, nullable), `target_met_notified`, `overtime_warning_30_notified`, `overtime_warning_5_notified`, `overtime_notified` (all INTEGER, default `0`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/db/migration-009.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { dbExport } from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrations/index.js';

beforeAll(() => {
  runMigrations();
});

describe('migration 009', () => {
  it('creates event_poller_state table with all columns', () => {
    const cols = (
      dbExport.prepare('PRAGMA table_info(event_poller_state)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        'category_id',
        'decay_state',
        'resting',
        'halfway_notified',
        'decay_soon_notified',
        'last_session_id',
        'target_met_notified',
        'overtime_warning_30_notified',
        'overtime_warning_5_notified',
        'overtime_notified',
      ]),
    );
  });

  it('drops sent_notifications table', () => {
    const row = dbExport
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sent_notifications'`)
      .get();
    expect(row).toBeUndefined();
  });

  it('cascades delete from categories to event_poller_state', () => {
    dbExport.exec(`
      INSERT INTO categories
        (name, icon, initial_target_wear_duration_seconds, initial_max_wear_duration_seconds,
         rest_multiplier, minimum_rest, risk_levels, break_decay_multiplier, break_grace_time)
      VALUES ('Cascade Test', 'icon', 900, 1800, 2, 86400, '[]', 0.91, 86400)
    `);
    const { id } = dbExport.prepare(`SELECT id FROM categories WHERE name = 'Cascade Test'`).get() as {
      id: number;
    };
    dbExport.prepare('INSERT INTO event_poller_state (category_id) VALUES (?)').run(id);
    dbExport.prepare('DELETE FROM categories WHERE id = ?').run(id);
    const row = dbExport.prepare('SELECT * FROM event_poller_state WHERE category_id = ?').get(id);
    expect(row).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- migration-009`
Expected: FAIL — `event_poller_state` table does not exist (`no such table`).

- [ ] **Step 3: Write the migration**

```typescript
// src/backend/src/db/migrations/009_events_bus.ts
import { dbExport } from '../index.js';

export default function runMigration009() {
  dbExport.exec(`
    DROP TABLE IF EXISTS sent_notifications;

    CREATE TABLE event_poller_state (
      category_id                  INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
      decay_state                  TEXT NOT NULL DEFAULT 'none',
      resting                      INTEGER NOT NULL DEFAULT 0,
      halfway_notified             INTEGER NOT NULL DEFAULT 0,
      decay_soon_notified          INTEGER NOT NULL DEFAULT 0,
      last_session_id              INTEGER,
      target_met_notified          INTEGER NOT NULL DEFAULT 0,
      overtime_warning_30_notified INTEGER NOT NULL DEFAULT 0,
      overtime_warning_5_notified  INTEGER NOT NULL DEFAULT 0,
      overtime_notified            INTEGER NOT NULL DEFAULT 0
    );
  `);
}
```

- [ ] **Step 4: Register the migration**

In `src/backend/src/db/migrations/index.ts`, add the import and array entry:

```typescript
import runMigration009 from './009_events_bus.js';
```

```typescript
  { version: 9, name: '009_events_bus', run: runMigration009 },
```

(Add both after the existing `008_session_day_index` import/entry, keeping the array in version order.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- migration-009`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/backend/src/db/migrations/009_events_bus.ts src/backend/src/db/migrations/index.ts src/backend/tests/db/migration-009.test.ts
git commit -m "feat(backend): add event_poller_state table, drop sent_notifications"
```

---

### Task 2: `events/bus.ts` — typed event bus

**Files:**
- Create: `src/backend/src/events/bus.ts`
- Test: `src/backend/tests/events/bus.test.ts`

**Interfaces:**
- Produces: `eventBus` (singleton), `EventName` (union of 12 string literals), `EventPayloads` (mapped type), and one payload interface per event — all imported by `poller.ts`, `session-store.ts`, and (in PR 2) `mqtt/subscriber.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/events/bus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { eventBus } from '../../src/events/bus.js';

describe('eventBus', () => {
  it('delivers an emitted payload to a registered listener', () => {
    const listener = vi.fn();
    eventBus.on('rest_start', listener);
    eventBus.emit('rest_start', {
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 1000,
      rest_seconds: 3600,
    });
    expect(listener).toHaveBeenCalledWith({
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 1000,
      rest_seconds: 3600,
    });
  });

  it('does not deliver to listeners of a different event', () => {
    const listener = vi.fn();
    eventBus.on('decay_finish', listener);
    eventBus.emit('rest_end', {
      category_id: 2,
      category_name: 'Gloves',
      timestamp: 2000,
      rest_seconds: 100,
      elapsed_rest_seconds: 100,
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- events/bus`
Expected: FAIL — cannot find module `../../src/events/bus.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/backend/src/events/bus.ts
import { EventEmitter } from 'node:events';

export interface CategoryContext {
  category_id: number;
  category_name: string;
  timestamp: number;
}

export interface SessionStartEvent extends CategoryContext {
  session_id: number;
  item_id: number;
  target_wear_seconds: number;
  max_wear_seconds: number | null;
}

export interface SessionEndEvent extends CategoryContext {
  session_id: number;
  item_id: number;
  target_wear_seconds: number;
  max_wear_seconds: number | null;
  actual_duration_seconds: number;
  rest_seconds: number;
  risk_level: string | null;
}

export interface RestStartEvent extends CategoryContext {
  rest_seconds: number;
}

export interface RestEndEvent extends CategoryContext {
  rest_seconds: number;
  elapsed_rest_seconds: number;
}

export interface DecayStartEvent extends CategoryContext {
  decay_state: 'decaying' | 'fully_decayed';
  decay_full_time: number;
}

export interface DecayFinishEvent extends CategoryContext {
  decay_state: 'fully_decayed';
}

export type HalfwayReachedEvent = CategoryContext;
export type DecaySoonEvent = CategoryContext;

export interface SessionThresholdEvent extends CategoryContext {
  session_id: number;
}

export interface EventPayloads {
  session_start: SessionStartEvent;
  session_end: SessionEndEvent;
  rest_start: RestStartEvent;
  rest_end: RestEndEvent;
  decay_start: DecayStartEvent;
  decay_finish: DecayFinishEvent;
  halfway_reached: HalfwayReachedEvent;
  decay_soon: DecaySoonEvent;
  target_met: SessionThresholdEvent;
  overtime_warning_30: SessionThresholdEvent;
  overtime_warning_5: SessionThresholdEvent;
  overtime: SessionThresholdEvent;
}

export type EventName = keyof EventPayloads;

class TypedEventBus {
  private emitter = new EventEmitter();

  emit<E extends EventName>(event: E, payload: EventPayloads[E]): void {
    this.emitter.emit(event, payload);
  }

  on<E extends EventName>(event: E, listener: (payload: EventPayloads[E]) => void): void {
    this.emitter.on(event, listener);
  }
}

export const eventBus = new TypedEventBus();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- events/bus`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/events/bus.ts src/backend/tests/events/bus.test.ts
git commit -m "feat(backend): add typed internal event bus"
```

---

### Task 3: `events/store.ts` — DB-backed poller state

**Files:**
- Create: `src/backend/src/events/store.ts`
- Test: `src/backend/tests/events/store.test.ts`

**Interfaces:**
- Consumes: `db` default export from `../db/index.js`.
- Produces: `eventPollerStore` (singleton) with `get(categoryId: number): EventPollerRow | undefined` and `upsert(row: EventPollerRow): void`; `EventPollerRow` type — both consumed by `poller.ts` (Task 4).

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/events/store.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { dbExport } from '../../src/db/index.js';
import { eventPollerStore } from '../../src/events/store.js';

beforeAll(() => {
  runMigrations();
});

beforeEach(() => {
  dbExport.exec('DELETE FROM event_poller_state; DELETE FROM categories;');
  dbExport.exec(`
    INSERT INTO categories
      (id, name, icon, initial_target_wear_duration_seconds, initial_max_wear_duration_seconds,
       rest_multiplier, minimum_rest, risk_levels, break_decay_multiplier, break_grace_time)
    VALUES (1, 'Test', 'icon', 900, 1800, 2, 86400, '[]', 0.91, 86400)
  `);
});

describe('eventPollerStore', () => {
  it('returns undefined for a category with no stored row', () => {
    expect(eventPollerStore.get(1)).toBeUndefined();
  });

  it('upserts and reads back a row', () => {
    eventPollerStore.upsert({
      category_id: 1,
      decay_state: 'decaying',
      resting: 1,
      halfway_notified: 0,
      decay_soon_notified: 1,
      last_session_id: 42,
      target_met_notified: 0,
      overtime_warning_30_notified: 0,
      overtime_warning_5_notified: 0,
      overtime_notified: 0,
    });
    expect(eventPollerStore.get(1)).toEqual({
      category_id: 1,
      decay_state: 'decaying',
      resting: 1,
      halfway_notified: 0,
      decay_soon_notified: 1,
      last_session_id: 42,
      target_met_notified: 0,
      overtime_warning_30_notified: 0,
      overtime_warning_5_notified: 0,
      overtime_notified: 0,
    });
  });

  it('overwrites an existing row on repeat upsert', () => {
    eventPollerStore.upsert({
      category_id: 1, decay_state: 'none', resting: 0, halfway_notified: 0, decay_soon_notified: 0,
      last_session_id: null, target_met_notified: 0, overtime_warning_30_notified: 0,
      overtime_warning_5_notified: 0, overtime_notified: 0,
    });
    eventPollerStore.upsert({
      category_id: 1, decay_state: 'fully_decayed', resting: 0, halfway_notified: 1, decay_soon_notified: 1,
      last_session_id: 7, target_met_notified: 1, overtime_warning_30_notified: 1,
      overtime_warning_5_notified: 1, overtime_notified: 1,
    });
    expect(eventPollerStore.get(1)?.decay_state).toBe('fully_decayed');
    expect(eventPollerStore.get(1)?.last_session_id).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- events/store`
Expected: FAIL — cannot find module `../../src/events/store.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/backend/src/events/store.ts
import db from '../db/index.js';
import type { DecayState } from '../db/calculations.js';

export interface EventPollerRow {
  category_id: number;
  decay_state: DecayState;
  resting: number;
  halfway_notified: number;
  decay_soon_notified: number;
  last_session_id: number | null;
  target_met_notified: number;
  overtime_warning_30_notified: number;
  overtime_warning_5_notified: number;
  overtime_notified: number;
}

class EventPollerStore {
  get(categoryId: number): EventPollerRow | undefined {
    return db.prepare('SELECT * FROM event_poller_state WHERE category_id = ?').get(categoryId) as
      | EventPollerRow
      | undefined;
  }

  upsert(row: EventPollerRow): void {
    db.prepare(
      `INSERT INTO event_poller_state
         (category_id, decay_state, resting, halfway_notified, decay_soon_notified,
          last_session_id, target_met_notified, overtime_warning_30_notified,
          overtime_warning_5_notified, overtime_notified)
       VALUES (@category_id, @decay_state, @resting, @halfway_notified, @decay_soon_notified,
               @last_session_id, @target_met_notified, @overtime_warning_30_notified,
               @overtime_warning_5_notified, @overtime_notified)
       ON CONFLICT (category_id) DO UPDATE SET
         decay_state = excluded.decay_state,
         resting = excluded.resting,
         halfway_notified = excluded.halfway_notified,
         decay_soon_notified = excluded.decay_soon_notified,
         last_session_id = excluded.last_session_id,
         target_met_notified = excluded.target_met_notified,
         overtime_warning_30_notified = excluded.overtime_warning_30_notified,
         overtime_warning_5_notified = excluded.overtime_warning_5_notified,
         overtime_notified = excluded.overtime_notified`,
    ).run(row);
  }
}

export const eventPollerStore = new EventPollerStore();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- events/store`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/events/store.ts src/backend/tests/events/store.test.ts
git commit -m "feat(backend): add DB-backed event poller state store"
```

---

### Task 4: `events/poller.ts` — tick, diff, emit

**Files:**
- Create: `src/backend/src/events/poller.ts`
- Test: `src/backend/tests/events/poller.test.ts`

**Interfaces:**
- Consumes: `categoryStore.findAll()` (`../db/stores/category-store.js`), `sessionStore.findLastEndedInCategory(id)` / `sessionStore.findOpenWithItemData()` (`../db/stores/session-store.js`), `computeDecay` (`../db/calculations.js`), `eventPollerStore` (Task 3), `eventBus` (Task 2).
- Produces: `tick(now?: number): void` and `startEventsPoller(): void`, called from `server.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/events/poller.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { dbExport } from '../../src/db/index.js';
import { eventBus } from '../../src/events/bus.js';
import { eventPollerStore } from '../../src/events/store.js';
import { tick } from '../../src/events/poller.js';
import { createCategory, createItem } from '../fixtures.js';
import app from '../../src/server.js';

const SESSIONS = '/api/sessions';

runMigrations();

beforeEach(() => {
  dbExport.exec('DELETE FROM sessions; DELETE FROM items; DELETE FROM categories; DELETE FROM event_poller_state;');
});

async function setupCategoryAndItem(overrides: Record<string, unknown> = {}) {
  const cat = await (await createCategory(overrides)).json();
  const item = await (await createItem(cat.id)).json();
  return { categoryId: cat.id as number, itemId: item.id as number };
}

describe('events poller tick()', () => {
  it('does not fire rest_start/decay_start on the first-ever tick for existing history (no backfire)', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json();
    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 100 }),
    });

    const listener = vi.fn();
    eventBus.on('rest_start', listener);
    tick(150); // first-ever tick for this category: baseline only, no emit
    expect(listener).not.toHaveBeenCalled();
    expect(eventPollerStore.get(categoryId)?.resting).toBe(1);
  });

  it('fires rest_start on the tick after baseline, once', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json();
    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 100 }),
    });

    // Seed baseline as if a prior tick already ran before resting began.
    eventPollerStore.upsert({
      category_id: categoryId, decay_state: 'none', resting: 0, halfway_notified: 0,
      decay_soon_notified: 0, last_session_id: null, target_met_notified: 0,
      overtime_warning_30_notified: 0, overtime_warning_5_notified: 0, overtime_notified: 0,
    });

    const listener = vi.fn();
    eventBus.on('rest_start', listener);
    tick(150);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ category_id: categoryId });

    // Re-running the same tick again does not refire (restart-safety).
    tick(151);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires target_met once for an open session, resets on a new session', async () => {
    const { categoryId, itemId } = await setupCategoryAndItem();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 0 }),
    });
    const session = await startRes.json(); // target_wear_seconds: 900 (first session)

    eventPollerStore.upsert({
      category_id: categoryId, decay_state: 'none', resting: 0, halfway_notified: 0,
      decay_soon_notified: 0, last_session_id: session.id, target_met_notified: 0,
      overtime_warning_30_notified: 0, overtime_warning_5_notified: 0, overtime_notified: 0,
    });

    const listener = vi.fn();
    eventBus.on('target_met', listener);
    tick(900); // now >= started_at(0) + target(900)
    expect(listener).toHaveBeenCalledTimes(1);
    tick(901);
    expect(listener).toHaveBeenCalledTimes(1); // no refire

    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 1000 }),
    });
    const startRes2 = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, started_at: 100_000 }),
    });
    const session2 = await startRes2.json();
    tick(100_000 + session2.target_wear_seconds);
    expect(listener).toHaveBeenCalledTimes(2); // fires again for the new session
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- events/poller`
Expected: FAIL — cannot find module `../../src/events/poller.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/backend/src/events/poller.ts
import { categoryStore } from '../db/stores/category-store.js';
import { sessionStore } from '../db/stores/session-store.js';
import { computeDecay } from '../db/calculations.js';
import { eventBus } from './bus.js';
import { eventPollerStore, type EventPollerRow } from './store.js';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function defaultRow(categoryId: number): EventPollerRow {
  return {
    category_id: categoryId,
    decay_state: 'none',
    resting: 0,
    halfway_notified: 0,
    decay_soon_notified: 0,
    last_session_id: null,
    target_met_notified: 0,
    overtime_warning_30_notified: 0,
    overtime_warning_5_notified: 0,
    overtime_notified: 0,
  };
}

export function tick(now: number = nowSeconds()): void {
  const categories = categoryStore.findAll();
  const openSessions = sessionStore.findOpenWithItemData();
  const openByCategory = new Map(openSessions.map((s) => [s.category_id, s]));

  for (const category of categories) {
    const previous = sessionStore.findLastEndedInCategory(category.id) ?? null;
    const session = openByCategory.get(category.id) ?? null;
    const stored = eventPollerStore.get(category.id);
    const isFirstRun = stored === undefined;
    const row: EventPollerRow = stored ?? defaultRow(category.id);
    const shouldEmit = !isFirstRun;

    if (previous) {
      const restEnd = previous.ended_at + previous.rest_seconds;
      const resting = now < restEnd ? 1 : 0;
      const decay = computeDecay(previous, category, now);

      if (shouldEmit && row.resting === 0 && resting === 1) {
        eventBus.emit('rest_start', {
          category_id: category.id,
          category_name: category.name,
          timestamp: now,
          rest_seconds: previous.rest_seconds,
        });
      }
      if (shouldEmit && row.resting === 1 && resting === 0) {
        eventBus.emit('rest_end', {
          category_id: category.id,
          category_name: category.name,
          timestamp: now,
          rest_seconds: previous.rest_seconds,
          elapsed_rest_seconds: now - previous.ended_at,
        });
      }
      if (resting === 1 && row.resting === 0) {
        row.halfway_notified = 0;
        row.decay_soon_notified = 0;
      }
      row.resting = resting;

      if (shouldEmit && row.decay_state === 'none' && decay.decay_state !== 'none') {
        eventBus.emit('decay_start', {
          category_id: category.id,
          category_name: category.name,
          timestamp: now,
          decay_state: decay.decay_state as 'decaying' | 'fully_decayed',
          decay_full_time: decay.decay_full_time!,
        });
      }
      if (shouldEmit && row.decay_state !== 'fully_decayed' && decay.decay_state === 'fully_decayed') {
        eventBus.emit('decay_finish', {
          category_id: category.id,
          category_name: category.name,
          timestamp: now,
          decay_state: 'fully_decayed',
        });
      }
      row.decay_state = decay.decay_state;

      const decayStart = decay.decay_start_time!;
      const halfway = Math.floor((restEnd + decayStart) / 2);
      const decaySoonFire = decayStart - 3600;
      const decaySoonSuppressed =
        decaySoonFire < restEnd + 3600 || Math.abs(decaySoonFire - halfway) < 1800;

      if (row.halfway_notified === 0 && now >= halfway) {
        if (shouldEmit) {
          eventBus.emit('halfway_reached', { category_id: category.id, category_name: category.name, timestamp: now });
        }
        row.halfway_notified = 1;
      }

      if (!decaySoonSuppressed && row.decay_soon_notified === 0 && now >= decaySoonFire) {
        if (shouldEmit) {
          eventBus.emit('decay_soon', { category_id: category.id, category_name: category.name, timestamp: now });
        }
        row.decay_soon_notified = 1;
      }
    }

    if (session) {
      if (row.last_session_id !== session.id) {
        row.last_session_id = session.id;
        row.target_met_notified = 0;
        row.overtime_warning_30_notified = 0;
        row.overtime_warning_5_notified = 0;
        row.overtime_notified = 0;
      }

      if (row.target_met_notified === 0 && now >= session.started_at + session.target_wear_seconds) {
        if (shouldEmit) {
          eventBus.emit('target_met', {
            category_id: category.id, category_name: category.name, timestamp: now, session_id: session.id,
          });
        }
        row.target_met_notified = 1;
      }

      if (session.max_wear_seconds !== null) {
        const fire30 = session.started_at + session.max_wear_seconds - 1800;
        const fire5 = session.started_at + session.max_wear_seconds - 300;
        const fireOvertime = session.started_at + session.max_wear_seconds;
        const suppressed30 = fire30 <= session.started_at + 300;
        const suppressed5 = fire5 <= session.started_at + 300;

        if (!suppressed30 && row.overtime_warning_30_notified === 0 && now >= fire30) {
          if (shouldEmit) {
            eventBus.emit('overtime_warning_30', {
              category_id: category.id, category_name: category.name, timestamp: now, session_id: session.id,
            });
          }
          row.overtime_warning_30_notified = 1;
        }
        if (!suppressed5 && row.overtime_warning_5_notified === 0 && now >= fire5) {
          if (shouldEmit) {
            eventBus.emit('overtime_warning_5', {
              category_id: category.id, category_name: category.name, timestamp: now, session_id: session.id,
            });
          }
          row.overtime_warning_5_notified = 1;
        }
        if (row.overtime_notified === 0 && now >= fireOvertime) {
          if (shouldEmit) {
            eventBus.emit('overtime', {
              category_id: category.id, category_name: category.name, timestamp: now, session_id: session.id,
            });
          }
          row.overtime_notified = 1;
        }
      }
    }

    eventPollerStore.upsert(row);
  }
}

export function startEventsPoller(): void {
  tick();
  setInterval(() => tick(), 30_000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- events/poller`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/events/poller.ts src/backend/tests/events/poller.test.ts
git commit -m "feat(backend): add events poller — single tick, DB-backed edge detection"
```

---

### Task 5: `session-store.ts` — emit `session_start`/`session_end`

**Files:**
- Modify: `src/backend/src/db/stores/session-store.ts:164-175` (`start`), `:188-204` (`end`)
- Test: `src/backend/tests/events/session-hooks.test.ts`

**Interfaces:**
- Consumes: `eventBus` from `../../events/bus.js` (relative to `db/stores/`, i.e. `../../events/bus.js`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/events/session-hooks.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { dbExport } from '../../src/db/index.js';
import { eventBus } from '../../src/events/bus.js';
import { createCategory, createItem } from '../fixtures.js';
import app from '../../src/server.js';

const SESSIONS = '/api/sessions';

runMigrations();

beforeEach(() => {
  dbExport.exec('DELETE FROM sessions; DELETE FROM items; DELETE FROM categories;');
});

describe('session-store event hooks', () => {
  it('emits session_start with target/max on session start', async () => {
    const cat = await (await createCategory()).json();
    const item = await (await createItem(cat.id)).json();

    const listener = vi.fn();
    eventBus.on('session_start', listener);

    const res = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, started_at: 500 }),
    });
    const session = await res.json();

    expect(listener).toHaveBeenCalledWith({
      category_id: cat.id,
      category_name: cat.name,
      timestamp: 500,
      session_id: session.id,
      item_id: item.id,
      target_wear_seconds: session.target_wear_seconds,
      max_wear_seconds: session.max_wear_seconds,
    });
  });

  it('emits session_end with actual duration, rest, and risk level on session end', async () => {
    const cat = await (await createCategory()).json();
    const item = await (await createItem(cat.id)).json();
    const startRes = await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, started_at: 0 }),
    });
    const session = await startRes.json();

    const listener = vi.fn();
    eventBus.on('session_end', listener);

    await app.request(`${SESSIONS}/${session.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 600 }),
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const payload = listener.mock.calls[0][0];
    expect(payload).toMatchObject({
      category_id: cat.id,
      category_name: cat.name,
      timestamp: 600,
      session_id: session.id,
      item_id: item.id,
      actual_duration_seconds: 600,
    });
    expect(typeof payload.rest_seconds).toBe('number');
    expect(payload.risk_level === null || typeof payload.risk_level === 'string').toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- events/session-hooks`
Expected: FAIL — listener never called (0 calls received).

- [ ] **Step 3: Modify `session-store.ts`**

Add the import at the top of `src/backend/src/db/stores/session-store.ts`:

```typescript
import { eventBus } from '../../events/bus.js';
```

Replace the `start()` method (`session-store.ts:164-175`) with:

```typescript
  /** Start a new session. category is the raw DB row; item supplies difficulty. */
  start(itemId: number, category: Category, item: { difficulty_multiplier: number }, startedAt: number): Session {
    const previous = this.findLastEndedInCategory(category.id) ?? null;
    const injuryActive = injuryStore.hasActiveInCategory(category.id);
    const { target, max } = computeSessionStart(category, item, previous, startedAt, injuryActive);

    const result = db
      .prepare(
        'INSERT INTO sessions (item_id, started_at, target_wear_seconds, max_wear_seconds) VALUES (?, ?, ?, ?)',
      )
      .run(itemId, startedAt, target, max);
    const session = this.find(result.lastInsertRowid as number)!;

    eventBus.emit('session_start', {
      category_id: category.id,
      category_name: category.name,
      timestamp: startedAt,
      session_id: session.id,
      item_id: itemId,
      target_wear_seconds: session.target_wear_seconds,
      max_wear_seconds: session.max_wear_seconds,
    });

    return session;
  }
```

Replace the `end()` method (`session-store.ts:188-204`) with:

```typescript
  /** End a session: derive elapsed, compute rest, persist; target/max stay as set at start. */
  end(session: Session, category: Category, endedAt: number): Session {
    return db.transaction(() => {
      const elapsed = endedAt - session.started_at;
      const injuryActive = injuryStore.hasActiveInCategory(category.id);
      const riskLevel = riskLevelFor(elapsed, category);
      const rest = computeRest(elapsed, session.max_wear_seconds, category, riskLevel, injuryActive);

      db.prepare('UPDATE sessions SET ended_at = ?, rest_seconds = ? WHERE id = ?').run(endedAt, rest, session.id);

      const updated = this.find(session.id)!;
      const snapshot = { ...updated, ended_at: endedAt };
      statsStore.recordItemSession(snapshot);
      statsStore.recordCategorySession(category.id, category.break_grace_time, snapshot);
      this.recordDayIndex(session.id);

      eventBus.emit('session_end', {
        category_id: category.id,
        category_name: category.name,
        timestamp: endedAt,
        session_id: session.id,
        item_id: session.item_id,
        target_wear_seconds: session.target_wear_seconds,
        max_wear_seconds: session.max_wear_seconds,
        actual_duration_seconds: elapsed,
        rest_seconds: rest,
        risk_level: riskLevel?.text ?? null,
      });

      return updated;
    })();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- events/session-hooks`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full backend suite to check for regressions**

Run: `npm --prefix src/backend run test:ci`
Expected: PASS (all existing session/category/item/injury tests still green — no signatures changed).

- [ ] **Step 6: Commit**

```bash
git add src/backend/src/db/stores/session-store.ts src/backend/tests/events/session-hooks.test.ts
git commit -m "feat(backend): emit session_start/session_end on the event bus"
```

---

### Task 6: Wire `startEventsPoller()` into `server.ts`

**Files:**
- Modify: `src/backend/src/server.ts`

**Interfaces:**
- Consumes: `startEventsPoller` from `./events/poller.js`.

- [ ] **Step 1: Add the import and call**

In `src/backend/src/server.ts`, add near the other imports:

```typescript
import { startEventsPoller } from './events/poller.js';
```

And call it alongside the existing `runMigrations()`/`startScheduler()` calls near the top of the file:

```typescript
runMigrations();
startScheduler();
startEventsPoller();
```

- [ ] **Step 2: Remove `sent_notifications` from the test-only `__reset` endpoint**

In `src/backend/src/server.ts`, find the `/api/__reset` handler and replace:

```typescript
      DELETE FROM push_subscriptions;
      DELETE FROM sent_notifications;
```

with:

```typescript
      DELETE FROM push_subscriptions;
      DELETE FROM event_poller_state;
```

- [ ] **Step 3: Run the full backend suite**

Run: `npm --prefix src/backend run test:ci`
Expected: PASS — server boots, poller starts, no test references `sent_notifications` via `__reset` anymore.

- [ ] **Step 4: Commit**

```bash
git add src/backend/src/server.ts
git commit -m "feat(backend): start the events poller alongside the notification scheduler"
```

---

### Task 7: Refactor `notifications/runner.ts` into a pure bus subscriber

**Files:**
- Modify: `src/backend/src/notifications/runner.ts` (full rewrite)
- Test: `src/backend/tests/notifications/runner.test.ts`

**Interfaces:**
- Consumes: `eventBus`, `EventName` from `../events/bus.js`; `send`, `isConfigured` from `./sender.js`; `notificationStore` from `./store.js` (Task 8 trims this to keep `getSubscription`/`upsertSubscription`/`deleteSubscription`).
- Produces: `startScheduler(): void`, same exported name and zero-arg signature as today (so `server.ts`'s existing `startScheduler()` call, added back in Task 6's diff, keeps working unmodified).

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/notifications/runner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/notifications/sender.js', () => ({
  isConfigured: true,
  send: vi.fn().mockResolvedValue(undefined),
}));

import { eventBus } from '../../src/events/bus.js';
import { notificationStore } from '../../src/notifications/store.js';
import { send } from '../../src/notifications/sender.js';
import { startScheduler } from '../../src/notifications/runner.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(notificationStore, 'getSubscription').mockReturnValue('{"endpoint":"https://x"}');
});

describe('notifications runner (bus subscriber)', () => {
  it('sends a push notification when rest_end fires', async () => {
    startScheduler();
    eventBus.emit('rest_end', {
      category_id: 1, category_name: 'Footwear', timestamp: 100, rest_seconds: 3600, elapsed_rest_seconds: 3600,
    });
    await new Promise((r) => setTimeout(r, 0)); // let the async listener settle
    expect(send).toHaveBeenCalledWith(
      '{"endpoint":"https://x"}',
      expect.objectContaining({ tag: 'category-1' }),
    );
  });

  it('sends nothing for decay_start (no notification defined for it)', async () => {
    startScheduler();
    eventBus.emit('decay_start', {
      category_id: 1, category_name: 'Footwear', timestamp: 100, decay_state: 'decaying', decay_full_time: 200,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(send).not.toHaveBeenCalled();
  });

  it('does not send when there is no stored push subscription', async () => {
    vi.mocked(notificationStore.getSubscription).mockReturnValue(null);
    startScheduler();
    eventBus.emit('target_met', { category_id: 1, category_name: 'Footwear', timestamp: 100, session_id: 5 });
    await new Promise((r) => setTimeout(r, 0));
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- notifications/runner`
Expected: FAIL — `startScheduler` still uses the old `computeDueNotifications`/interval-based implementation; `send` is never called synchronously from an emitted event.

- [ ] **Step 3: Rewrite `runner.ts`**

```typescript
// src/backend/src/notifications/runner.ts
import { eventBus, type EventName } from '../events/bus.js';
import { send, isConfigured } from './sender.js';
import { notificationStore } from './store.js';

interface Copy {
  title: string;
  body: string;
}

function copyFor(event: EventName, categoryName: string): Copy | null {
  switch (event) {
    case 'rest_end':
      return { title: `${categoryName} wearable`, body: 'Rest period is over' };
    case 'halfway_reached':
      return { title: `Wear ${categoryName} soon`, body: 'Your idle time is halfway up' };
    case 'decay_soon':
      return { title: `Wear ${categoryName} now!`, body: 'Durations start decaying in 1 hour' };
    case 'target_met':
      return { title: `${categoryName} target reached!`, body: 'You can stop when ready' };
    case 'overtime_warning_30':
      return { title: `${categoryName}: 30 minutes left`, body: 'End your session before overtime' };
    case 'overtime_warning_5':
      return { title: `Stop wearing ${categoryName}`, body: '5 minutes until overtime' };
    case 'overtime':
      return { title: `Stop wearing ${categoryName} now!`, body: 'Your session is in overtime' };
    default:
      return null;
  }
}

const NOTIFICATION_EVENTS: EventName[] = [
  'rest_end',
  'halfway_reached',
  'decay_soon',
  'target_met',
  'overtime_warning_30',
  'overtime_warning_5',
  'overtime',
];

async function notify(event: EventName, categoryId: number, categoryName: string): Promise<void> {
  const subscription = notificationStore.getSubscription();
  if (!subscription) return;
  const copy = copyFor(event, categoryName);
  if (!copy) return;
  try {
    await send(subscription, { title: copy.title, body: copy.body, tag: `category-${categoryId}` });
  } catch (e: unknown) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 410 || status === 404) {
      notificationStore.deleteSubscription();
      return;
    }
    console.error(`[notifications] Failed to send ${event} for category ${categoryId}:`, e);
  }
}

export function startScheduler(): void {
  if (!isConfigured) {
    console.warn('[notifications] VAPID env vars not set — push notifications disabled');
    return;
  }
  for (const event of NOTIFICATION_EVENTS) {
    eventBus.on(event, (payload) => {
      void notify(event, payload.category_id, payload.category_name);
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- notifications/runner`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/notifications/runner.ts src/backend/tests/notifications/runner.test.ts
git commit -m "refactor(backend): notifications runner becomes a pure event-bus subscriber"
```

---

### Task 8: Trim `notifications/store.ts`, delete `scheduler.ts` and `types.ts`

**Files:**
- Modify: `src/backend/src/notifications/store.ts`
- Delete: `src/backend/src/notifications/scheduler.ts`
- Delete: `src/backend/src/notifications/types.ts`
- Delete: `src/backend/tests/notifications/scheduler.test.ts`

**Interfaces:**
- Produces: `notificationStore` retains only `getSubscription()`, `upsertSubscription(json)`, `deleteSubscription()` — the surface `controllers/notifications.ts` and `runner.ts` (Task 7) actually use.

- [ ] **Step 1: Delete the superseded files**

```bash
rm src/backend/src/notifications/scheduler.ts
rm src/backend/src/notifications/types.ts
rm src/backend/tests/notifications/scheduler.test.ts
```

- [ ] **Step 2: Rewrite `store.ts`**

```typescript
// src/backend/src/notifications/store.ts
import db from '../db/index.js';

class NotificationStore {
  getSubscription(): string | null {
    const row = db.prepare('SELECT subscription_json FROM push_subscriptions LIMIT 1').get() as
      | { subscription_json: string }
      | undefined;
    return row?.subscription_json ?? null;
  }

  upsertSubscription(json: string): void {
    db.prepare('DELETE FROM push_subscriptions').run();
    db.prepare('INSERT INTO push_subscriptions (subscription_json, created_at) VALUES (?, ?)').run(
      json,
      Math.floor(Date.now() / 1000),
    );
  }

  deleteSubscription(): void {
    db.prepare('DELETE FROM push_subscriptions').run();
  }
}

export const notificationStore = new NotificationStore();
```

- [ ] **Step 3: Search for any remaining references to the deleted symbols**

Run: `grep -rn "computeDueNotifications\|CategorySchedulerState\|DueNotification\|NotificationType\|tryMarkSent\|getSentForSessions\|getSchedulerState" src/backend/src src/backend/tests`
Expected: no output (only this plan file and the git history reference them).

- [ ] **Step 4: Run the full backend suite**

Run: `npm --prefix src/backend run test:ci`
Expected: PASS — `tests/notifications/controller.test.ts` (unaffected, uses only `getSubscription`/`upsertSubscription`/`deleteSubscription` indirectly via the controller) and all other suites green.

- [ ] **Step 5: Commit**

```bash
git add -A src/backend/src/notifications src/backend/tests/notifications
git commit -m "refactor(backend): remove superseded notification scheduler, types, and dedup table usage"
```

---

### Task 9: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the complete backend test suite**

Run: `npm --prefix src/backend run test:ci`
Expected: PASS, 0 failures.

- [ ] **Step 2: Run lint**

Run: `npm --prefix src/backend run lint`
Expected: PASS, 0 errors.

- [ ] **Step 3: Run a full build**

Run: `npm --prefix src/backend run build`
Expected: PASS, `tsc` reports no type errors (confirms `EventPayloads` generic usage in `runner.ts` and `poller.ts` type-checks cleanly).

- [ ] **Step 4: Manual smoke check (dev server)**

Run: `npm run dev` (from repo root) and watch the console for `[notifications] VAPID env vars not set — push notifications disabled` (expected in local dev without VAPID env vars) and no thrown errors from `startEventsPoller()` on boot.

- [ ] **Step 5: Commit (if step 4 required any fixups; otherwise skip)**

```bash
git add -A
git commit -m "chore(backend): fix regressions from events bus refactor"
```
