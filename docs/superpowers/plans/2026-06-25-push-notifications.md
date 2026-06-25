# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Web Push notifications for wear-cycle events (rest end, idle milestones, decay warning, target met, overtime) using a compute-on-demand 30s server-side scheduler.

**Architecture:** A `setInterval` tick on the backend derives due notifications from live state each tick and deduplicates via a `sent_notifications` DB table, keyed by `(session_id, type)`. Implicit cancellation: idle notifications are keyed off the previous session ID and stop being "due" once a new session starts. Web Push (VAPID) delivers encrypted payloads via the OS push infrastructure, waking the service worker even when the app is closed.

**Tech Stack:** `web-push` npm package (backend), `vite-plugin-pwa` injectManifest strategy (frontend), Workbox precaching in custom SW, Vue 3 composable, Konsta UI toggle.

## Global Constraints

- All notification copy is verbatim from spec: titles use `[Category] wearable`, `Wear [category] soon`, etc.
- Notification tag is `category-${category.id}` — same-category notifications replace rather than stack.
- VAPID vars missing → scheduler does not start, `GET /api/notifications/vapid-public-key` returns `{ publicKey: null }`, rest of app unaffected.
- `sent_notifications` deduplication uses `INSERT OR IGNORE`; check `result.changes > 0` to decide whether to send.
- `fire_at` thresholds use `<=` (not `<`) for session suppression: `fire_at <= started_at + 300`.
- `decay_soon` suppression uses strict `< 1800` for the halfway buffer.

---

## File Map

**Backend (new)**
- `src/backend/src/db/migrations/005_push_notifications.ts` — creates `push_subscriptions` and `sent_notifications` tables
- `src/backend/src/notifications/types.ts` — shared TypeScript types for the notification subsystem
- `src/backend/src/notifications/store.ts` — DB access: scheduler state, subscription CRUD, sent tracking
- `src/backend/src/notifications/scheduler.ts` — pure function: `computeDueNotifications`
- `src/backend/src/notifications/sender.ts` — web-push wrapper + VAPID init
- `src/backend/src/notifications/runner.ts` — `setInterval` glue connecting store/scheduler/sender
- `src/backend/src/controllers/notifications.ts` — API endpoints

**Backend (modified)**
- `src/backend/src/db/migrations/index.ts` — register migration 005
- `src/backend/src/server.ts` — mount notifications router, call `startScheduler()`, add tables to `__reset`

**Backend (tests)**
- `src/backend/tests/db/migration-005.test.ts`
- `src/backend/tests/notifications/scheduler.test.ts`
- `src/backend/tests/notifications/controller.test.ts`

**Frontend (new)**
- `src/frontend/src/sw.ts` — custom service worker with push + notificationclick handlers
- `src/frontend/src/composables/useNotifications.ts` — permission/subscription lifecycle

**Frontend (modified)**
- `src/frontend/vite.config.ts` — switch to `injectManifest` strategy
- `src/frontend/src/components/SettingsDrawer.vue` — add notifications toggle

---

## Task 1: DB Migration (push_subscriptions + sent_notifications)

**Files:**
- Create: `src/backend/src/db/migrations/005_push_notifications.ts`
- Modify: `src/backend/src/db/migrations/index.ts`
- Test: `src/backend/tests/db/migration-005.test.ts`

**Interfaces:**
- Produces: `push_subscriptions(id, subscription_json, created_at)` and `sent_notifications(id, session_id, type, sent_at, UNIQUE(session_id,type))` tables

- [ ] **Step 1: Write the failing migration test**

```typescript
// src/backend/tests/db/migration-005.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { dbExport } from '../../src/db/index.js';
import runMigration001 from '../../src/db/migrations/001_initial.js';
import runMigration005 from '../../src/db/migrations/005_push_notifications.js';

beforeAll(() => {
  runMigration001();
  runMigration005();
});

describe('migration 005', () => {
  it('creates push_subscriptions table', () => {
    const row = dbExport
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='push_subscriptions'`)
      .get();
    expect(row).toBeDefined();
  });

  it('push_subscriptions has subscription_json and created_at', () => {
    const cols = (dbExport.prepare('PRAGMA table_info(push_subscriptions)').all() as Array<{ name: string }>)
      .map(r => r.name);
    expect(cols).toContain('subscription_json');
    expect(cols).toContain('created_at');
  });

  it('creates sent_notifications table', () => {
    const row = dbExport
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sent_notifications'`)
      .get();
    expect(row).toBeDefined();
  });

  it('sent_notifications has session_id, type, sent_at', () => {
    const cols = (dbExport.prepare('PRAGMA table_info(sent_notifications)').all() as Array<{ name: string }>)
      .map(r => r.name);
    expect(cols).toContain('session_id');
    expect(cols).toContain('type');
    expect(cols).toContain('sent_at');
  });

  it('sent_notifications enforces unique (session_id, type)', () => {
    dbExport.prepare('INSERT INTO sent_notifications (session_id, type, sent_at) VALUES (1, "rest_end", 100)').run();
    expect(() =>
      dbExport.prepare('INSERT INTO sent_notifications (session_id, type, sent_at) VALUES (1, "rest_end", 200)').run()
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src/backend && npx vitest run tests/db/migration-005.test.ts
```
Expected: FAIL — `Cannot find module '../../src/db/migrations/005_push_notifications.js'`

- [ ] **Step 3: Write the migration**

```typescript
// src/backend/src/db/migrations/005_push_notifications.ts
import { dbExport } from '../index.js';

export default function runMigration005() {
  dbExport.exec(`
    CREATE TABLE push_subscriptions (
      id                INTEGER PRIMARY KEY,
      subscription_json TEXT NOT NULL,
      created_at        INTEGER NOT NULL
    );

    CREATE TABLE sent_notifications (
      id         INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL,
      type       TEXT NOT NULL,
      sent_at    INTEGER NOT NULL,
      UNIQUE (session_id, type)
    );
  `);
}
```

- [ ] **Step 4: Register in migrations index**

```typescript
// src/backend/src/db/migrations/index.ts
import { dbExport } from '../index.js';
import runMigration001 from './001_initial.js';
import runMigration002 from './002_oklch_colors.js';
import runMigration003 from './003_target_max_wear.js';
import runMigration004 from './004_drop_legacy_columns.js';
import runMigration005 from './005_push_notifications.js';

const migrations: Array<{ version: number; name: string; run: () => void }> = [
  { version: 1, name: '001_initial', run: runMigration001 },
  { version: 2, name: '002_oklch_colors', run: runMigration002 },
  { version: 3, name: '003_target_max_wear', run: runMigration003 },
  { version: 4, name: '004_drop_legacy_columns', run: runMigration004 },
  { version: 5, name: '005_push_notifications', run: runMigration005 },
];

export function runMigrations() {
  dbExport.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      schema_version INTEGER PRIMARY KEY,
      applied_at     TEXT NOT NULL,
      name           TEXT NOT NULL
    );
  `);

  const current = (
    dbExport.prepare('SELECT MAX(schema_version) as v FROM meta').get() as { v: number | null }
  ).v ?? 0;

  for (const migration of migrations) {
    if (migration.version > current) {
      migration.run();
      dbExport
        .prepare('INSERT OR REPLACE INTO meta (schema_version, applied_at, name) VALUES (?, ?, ?)')
        .run(migration.version, new Date().toISOString(), migration.name);
    }
  }
}

export default runMigrations;
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd src/backend && npx vitest run tests/db/migration-005.test.ts
```
Expected: PASS — all 5 assertions green

- [ ] **Step 6: Commit**

```bash
git add src/backend/src/db/migrations/005_push_notifications.ts src/backend/src/db/migrations/index.ts src/backend/tests/db/migration-005.test.ts
git commit -m "feat(be): add push_subscriptions and sent_notifications migration"
```

---

## Task 2: Notification Types + Store

**Files:**
- Create: `src/backend/src/notifications/types.ts`
- Create: `src/backend/src/notifications/store.ts`

**Interfaces:**
- Produces:
  - `NotificationType` union type
  - `CategorySchedulerState` interface
  - `DueNotification` interface
  - `notificationStore.getSchedulerState()` → `CategorySchedulerState[]`
  - `notificationStore.getSubscription()` → `string | null` (raw JSON)
  - `notificationStore.upsertSubscription(json: string)` → `void`
  - `notificationStore.deleteSubscription()` → `void`
  - `notificationStore.getSentForSessions(ids: number[])` → `Set<string>` (entries: `${session_id}:${type}`)
  - `notificationStore.tryMarkSent(sessionId: number, type: string, sentAt: number)` → `boolean`

- [ ] **Step 1: Write the types file**

```typescript
// src/backend/src/notifications/types.ts
export type NotificationType =
  | 'rest_end'
  | 'halfway'
  | 'decay_soon'
  | 'target_met'
  | 'overtime_warning_30'
  | 'overtime_warning_5'
  | 'overtime';

export interface CategorySchedulerState {
  category_id: number;
  category_name: string;
  break_grace_time: number;
  previous: { id: number; ended_at: number; rest_seconds: number } | null;
  session: {
    id: number;
    started_at: number;
    target_wear_seconds: number;
    max_wear_seconds: number | null;
  } | null;
}

export interface DueNotification {
  session_id: number;
  category_id: number;
  type: NotificationType;
  title: string;
  body: string;
  tag: string;
}
```

- [ ] **Step 2: Write the notification store**

```typescript
// src/backend/src/notifications/store.ts
import db from '../db/index.js';
import type { CategorySchedulerState, NotificationType } from './types.js';

class NotificationStore {
  getSchedulerState(): CategorySchedulerState[] {
    const catRows = db.prepare(`
      SELECT c.id AS category_id, c.name AS category_name, c.break_grace_time,
             s.id AS prev_id, s.ended_at AS prev_ended_at, s.rest_seconds AS prev_rest_seconds
      FROM categories c
      LEFT JOIN sessions s ON s.id = (
        SELECT s2.id FROM sessions s2 JOIN items i2 ON i2.id = s2.item_id
        WHERE i2.category_id = c.id AND s2.ended_at IS NOT NULL AND s2.ended_in_injury = 0
        ORDER BY s2.ended_at DESC LIMIT 1
      )
    `).all() as Array<{
      category_id: number; category_name: string; break_grace_time: number;
      prev_id: number | null; prev_ended_at: number | null; prev_rest_seconds: number | null;
    }>;

    const openSessions = db.prepare(`
      SELECT s.id, s.started_at, s.target_wear_seconds, s.max_wear_seconds, i.category_id
      FROM sessions s JOIN items i ON i.id = s.item_id WHERE s.ended_at IS NULL
    `).all() as Array<{
      id: number; started_at: number; target_wear_seconds: number;
      max_wear_seconds: number | null; category_id: number;
    }>;

    const openByCategory = new Map(openSessions.map(s => [s.category_id, s]));

    return catRows.map(row => ({
      category_id: row.category_id,
      category_name: row.category_name,
      break_grace_time: row.break_grace_time,
      previous: row.prev_id !== null
        ? { id: row.prev_id, ended_at: row.prev_ended_at!, rest_seconds: row.prev_rest_seconds! }
        : null,
      session: openByCategory.get(row.category_id) ?? null,
    }));
  }

  getSubscription(): string | null {
    const row = db.prepare('SELECT subscription_json FROM push_subscriptions LIMIT 1').get() as
      { subscription_json: string } | undefined;
    return row?.subscription_json ?? null;
  }

  upsertSubscription(json: string): void {
    db.prepare('DELETE FROM push_subscriptions').run();
    db.prepare('INSERT INTO push_subscriptions (subscription_json, created_at) VALUES (?, ?)')
      .run(json, Math.floor(Date.now() / 1000));
  }

  deleteSubscription(): void {
    db.prepare('DELETE FROM push_subscriptions').run();
  }

  getSentForSessions(sessionIds: number[]): Set<string> {
    if (sessionIds.length === 0) return new Set();
    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = db.prepare(
      `SELECT session_id, type FROM sent_notifications WHERE session_id IN (${placeholders})`
    ).all(...sessionIds) as { session_id: number; type: string }[];
    return new Set(rows.map(r => `${r.session_id}:${r.type}`));
  }

  tryMarkSent(sessionId: number, type: NotificationType, sentAt: number): boolean {
    const result = db.prepare(
      'INSERT OR IGNORE INTO sent_notifications (session_id, type, sent_at) VALUES (?, ?, ?)'
    ).run(sessionId, type, sentAt);
    return result.changes > 0;
  }
}

export const notificationStore = new NotificationStore();
```

- [ ] **Step 3: Run the full backend test suite to confirm no regressions**

```bash
cd src/backend && npx vitest run
```
Expected: all existing tests PASS (store has no unit test of its own — it's covered by the controller test in Task 4)

- [ ] **Step 4: Commit**

```bash
git add src/backend/src/notifications/types.ts src/backend/src/notifications/store.ts
git commit -m "feat(be): add notification types and DB store"
```

---

## Task 3: Scheduler Pure Function (TDD)

**Files:**
- Create: `src/backend/src/notifications/scheduler.ts`
- Test: `src/backend/tests/notifications/scheduler.test.ts`

**Interfaces:**
- Consumes: `CategorySchedulerState`, `DueNotification`, `NotificationType` from `./types.ts`
- Produces: `computeDueNotifications(states: CategorySchedulerState[], alreadySent: Set<string>, now: number): DueNotification[]`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/backend/tests/notifications/scheduler.test.ts
import { describe, it, expect } from 'vitest';
import { computeDueNotifications } from '../../src/notifications/scheduler.js';
import type { CategorySchedulerState } from '../../src/notifications/types.js';

function state(overrides: Partial<CategorySchedulerState> = {}): CategorySchedulerState {
  return {
    category_id: 1,
    category_name: 'Test',
    break_grace_time: 86400,
    previous: null,
    session: null,
    ...overrides,
  };
}

describe('computeDueNotifications', () => {
  it('returns empty array when no states', () => {
    expect(computeDueNotifications([], new Set(), 1000)).toEqual([]);
  });

  it('returns nothing for category with no history', () => {
    expect(computeDueNotifications([state()], new Set(), 1000)).toEqual([]);
  });

  describe('idle period', () => {
    it('fires rest_end when now >= rest_end', () => {
      const s = state({ previous: { id: 42, ended_at: 1000, rest_seconds: 3600 } });
      // rest_end = 4600
      const due = computeDueNotifications([s], new Set(), 4600);
      expect(due.map(d => d.type)).toContain('rest_end');
    });

    it('does not fire rest_end before rest_end time', () => {
      const s = state({ previous: { id: 42, ended_at: 1000, rest_seconds: 3600 } });
      const due = computeDueNotifications([s], new Set(), 4599);
      expect(due.map(d => d.type)).not.toContain('rest_end');
    });

    it('fires halfway at floor((rest_end + decay_start) / 2)', () => {
      // rest_end = 0, decay_start = 86400, halfway = 43200
      const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 });
      const due = computeDueNotifications([s], new Set(), 43200);
      expect(due.map(d => d.type)).toContain('halfway');
    });

    it('does not fire halfway before halfway time', () => {
      const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 });
      const due = computeDueNotifications([s], new Set(), 43199);
      expect(due.map(d => d.type)).not.toContain('halfway');
    });

    describe('decay_soon suppression', () => {
      it('fires normally for 24h break_grace_time', () => {
        // decay_start = 86400, fire_at = 82800; rest_end = 0
        // fire_at (82800) >= rest_end + 3600 (3600) ✓
        // |82800 - 43200| = 39600 >= 1800 ✓
        const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 });
        const due = computeDueNotifications([s], new Set(), 82800);
        expect(due.map(d => d.type)).toContain('decay_soon');
      });

      it('suppressed when break_grace_time < 2h (fire_at < rest_end + 3600)', () => {
        // break_grace_time = 3600, decay_start = 3600, fire_at = 0 < rest_end (0) + 3600 = 3600
        const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 3600 });
        const due = computeDueNotifications([s], new Set(), 0);
        expect(due.map(d => d.type)).not.toContain('decay_soon');
      });

      it('suppressed when fire_at within 30 mins of halfway (2.5h grace)', () => {
        // break_grace_time = 9000, decay_start = 9000, halfway = 4500, fire_at = 5400
        // |5400 - 4500| = 900 < 1800 → suppressed
        const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 9000 });
        const due = computeDueNotifications([s], new Set(), 5400);
        expect(due.map(d => d.type)).not.toContain('decay_soon');
      });

      it('fires for exactly 3h grace time (boundary: |diff| == 1800, not suppressed)', () => {
        // break_grace_time = 10800, decay_start = 10800, halfway = 5400, fire_at = 7200
        // fire_at (7200) >= rest_end (0) + 3600 (3600) ✓
        // |7200 - 5400| = 1800 which is NOT < 1800 → not suppressed
        const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 10800 });
        const due = computeDueNotifications([s], new Set(), 7200);
        expect(due.map(d => d.type)).toContain('decay_soon');
      });
    });

    it('skips already-sent notifications', () => {
      const s = state({ previous: { id: 42, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 });
      const alreadySent = new Set(['42:rest_end']);
      const due = computeDueNotifications([s], alreadySent, 0);
      expect(due.map(d => d.type)).not.toContain('rest_end');
    });

    it('sets correct text for rest_end', () => {
      const s = state({ category_id: 7, category_name: 'Footwear', previous: { id: 1, ended_at: 0, rest_seconds: 0 } });
      const due = computeDueNotifications([s], new Set(), 0);
      const n = due.find(d => d.type === 'rest_end')!;
      expect(n.title).toBe('Footwear wearable');
      expect(n.body).toBe('Rest period is over');
      expect(n.tag).toBe('category-7');
      expect(n.session_id).toBe(1);
    });

    it('sets correct text for halfway', () => {
      const s = state({ category_name: 'Test', previous: { id: 1, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 });
      const due = computeDueNotifications([s], new Set(['1:rest_end']), 43200);
      const n = due.find(d => d.type === 'halfway')!;
      expect(n.title).toBe('Wear Test soon');
      expect(n.body).toBe('Your idle time is halfway up');
    });

    it('sets correct text for decay_soon', () => {
      const s = state({ category_name: 'Rings', previous: { id: 1, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 });
      const alreadySent = new Set(['1:rest_end', '1:halfway']);
      const due = computeDueNotifications([s], alreadySent, 82800);
      const n = due.find(d => d.type === 'decay_soon')!;
      expect(n.title).toBe('Wear Rings now!');
      expect(n.body).toBe('Durations start decaying in 1 hour');
    });
  });

  describe('active session', () => {
    it('fires target_met when now >= started_at + target', () => {
      const s = state({ session: { id: 10, started_at: 1000, target_wear_seconds: 3600, max_wear_seconds: 7200 } });
      const due = computeDueNotifications([s], new Set(), 4600);
      expect(due.map(d => d.type)).toContain('target_met');
    });

    it('does not fire target_met before target time', () => {
      const s = state({ session: { id: 10, started_at: 1000, target_wear_seconds: 3600, max_wear_seconds: 7200 } });
      const due = computeDueNotifications([s], new Set(), 4599);
      expect(due.map(d => d.type)).not.toContain('target_met');
    });

    it('fires overtime_warning_30 when max > 35 mins', () => {
      // started_at=0, max=7200, fire_at=5400 > 0+300=300 ✓
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 3600, max_wear_seconds: 7200 } });
      const due = computeDueNotifications([s], new Set(), 5400);
      expect(due.map(d => d.type)).toContain('overtime_warning_30');
    });

    it('suppresses overtime_warning_30 when fire_at <= started_at + 300', () => {
      // started_at=0, max=2000, fire_at=200 <= 300 → suppressed
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 1000, max_wear_seconds: 2000 } });
      const due = computeDueNotifications([s], new Set(), 200);
      expect(due.map(d => d.type)).not.toContain('overtime_warning_30');
    });

    it('suppresses overtime_warning_30 when fire_at exactly equals started_at + 300', () => {
      // started_at=0, max=2100, fire_at=300 <= 300 → suppressed
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 1000, max_wear_seconds: 2100 } });
      const due = computeDueNotifications([s], new Set(), 300);
      expect(due.map(d => d.type)).not.toContain('overtime_warning_30');
    });

    it('fires overtime_warning_30 when fire_at = started_at + 301', () => {
      // started_at=0, max=2101, fire_at=301 > 300 ✓
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 1000, max_wear_seconds: 2101 } });
      const due = computeDueNotifications([s], new Set(), 301);
      expect(due.map(d => d.type)).toContain('overtime_warning_30');
    });

    it('suppresses overtime_warning_5 when max <= 10 mins', () => {
      // started_at=0, max=600, fire_at=300 <= 300 → suppressed
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 300, max_wear_seconds: 600 } });
      const due = computeDueNotifications([s], new Set(), 300);
      expect(due.map(d => d.type)).not.toContain('overtime_warning_5');
    });

    it('fires overtime when now >= started_at + max', () => {
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 3600, max_wear_seconds: 7200 } });
      const due = computeDueNotifications([s], new Set(), 7200);
      expect(due.map(d => d.type)).toContain('overtime');
    });

    it('does not fire any overtime notifications when max is null', () => {
      const s = state({ session: { id: 10, started_at: 0, target_wear_seconds: 3600, max_wear_seconds: null } });
      const due = computeDueNotifications([s], new Set(), 100000);
      const types = due.map(d => d.type);
      expect(types).not.toContain('overtime_warning_30');
      expect(types).not.toContain('overtime_warning_5');
      expect(types).not.toContain('overtime');
    });

    it('skips idle notifications when session is active', () => {
      // Both previous and session exist — session wins
      const s = state({
        previous: { id: 1, ended_at: 0, rest_seconds: 0 },
        session: { id: 10, started_at: 0, target_wear_seconds: 3600, max_wear_seconds: null },
      });
      const due = computeDueNotifications([s], new Set(), 0);
      expect(due.map(d => d.type)).not.toContain('rest_end');
    });

    it('uses active session id as session_id', () => {
      const s = state({ session: { id: 99, started_at: 0, target_wear_seconds: 100, max_wear_seconds: null } });
      const due = computeDueNotifications([s], new Set(), 100);
      expect(due[0].session_id).toBe(99);
    });

    it('sets correct text for active session notifications', () => {
      const s = state({
        category_id: 3,
        category_name: 'Rings',
        session: { id: 5, started_at: 0, target_wear_seconds: 100, max_wear_seconds: 7200 },
      });
      const due = computeDueNotifications([s], new Set(), 100000);
      const target = due.find(d => d.type === 'target_met')!;
      expect(target.title).toBe('Rings target reached!');
      expect(target.body).toBe('You can stop when ready');
      expect(target.tag).toBe('category-3');

      const ot30 = due.find(d => d.type === 'overtime_warning_30')!;
      expect(ot30.title).toBe('Rings: 30 minutes left');
      expect(ot30.body).toBe('End your session before overtime');

      const ot5 = due.find(d => d.type === 'overtime_warning_5')!;
      expect(ot5.title).toBe('Stop wearing Rings');
      expect(ot5.body).toBe('5 minutes until overtime');

      const ot = due.find(d => d.type === 'overtime')!;
      expect(ot.title).toBe('Stop wearing Rings now!');
      expect(ot.body).toBe('Your session is in overtime');
    });
  });

  it('handles multiple categories independently', () => {
    const states = [
      state({ category_id: 1, session: { id: 1, started_at: 0, target_wear_seconds: 100, max_wear_seconds: null } }),
      state({ category_id: 2, previous: { id: 2, ended_at: 0, rest_seconds: 0 }, break_grace_time: 86400 }),
    ];
    const due = computeDueNotifications(states, new Set(), 100);
    const types = due.map(d => d.type);
    expect(types).toContain('target_met');
    expect(types).toContain('rest_end');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src/backend && npx vitest run tests/notifications/scheduler.test.ts
```
Expected: FAIL — `Cannot find module '../../src/notifications/scheduler.js'`

- [ ] **Step 3: Implement the scheduler**

```typescript
// src/backend/src/notifications/scheduler.ts
import type { CategorySchedulerState, DueNotification, NotificationType } from './types.js';

interface Candidate {
  type: NotificationType;
  fire_at: number;
  title: string;
  body: string;
  suppressed?: boolean;
}

export function computeDueNotifications(
  states: CategorySchedulerState[],
  alreadySent: Set<string>,
  now: number,
): DueNotification[] {
  const result: DueNotification[] = [];

  for (const { category_id, category_name, break_grace_time, previous, session } of states) {
    const tag = `category-${category_id}`;

    if (session !== null) {
      const { id: session_id, started_at, target_wear_seconds, max_wear_seconds } = session;
      const candidates: Candidate[] = [
        {
          type: 'target_met',
          fire_at: started_at + target_wear_seconds,
          title: `${category_name} target reached!`,
          body: 'You can stop when ready',
        },
      ];

      if (max_wear_seconds !== null) {
        const fire_30 = started_at + max_wear_seconds - 1800;
        const fire_5 = started_at + max_wear_seconds - 300;
        candidates.push(
          {
            type: 'overtime_warning_30',
            fire_at: fire_30,
            title: `${category_name}: 30 minutes left`,
            body: 'End your session before overtime',
            suppressed: fire_30 <= started_at + 300,
          },
          {
            type: 'overtime_warning_5',
            fire_at: fire_5,
            title: `Stop wearing ${category_name}`,
            body: '5 minutes until overtime',
            suppressed: fire_5 <= started_at + 300,
          },
          {
            type: 'overtime',
            fire_at: started_at + max_wear_seconds,
            title: `Stop wearing ${category_name} now!`,
            body: 'Your session is in overtime',
          },
        );
      }

      for (const c of candidates) {
        if (c.suppressed) continue;
        if (now < c.fire_at) continue;
        if (alreadySent.has(`${session_id}:${c.type}`)) continue;
        result.push({ session_id, category_id, type: c.type, title: c.title, body: c.body, tag });
      }
    } else if (previous !== null) {
      const { id: session_id, ended_at, rest_seconds } = previous;
      const rest_end = ended_at + rest_seconds;
      const decay_start = rest_end + break_grace_time;
      const halfway = Math.floor((rest_end + decay_start) / 2);
      const decay_soon_fire = decay_start - 3600;
      const decaySoonSuppressed =
        decay_soon_fire < rest_end + 3600 || Math.abs(decay_soon_fire - halfway) < 1800;

      const candidates: Candidate[] = [
        {
          type: 'rest_end',
          fire_at: rest_end,
          title: `${category_name} wearable`,
          body: 'Rest period is over',
        },
        {
          type: 'halfway',
          fire_at: halfway,
          title: `Wear ${category_name} soon`,
          body: 'Your idle time is halfway up',
        },
        {
          type: 'decay_soon',
          fire_at: decay_soon_fire,
          title: `Wear ${category_name} now!`,
          body: 'Durations start decaying in 1 hour',
          suppressed: decaySoonSuppressed,
        },
      ];

      for (const c of candidates) {
        if (c.suppressed) continue;
        if (now < c.fire_at) continue;
        if (alreadySent.has(`${session_id}:${c.type}`)) continue;
        result.push({ session_id, category_id, type: c.type, title: c.title, body: c.body, tag });
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd src/backend && npx vitest run tests/notifications/scheduler.test.ts
```
Expected: PASS — all assertions green

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/notifications/scheduler.ts src/backend/tests/notifications/scheduler.test.ts
git commit -m "feat(be): add notification scheduler pure function with TDD"
```

---

## Task 4: Sender, Runner, API Controller, Server Wiring

**Files:**
- Create: `src/backend/src/notifications/sender.ts`
- Create: `src/backend/src/notifications/runner.ts`
- Create: `src/backend/src/controllers/notifications.ts`
- Modify: `src/backend/src/server.ts`
- Test: `src/backend/tests/notifications/controller.test.ts`

**Interfaces:**
- Consumes: `notificationStore` from `./store.ts`, `computeDueNotifications` from `./scheduler.ts`
- Produces: `GET /api/notifications/vapid-public-key`, `POST /api/notifications/subscribe`, `DELETE /api/notifications/subscribe`

- [ ] **Step 1: Install web-push**

```bash
npm install web-push --prefix src/backend
npm install --save-dev @types/web-push --prefix src/backend
```

Expected: no errors; `src/backend/package.json` now lists `web-push` in dependencies and `@types/web-push` in devDependencies.

- [ ] **Step 2: Write the sender**

```typescript
// src/backend/src/notifications/sender.ts
import webpush from 'web-push';

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? null;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? null;
const vapidSubject = process.env.VAPID_SUBJECT ?? null;

export const isConfigured =
  vapidPublicKey !== null && vapidPrivateKey !== null && vapidSubject !== null;

if (isConfigured) {
  webpush.setVapidDetails(vapidSubject!, vapidPublicKey!, vapidPrivateKey!);
}

export function getPublicKey(): string | null {
  return vapidPublicKey;
}

export async function send(
  subscriptionJson: string,
  payload: { title: string; body: string; tag: string },
): Promise<void> {
  const subscription = JSON.parse(subscriptionJson) as webpush.PushSubscription;
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}
```

- [ ] **Step 3: Write the runner**

```typescript
// src/backend/src/notifications/runner.ts
import { notificationStore } from './store.js';
import { computeDueNotifications } from './scheduler.js';
import { send, isConfigured } from './sender.js';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function tick(): Promise<void> {
  const subscription = notificationStore.getSubscription();
  if (!subscription) return;

  const states = notificationStore.getSchedulerState();
  const sessionIds = states.flatMap(s =>
    [s.previous?.id, s.session?.id].filter((id): id is number => id !== undefined),
  );
  const alreadySent = notificationStore.getSentForSessions(sessionIds);
  const due = computeDueNotifications(states, alreadySent, nowSeconds());

  for (const notification of due) {
    const inserted = notificationStore.tryMarkSent(notification.session_id, notification.type, nowSeconds());
    if (!inserted) continue;
    try {
      await send(subscription, { title: notification.title, body: notification.body, tag: notification.tag });
    } catch (e) {
      console.error(`[notifications] Failed to send ${notification.type} for session ${notification.session_id}:`, e);
    }
  }
}

export function startScheduler(): void {
  if (!isConfigured) {
    console.warn('[notifications] VAPID env vars not set — push notifications disabled');
    return;
  }
  void tick();
  setInterval(() => void tick(), 30_000);
}
```

- [ ] **Step 4: Write the controller test**

```typescript
// src/backend/tests/notifications/controller.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../src/server.js';
import { runMigrations } from '../../src/db/migrations/index.js';

beforeAll(() => {
  runMigrations();
});

const NOTIFICATIONS = '/api/notifications';

describe('GET /api/notifications/vapid-public-key', () => {
  it('returns publicKey field', async () => {
    const res = await app.request(`${NOTIFICATIONS}/vapid-public-key`);
    expect(res.status).toBe(200);
    const body = await res.json() as { publicKey: string | null };
    expect('publicKey' in body).toBe(true);
    // In test env VAPID vars are not set, so null is expected
    expect(body.publicKey).toBeNull();
  });
});

describe('POST /api/notifications/subscribe', () => {
  it('stores a subscription and returns 200', async () => {
    const sub = {
      endpoint: 'https://push.example.com/test',
      keys: { p256dh: 'fake-p256dh', auth: 'fake-auth' },
    };
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    expect(res.status).toBe(200);
  });

  it('replaces existing subscription on re-subscribe', async () => {
    const sub1 = { endpoint: 'https://push.example.com/first', keys: { p256dh: 'a', auth: 'b' } };
    const sub2 = { endpoint: 'https://push.example.com/second', keys: { p256dh: 'c', auth: 'd' } };
    await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub1),
    });
    await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub2),
    });
    // Verify second subscription is stored (not first)
    const { prepare } = await import('../../src/db/index.js');
    const row = prepare('SELECT subscription_json FROM push_subscriptions').get() as
      { subscription_json: string } | undefined;
    expect(row).toBeDefined();
    expect(JSON.parse(row!.subscription_json).endpoint).toBe('https://push.example.com/second');
  });
});

describe('DELETE /api/notifications/subscribe', () => {
  it('removes the subscription and returns 200', async () => {
    // First subscribe
    await app.request(`${NOTIFICATIONS}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://example.com', keys: { p256dh: 'x', auth: 'y' } }),
    });
    // Then unsubscribe
    const res = await app.request(`${NOTIFICATIONS}/subscribe`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    // Verify gone
    const { prepare } = await import('../../src/db/index.js');
    const row = prepare('SELECT * FROM push_subscriptions').get();
    expect(row).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run the controller test to verify it fails**

```bash
cd src/backend && npx vitest run tests/notifications/controller.test.ts
```
Expected: FAIL — routes not found (404s)

- [ ] **Step 6: Write the controller**

```typescript
// src/backend/src/controllers/notifications.ts
import { Hono } from 'hono';
import { notificationStore } from '../notifications/store.js';
import { getPublicKey } from '../notifications/sender.js';
import { ValidationError } from '../middleware/errors.js';

export const router = new Hono();

router.get('/vapid-public-key', (c) => {
  return c.json({ publicKey: getPublicKey() });
});

router.post('/subscribe', async (c) => {
  const body = await c.req.json();
  if (typeof body.endpoint !== 'string' || !body.keys) {
    throw new ValidationError('Invalid push subscription');
  }
  notificationStore.upsertSubscription(JSON.stringify(body));
  return c.json({ ok: true });
});

router.delete('/subscribe', (c) => {
  notificationStore.deleteSubscription();
  return c.json({ ok: true });
});
```

- [ ] **Step 7: Wire into server.ts**

Replace the contents of `src/backend/src/server.ts` with:

```typescript
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { logging } from './middleware/logging.js';
import { errorHandler } from './middleware/errors.js';
import { runMigrations } from './db/migrations/index.js';
import { dbExport } from './db/index.js';
import { router as categoriesRouter } from './controllers/categories.js';
import { router as itemsRouter } from './controllers/items.js';
import { router as sessionsRouter } from './controllers/sessions.js';
import { router as injuriesRouter } from './controllers/injuries.js';
import { router as leaderboardsRouter } from './controllers/leaderboards.js';
import { router as notificationsRouter } from './controllers/notifications.js';
import { startScheduler } from './notifications/runner.js';

runMigrations();
startScheduler();

const app = new Hono();

app.use('/*', logging());
app.onError(errorHandler());

app.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

if (process.env.NODE_ENV !== 'production' || process.env.E2E_TEST === '1') {
  app.post('/api/__reset', (c) => {
    dbExport.exec(`
      DELETE FROM sessions;
      DELETE FROM injuries;
      DELETE FROM stats;
      DELETE FROM category_stats;
      DELETE FROM items;
      DELETE FROM categories;
      DELETE FROM push_subscriptions;
      DELETE FROM sent_notifications;
    `);
    return c.json({ ok: true });
  });
}

app.route('/api/categories', categoriesRouter);
app.route('/api/items', itemsRouter);
app.route('/api/sessions', sessionsRouter);
app.route('/api/injuries', injuriesRouter);
app.route('/api/leaderboards', leaderboardsRouter);
app.route('/api/notifications', notificationsRouter);

if (process.env.FRONTEND_DIST) {
  app.use('/*', serveStatic({ root: process.env.FRONTEND_DIST }));
  app.get('/*', serveStatic({ path: `${process.env.FRONTEND_DIST}/index.html` }));
}

export { app };
export default app;

const entryFile = process.argv[1] ?? '';
if (entryFile.endsWith('/server.ts') || entryFile.endsWith('/server.js')) {
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Weartrack listening on http://localhost:${port}`);
  });
}
```

- [ ] **Step 8: Run the controller test to verify it passes**

```bash
cd src/backend && npx vitest run tests/notifications/controller.test.ts
```
Expected: PASS — all assertions green

- [ ] **Step 9: Run the full backend test suite**

```bash
cd src/backend && npx vitest run
```
Expected: all tests PASS

- [ ] **Step 10: Commit**

```bash
git add src/backend/src/notifications/sender.ts src/backend/src/notifications/runner.ts \
        src/backend/src/controllers/notifications.ts src/backend/src/server.ts \
        src/backend/tests/notifications/controller.test.ts src/backend/package.json src/backend/package-lock.json
git commit -m "feat(be): add notification sender, runner, API controller"
```

---

## Task 5: Frontend Service Worker

**Files:**
- Modify: `src/frontend/vite.config.ts`
- Create: `src/frontend/src/sw.ts`

**Interfaces:**
- Produces: custom SW handling `push` (shows notification with `title`, `body`, `tag`) and `notificationclick` (focuses or opens the PWA at `/`)

- [ ] **Step 1: Install workbox-precaching**

```bash
npm install --save-dev workbox-precaching --prefix src/frontend
```

Expected: no errors; `workbox-precaching` in `src/frontend/package.json` devDependencies.

- [ ] **Step 2: Write the custom service worker**

```typescript
// src/frontend/src/sw.ts
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  const { title, body, tag } = (event as PushEvent).data!.json() as {
    title: string;
    body: string;
    tag: string;
  };
  event.waitUntil(self.registration.showNotification(title, { body, tag }));
});

self.addEventListener('notificationclick', (event) => {
  (event as NotificationEvent).notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) return (client as WindowClient).focus();
        }
        return self.clients.openWindow('/');
      }),
  );
});
```

- [ ] **Step 3: Update vite.config.ts to use injectManifest**

```typescript
// src/frontend/vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import phCategoriesPlugin from './vite-plugin-ph-categories.js';

export default defineConfig({
  plugins: [
    phCategoriesPlugin(),
    tailwindcss(),
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: {
        name: 'Weartrack',
        short_name: 'Weartrack',
        description: 'Track your wearable usage',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,gif}'],
      },
    }),
  ],
  base: '/',
});
```

- [ ] **Step 4: Verify the frontend build succeeds**

```bash
npm run build --prefix src/frontend
```
Expected: build completes with no errors; `dist/sw.js` exists.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/vite.config.ts src/frontend/src/sw.ts \
        src/frontend/package.json src/frontend/package-lock.json
git commit -m "feat(fe): add custom service worker with push and notificationclick handlers"
```

---

## Task 6: useNotifications Composable + Settings UI

**Files:**
- Create: `src/frontend/src/composables/useNotifications.ts`
- Modify: `src/frontend/src/components/SettingsDrawer.vue`

**Interfaces:**
- Consumes: `GET /api/notifications/vapid-public-key`, `POST /api/notifications/subscribe`, `DELETE /api/notifications/subscribe`
- Produces: `useNotifications()` returning `{ isSupported, isConfigured, permission, isSubscribed, enable, disable }`

- [ ] **Step 1: Write the composable**

```typescript
// src/frontend/src/composables/useNotifications.ts
import { ref, onMounted } from 'vue';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const isSupported = typeof window !== 'undefined'
  && 'Notification' in window
  && 'PushManager' in window;

const isConfigured = ref(false);
const permission = ref<NotificationPermission>('default');
const isSubscribed = ref(false);
let cachedPublicKey: string | null = null;

async function init() {
  if (!isSupported) return;

  permission.value = Notification.permission;

  const res = await fetch('/api/notifications/vapid-public-key');
  if (!res.ok) return;
  const { publicKey } = await res.json() as { publicKey: string | null };
  if (!publicKey) return;

  cachedPublicKey = publicKey;
  isConfigured.value = true;

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  isSubscribed.value = sub !== null;
}

async function enable(): Promise<void> {
  if (!isSupported || !isConfigured.value || !cachedPublicKey) return;

  const perm = await Notification.requestPermission();
  permission.value = perm;
  if (perm !== 'granted') return;

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(cachedPublicKey),
  });

  await fetch('/api/notifications/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  });

  isSubscribed.value = true;
}

async function disable(): Promise<void> {
  if (!isSupported) return;

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();

  await fetch('/api/notifications/subscribe', { method: 'DELETE' });
  isSubscribed.value = false;
}

export function useNotifications() {
  onMounted(() => { void init(); });
  return { isSupported, isConfigured, permission, isSubscribed, enable, disable };
}
```

- [ ] **Step 2: Update SettingsDrawer.vue**

```vue
<!-- src/frontend/src/components/SettingsDrawer.vue -->
<template>
  <k-sheet
    v-if="open"
    :opened="open"
    @backdropclick="$emit('close')"
    class="pb-safe bg-white dark:bg-gray-900"
  >
    <k-toolbar innerClass="!h-6">
      <div class="flex w-full items-center justify-between">
        <span class="font-semibold text-sm">Settings</span>
        <k-button clear @click="$emit('close')">Done</k-button>
      </div>
    </k-toolbar>

    <div class="overflow-y-auto px-4 py-4" style="max-height: 60vh">
      <p class="text-sm text-gray-500 text-center">
        Manage categories and items from the <strong>Items</strong> tab.
      </p>

      <div class="mt-4">
        <p v-if="!isSupported" class="text-sm text-gray-400 text-center">
          Push notifications are not supported in this browser.
        </p>
        <p v-else-if="!isConfigured" class="text-sm text-amber-600 text-center">
          Push notifications are not configured on the server.
        </p>
        <k-list v-else>
          <k-list-item
            title="Push notifications"
            :after="isSubscribed ? 'On' : 'Off'"
          >
            <template #after>
              <k-toggle :checked="isSubscribed" @change="onToggle" />
            </template>
          </k-list-item>
        </k-list>
      </div>
    </div>
  </k-sheet>
</template>

<script setup lang="ts">
import { kSheet, kToolbar, kButton, kList, kListItem, kToggle } from 'konsta/vue';
import { useNotifications } from '../composables/useNotifications.js';

defineProps<{ open: boolean }>();
defineEmits<{ close: [] }>();

const { isSupported, isConfigured, isSubscribed, enable, disable } = useNotifications();

async function onToggle() {
  if (isSubscribed.value) {
    await disable();
  } else {
    await enable();
  }
}
</script>
```

- [ ] **Step 3: Build the frontend and verify no type errors**

```bash
npm run build --prefix src/frontend
```
Expected: build completes with no errors.

- [ ] **Step 4: Run the frontend unit tests**

```bash
cd src/frontend && npx vitest run
```
Expected: all existing tests PASS (the composable has no unit test — it requires a browser environment).

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/composables/useNotifications.ts \
        src/frontend/src/components/SettingsDrawer.vue
git commit -m "feat(fe): add useNotifications composable and settings toggle"
```

---

## VAPID Key Setup (one-time, not a code task)

After all tasks pass, generate VAPID keys and add them to `.env` / your deployment secrets:

```bash
cd src/backend && npx web-push generate-vapid-keys
```

Copy the output into:
```
VAPID_PUBLIC_KEY=<the-public-key>
VAPID_PRIVATE_KEY=<the-private-key>
VAPID_SUBJECT=mailto:<redacted>
```

The server must restart after setting these for the scheduler to start.
