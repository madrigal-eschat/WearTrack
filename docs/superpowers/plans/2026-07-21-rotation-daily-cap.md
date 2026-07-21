# Rotation Categories — One Session Per Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce at most one session per calendar day per rotation category (any item), with the idle picker replaced by a "resting until midnight" display identical in style to the existing duration-category rest UI.

**Architecture:** Two small pure date-boundary helpers in `calculations.ts`, one new `session-store.ts` query, a hard-reject check added to `POST /api/sessions/start`, a new `resting_until` field on `GET /api/sessions/current`, and frontend wiring in `ActionPane.vue` that generalizes the existing duration-rest display to also cover the rotation daily cap while completely hiding the item picker.

**Tech Stack:** Hono (backend routes), better-sqlite3, Vue 3 + Konsta UI (frontend), Vitest.

## Global Constraints

- Hard block, no override — unlike duration categories' overridable rest-period warning, there is no way to bypass the daily cap before midnight.
- Backend-enforced (`POST /start` rejects with 400), not merely a frontend nicety.
- Scope is per-category, not per-item: any session today blocks any item today.
- "Today" = the calendar day the session **started**, evaluated in the server process's local timezone (no per-user timezone storage).
- No schema change. Purely additive backend logic + one new optional response field (`resting_until: number | null`).
- Zero behavior change for `duration` categories.

---

### Task 1: Local-midnight date helpers

**Files:**
- Modify: `src/backend/src/db/calculations.ts`
- Test: `src/backend/tests/db/calculations.test.ts`

**Interfaces:**
- Produces: `startOfTodayLocal(now: number): number` and `startOfNextLocalMidnight(now: number): number` (both Unix timestamps, seconds). Task 3 and Task 4 call both by these exact names.

- [ ] **Step 1: Write the failing tests**

Append to `src/backend/tests/db/calculations.test.ts`:

```ts
import { startOfTodayLocal, startOfNextLocalMidnight } from '../../src/db/calculations.js';

describe('startOfTodayLocal / startOfNextLocalMidnight', () => {
  it('startOfTodayLocal returns a timestamp at local midnight on the same day as `now`', () => {
    const now = Math.floor(new Date(2026, 6, 21, 14, 30, 0).getTime() / 1000); // 2026-07-21 14:30 local
    const today = startOfTodayLocal(now);
    const d = new Date(today * 1000);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July (0-indexed)
    expect(d.getDate()).toBe(21);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it('startOfNextLocalMidnight returns midnight the following day', () => {
    const now = Math.floor(new Date(2026, 6, 21, 14, 30, 0).getTime() / 1000);
    const next = startOfNextLocalMidnight(now);
    const d = new Date(next * 1000);
    expect(d.getDate()).toBe(22);
    expect(d.getHours()).toBe(0);
  });

  it('startOfTodayLocal is idempotent when `now` is already exactly midnight', () => {
    const midnight = Math.floor(new Date(2026, 6, 21, 0, 0, 0).getTime() / 1000);
    expect(startOfTodayLocal(midnight)).toBe(midnight);
  });

  it('startOfNextLocalMidnight is exactly 24h * N seconds after startOfTodayLocal for a non-DST day', () => {
    const now = Math.floor(new Date(2026, 6, 21, 14, 30, 0).getTime() / 1000);
    expect(startOfNextLocalMidnight(now) - startOfTodayLocal(now)).toBeGreaterThanOrEqual(23 * 3600);
    expect(startOfNextLocalMidnight(now) - startOfTodayLocal(now)).toBeLessThanOrEqual(25 * 3600);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix src/backend exec vitest run tests/db/calculations.test.ts -t "startOfTodayLocal"`
Expected: FAIL — `startOfTodayLocal`/`startOfNextLocalMidnight` not exported.

- [ ] **Step 3: Implement the helpers**

Add to `src/backend/src/db/calculations.ts`, near the other exported pure functions (e.g. after `isConsecutiveLockEligible`):

```ts
function localMidnight(now: number, dayOffset: number): number {
  const d = new Date(now * 1000);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  return Math.floor(d.getTime() / 1000);
}

/** Unix timestamp of local midnight on the same calendar day as `now`. */
export function startOfTodayLocal(now: number): number {
  return localMidnight(now, 0);
}

/** Unix timestamp of the next local midnight strictly after `now`'s calendar day starts. */
export function startOfNextLocalMidnight(now: number): number {
  return localMidnight(now, 1);
}
```

(Using `Date`'s `setHours`/`setDate` rather than fixed `86400` arithmetic keeps this correct across DST transitions — `setDate` and `setHours` operate in local time and JS handles the DST adjustment internally.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix src/backend exec vitest run tests/db/calculations.test.ts -t "startOfTodayLocal"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/db/calculations.ts src/backend/tests/db/calculations.test.ts
git commit -m "feat(db): add local-midnight date boundary helpers"
```

---

### Task 2: `sessionStore.findSessionStartedTodayInCategory`

**Files:**
- Modify: `src/backend/src/db/stores/session-store.ts`
- Test: `src/backend/tests/db/session-store.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `sessionStore.findSessionStartedTodayInCategory(categoryId: number, dayStart: number): { started_at: number } | undefined`. Tasks 3 and 4 call this exact signature.

- [ ] **Step 1: Write the failing test**

Append to `src/backend/tests/db/session-store.test.ts`:

```ts
describe('sessionStore.findSessionStartedTodayInCategory', () => {
  it('finds a session that started on/after dayStart in the category (any item)', () => {
    const cat = categoryStore.create({
      name: 'DailyCapFind', icon: 'x',
      initial_target_wear_duration_seconds: 100,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 1, minimum_rest: 0,
      risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
      break_decay_multiplier: 0.91, break_grace_time: 86400,
      type: 'rotation', consecutive_wear_days: 1,
    });
    db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (?,'dcf','#fff',1)`).run(cat.id);
    const rawCat = db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id) as never;
    const itemId = (db.prepare('SELECT id FROM items WHERE category_id = ? AND name = ?').get(cat.id, 'dcf') as { id: number }).id;

    const dayStart = 2_000_000;
    const s = sessionStore.start(itemId, rawCat, item, dayStart + 3600); // started 1h into the day
    sessionStore.end(s, rawCat, dayStart + 3700);

    const found = sessionStore.findSessionStartedTodayInCategory(cat.id, dayStart);
    expect(found).toBeDefined();
    expect(found!.started_at).toBe(dayStart + 3600);
  });

  it('returns undefined when the only session started before dayStart', () => {
    const cat = categoryStore.create({
      name: 'DailyCapFind2', icon: 'x',
      initial_target_wear_duration_seconds: 100,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 1, minimum_rest: 0,
      risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
      break_decay_multiplier: 0.91, break_grace_time: 86400,
      type: 'rotation', consecutive_wear_days: 1,
    });
    db.prepare(`INSERT INTO items (category_id, name, color, difficulty_multiplier) VALUES (?,'dcf2','#fff',1)`).run(cat.id);
    const rawCat = db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id) as never;
    const itemId = (db.prepare('SELECT id FROM items WHERE category_id = ? AND name = ?').get(cat.id, 'dcf2') as { id: number }).id;

    const dayStart = 5_000_000;
    const s = sessionStore.start(itemId, rawCat, item, dayStart - 3600); // started before dayStart (yesterday)
    sessionStore.end(s, rawCat, dayStart - 3500);

    expect(sessionStore.findSessionStartedTodayInCategory(cat.id, dayStart)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend exec vitest run tests/db/session-store.test.ts -t findSessionStartedTodayInCategory`
Expected: FAIL — method doesn't exist.

- [ ] **Step 3: Implement it**

Add to `src/backend/src/db/stores/session-store.ts`, near `findRecentInCategory`:

```ts
  /** Most recent session (any item, open or closed) in the category that started on/after `dayStart`. Feeds the rotation daily-cap check. */
  findSessionStartedTodayInCategory(categoryId: number, dayStart: number): { started_at: number } | undefined {
    return db
      .prepare(
        `SELECT s.started_at FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.started_at >= ?
         ORDER BY s.started_at DESC LIMIT 1`,
      )
      .get(categoryId, dayStart) as { started_at: number } | undefined;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend exec vitest run tests/db/session-store.test.ts -t findSessionStartedTodayInCategory`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/db/stores/session-store.ts src/backend/tests/db/session-store.test.ts
git commit -m "feat(db): add findSessionStartedTodayInCategory for the rotation daily cap"
```

---

### Task 3: `POST /api/sessions/start` — reject a second same-day session

**Files:**
- Modify: `src/backend/src/controllers/sessions.ts`
- Test: `src/backend/tests/sessions/controller.test.ts`

**Interfaces:**
- Consumes: `startOfTodayLocal` (Task 1), `sessionStore.findSessionStartedTodayInCategory` (Task 2).
- Produces: `POST /api/sessions/start` returns 400 when a rotation category already has a session (any item) that started today (server-local calendar day). No change for `duration` categories.

- [ ] **Step 1: Write the failing test**

Append to `src/backend/tests/sessions/controller.test.ts`:

```ts
describe('POST /api/sessions/start — rotation daily cap', () => {
  it('rejects a second session the same day for a different item', async () => {
    const cat = await (await createCategory({
      name: 'Daily Cap Sessions', type: 'rotation', consecutive_wear_days: 1,
      initial_target_wear_duration_seconds: 57600, initial_max_wear_duration_seconds: null,
    })).json();
    const itemA = await (await createItem(cat.id, { name: 'DCA' })).json();
    const itemB = await (await createItem(cat.id, { name: 'DCB' })).json();

    const start1 = await app.request(`${SESSIONS}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemA.id }),
    });
    const session1 = await start1.json();
    await app.request(`${SESSIONS}/${session1.id}/end`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });

    const start2 = await app.request(`${SESSIONS}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemB.id }),
    });
    expect(start2.status).toBe(400);
  });

  it('allows a session the next day', async () => {
    const cat = await (await createCategory({
      name: 'Daily Cap Sessions 2', type: 'rotation', consecutive_wear_days: 1,
      initial_target_wear_duration_seconds: 57600, initial_max_wear_duration_seconds: null,
    })).json();
    const itemA = await (await createItem(cat.id, { name: 'DCA2' })).json();
    const itemB = await (await createItem(cat.id, { name: 'DCB2' })).json();

    const yesterday = Math.floor(Date.now() / 1000) - 90000; // well over a day ago
    const start1 = await app.request(`${SESSIONS}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemA.id, started_at: yesterday }),
    });
    const session1 = await start1.json();
    await app.request(`${SESSIONS}/${session1.id}/end`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ended_at: yesterday + 100 }),
    });

    const start2 = await app.request(`${SESSIONS}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemB.id }),
    });
    expect(start2.status).toBe(201);
  });

  it('does not affect duration categories', async () => {
    const s1 = await startSession();
    const body1 = await s1.json();
    await endSession(body1.id);
    const s2 = await startSession();
    expect(s2.status).toBe(201);
    const body2 = await s2.json();
    await endSession(body2.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend exec vitest run tests/sessions/controller.test.ts -t "rotation daily cap"`
Expected: FAIL — first test gets 201 instead of 400.

- [ ] **Step 3: Implement it**

In `src/backend/src/controllers/sessions.ts`, add `startOfTodayLocal` to the existing `calculations.js` import:

```ts
import {
  computeSessionStart,
  computeDecay,
  rotationAvailability,
  isConsecutiveLockEligible,
  startOfTodayLocal,
  startOfNextLocalMidnight,
  type PreviousSession,
  type Category,
} from '../db/calculations.js';
```

In the `POST /start` handler, insert a daily-cap check right after resolving `category`, before the rotation-availability block:

```ts
  const category = categoryStore.findRaw(item.category_id)!;

  if (category.type === 'rotation') {
    const dayStart = startOfTodayLocal(nowSeconds());
    if (sessionStore.findSessionStartedTodayInCategory(item.category_id, dayStart)) {
      throw new ValidationError('Category has already had a session today');
    }

    const activeItemIds = itemStore.findAll(item.category_id).map((i) => i.id);
    const recent = sessionStore.findRecentInCategory(item.category_id, 100);
    const available = rotationAvailability(activeItemIds, recent);
    const consecutiveLockEligible = isConsecutiveLockEligible(recent, item_id, category.consecutive_wear_days);
    if (!available.has(item_id) && !consecutiveLockEligible) {
      throw new ValidationError(`Item ${item_id} is not available yet — it's another item's turn in the rotation`);
    }
  }
```

(`startOfNextLocalMidnight` is imported now too, for Task 4's use in this same file — importing it here rather than duplicating the import statement across tasks.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend exec vitest run tests/sessions/controller.test.ts`
Expected: PASS (full file)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/controllers/sessions.ts src/backend/tests/sessions/controller.test.ts
git commit -m "feat(api): reject a second same-day session for rotation categories"
```

---

### Task 4: `GET /api/sessions/current` — `resting_until` field

**Files:**
- Modify: `src/backend/src/controllers/sessions.ts`
- Test: `src/backend/tests/sessions/controller.test.ts`

**Interfaces:**
- Consumes: `startOfTodayLocal`, `startOfNextLocalMidnight` (Task 1, already imported in Task 3), `sessionStore.findSessionStartedTodayInCategory` (Task 2).
- Produces: each category entry in `GET /api/sessions/current`'s response gains `resting_until: number | null`. `null` for `duration` categories always, and for `rotation` categories with no session started today. Set to `startOfNextLocalMidnight(now)` for `rotation` categories with a session started today. Task 5 (frontend) reads this exact field name on `CurrentEntry`.

- [ ] **Step 1: Write the failing test**

Append to `src/backend/tests/sessions/controller.test.ts`:

```ts
describe('GET /api/sessions/current — resting_until', () => {
  it('sets resting_until to the next local midnight after a same-day session', async () => {
    const cat = await (await createCategory({
      name: 'Resting Until Cat', type: 'rotation', consecutive_wear_days: 1,
      initial_target_wear_duration_seconds: 57600, initial_max_wear_duration_seconds: null,
    })).json();
    const itemA = await (await createItem(cat.id, { name: 'RUA' })).json();

    const start1 = await app.request(`${SESSIONS}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemA.id }),
    });
    const session1 = await start1.json();
    await app.request(`${SESSIONS}/${session1.id}/end`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === cat.id);
    expect(entry.resting_until).not.toBeNull();
    expect(entry.resting_until).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('resting_until is null for a rotation category with no session today', async () => {
    const cat = await (await createCategory({
      name: 'Resting Until Cat 2', type: 'rotation', consecutive_wear_days: 1,
      initial_target_wear_duration_seconds: 57600, initial_max_wear_duration_seconds: null,
    })).json();
    await createItem(cat.id, { name: 'RUB' });

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === cat.id);
    expect(entry.resting_until).toBeNull();
  });

  it('resting_until is always null for duration categories', async () => {
    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === categoryId);
    expect(entry.resting_until).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend exec vitest run tests/sessions/controller.test.ts -t resting_until`
Expected: FAIL — `entry.resting_until` is `undefined`.

- [ ] **Step 3: Implement it**

In `src/backend/src/controllers/sessions.ts`, inside the `GET /current` handler's `categories.map((cat) => { ... })` callback, add the computation right after the `rotationAvailableIds` block and before `const items = enrichItemsWithExpected(...)`:

```ts
      const restingUntil =
        cat.type === 'rotation' && sessionStore.findSessionStartedTodayInCategory(cat.id, startOfTodayLocal(now))
          ? startOfNextLocalMidnight(now)
          : null;
```

Then add `resting_until: restingUntil` to both `return` statements in that callback (the no-open-session branch and the open-session branch):

```ts
      const s = sessionByCategory.get(cat.id);
      if (!s) return { category: cat, item: null, session: null, items, decay_start_time, decay_state, decay_full_time, streak_count, resting_until: restingUntil };

      const item = {
        id: s.item_id, category_id: s.category_id, name: s.item_name,
        color: s.item_color, difficulty_multiplier: s.item_difficulty_multiplier,
      };
      const session = {
        id: s.id, item_id: s.item_id, started_at: s.started_at, ended_at: s.ended_at,
        target_wear_seconds: s.target_wear_seconds, max_wear_seconds: s.max_wear_seconds,
        rest_seconds: s.rest_seconds, ended_in_injury: s.ended_in_injury,
      };
      return { category: cat, item, session, items, decay_start_time, decay_state, decay_full_time, streak_count, resting_until: restingUntil };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend exec vitest run tests/sessions/controller.test.ts`
Expected: PASS (full file)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/controllers/sessions.ts src/backend/tests/sessions/controller.test.ts
git commit -m "feat(api): expose resting_until on GET /api/sessions/current for rotation categories"
```

---

### Task 5: Frontend — daily-rest display in `ActionPane.vue`

**Files:**
- Modify: `src/frontend/src/composables/useWear.ts`
- Modify: `src/frontend/src/components/ActionPane.vue`

**Interfaces:**
- Consumes: `resting_until: number | null` on the `GET /api/sessions/current` response (Task 4).
- Produces: `CurrentEntry.resting_until: number | null`. Rotation categories with an active daily cap show the same "Rest" visual block duration categories use, and the entire item picker (locked-label, dropdown, Wear button) disappears — no override.

- [ ] **Step 1: Add the type field**

In `src/frontend/src/composables/useWear.ts`, add to `CurrentEntry`:

```ts
export interface CurrentEntry {
  category: Category;
  item: Item | null;
  session: Session | null;
  items: ItemWithLastSession[];
  decay_start_time: number | null;
  decay_state: 'none' | 'decaying' | 'fully_decayed';
  decay_full_time: number | null;
  streak_count: number;
  resting_until: number | null;
}
```

- [ ] **Step 2: Add the daily-rest computed helpers**

In `src/frontend/src/components/ActionPane.vue`'s `<script setup>`, add near `restTotalSeconds`/`restFillFraction`:

```ts
function dailyRestRemainingSeconds(entry: CurrentEntry): number {
  if (entry.resting_until === null) return 0;
  return Math.max(0, entry.resting_until - Math.floor(now.value / 1000));
}

function dailyRestTotalSeconds(entry: CurrentEntry): number {
  if (entry.resting_until === null) return 0;
  const sessionStart = entry.items[0]?.started_at;
  if (sessionStart === null || sessionStart === undefined) return 0;
  return Math.max(0, entry.resting_until - sessionStart);
}

/** Rest-remaining for whichever rest mechanic applies to this category: the duration formula's rest period, or the rotation daily cap. */
function effectiveRestRemainingSeconds(entry: CurrentEntry): number {
  return entry.category.type === 'rotation' ? dailyRestRemainingSeconds(entry) : restRemainingSeconds(entry);
}

/** Rest-total counterpart to `effectiveRestRemainingSeconds`. */
function effectiveRestTotalSeconds(entry: CurrentEntry): number {
  return entry.category.type === 'rotation' ? dailyRestTotalSeconds(entry) : restTotalSeconds(entry);
}

function effectiveRestFillFraction(entry: CurrentEntry): number {
  return fillUpFraction(effectiveRestRemainingSeconds(entry), effectiveRestTotalSeconds(entry));
}
```

(`entry.items[0]` is safe here: `items` is the category-wide last-session-per-item list, and every row shares the same category-level `started_at`/`ended_at` for the most recent session in the category — see `findAllLastSessions`'s subquery, which is keyed by category, not item. `dailyRestRemainingSeconds`/`dailyRestTotalSeconds` are always `0` for duration categories since `resting_until` is always `null` for them, per Task 4 — the `effective*` wrapper functions are the only ones the template needs to call.)

- [ ] **Step 3: Wire the template's Row2/Row3 rest display to the effective helpers**

In `ActionPane.vue`'s template, in the `#inner` slot's idle (`v-else`) branch, replace the three existing duration-specific rest references with their `effective*` counterparts:

```html
          <template v-else>
            <!-- Row2: resting > decaying > default -->
            <template v-if="effectiveRestRemainingSeconds(entry) > 0">
              <div class="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Icon icon="ph:bed" class="w-3.5 h-3.5" />Rest
              </div>
              <WearProgressBar mode="rest" :fill-fraction="effectiveRestFillFraction(entry)" />
            </template>
            <template v-else-if="entry.decay_state !== 'none'">
              <div class="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Icon icon="ph:warning-circle" class="w-3.5 h-3.5" />Decay
              </div>
              <WearProgressBar mode="decay" :fill-fraction="decayFillFractionFor(entry)" />
              <div class="text-sm font-bold text-black mt-0.5">
                {{ entry.decay_state === 'fully_decayed' ? 'Target and max have fully decayed' : `Total decay in ${decayTimeLeftLabel(entry)}` }}
              </div>
            </template>
            <template v-else>
              <div class="text-xs text-gray-500 min-h-[22px] flex items-center">
                <span v-if="entry.decay_start_time !== null"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Start before</span>{{ formatDecayDate(entry.decay_start_time) }}</span>
                <span v-else>Start your first session</span>
              </div>
            </template>

            <!-- Row3: rest stats replace Target/Max while resting -->
            <div v-if="effectiveRestRemainingSeconds(entry) > 0" class="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm tabular-nums">
              <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Remaining</span>{{ shortDuration(effectiveRestRemainingSeconds(entry)) }}</span>
              <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Total</span>{{ shortDuration(effectiveRestTotalSeconds(entry)) }}</span>
            </div>
            <div v-else-if="selectedItemData(entry)" class="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm tabular-nums">
              <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ idleTarget(entry) }}</span>
              <span v-if="idleMax(entry)" class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ idleMax(entry) }}</span>
            </div>
          </template>
```

(Only the three `restRemainingSeconds(entry)`/`restFillFraction(entry)`/`restRemainingSeconds`/`restTotalSeconds` calls in Row2/Row3's top-level guards and labels change to their `effective*` equivalents; nothing else in this block changes. Since `dailyRestRemainingSeconds` is always `0` for duration categories, this is a no-op for them — behavior is unchanged.)

- [ ] **Step 4: Hide the item picker entirely while resting from the daily cap**

In the `#after` slot's no-session (`v-else`) branch, wrap the existing picker `<div>` in a `v-if` guard:

```html
            <!-- No session: show item picker + Wear button (unless resting from the rotation daily cap) -->
            <template v-else>
              <div v-if="entry.category.type !== 'rotation' || effectiveRestRemainingSeconds(entry) === 0" class="flex gap-2 items-center">
                <template v-if="isLocked(entry)">
                  <span class="text-sm font-medium" data-testid="forced-item-label">{{ forcedItemName(entry) }}</span>
                  <k-button small inline outline data-testid="wear-something-else" @click="chooseSomethingElse(entry)">Choose Something Else</k-button>
                  <k-button
                    small
                    inline
                    @click="restRemainingSeconds(entry, forcedItemId(entry)) > 0 ? showRestWarning(entry) : onWear(entry, forcedItemId(entry) ?? undefined)"
                  >Wear</k-button>
                </template>
                <template v-else>
                  <select
                    v-if="itemsForCategory(entry.category.id).length > 0"
                    v-model="selectedItem[entry.category.id]"
                    class="text-sm border rounded px-1 py-0.5"
                  >
                    <option
                      v-for="item in itemsForCategory(entry.category.id)"
                      :key="item.id"
                      :value="item.id"
                      :disabled="entry.category.type === 'rotation' && !itemRotationAvailable(entry, item.id)"
                    >{{ item.name }}</option>
                  </select>
                  <span v-else class="text-sm text-gray-400 italic">No items</span>
                  <k-button
                    small
                    :disabled="!selectedItem[entry.category.id]"
                    :class="{ 'opacity-60': restRemainingSeconds(entry) > 0 }"
                    @click="restRemainingSeconds(entry) > 0 ? showRestWarning(entry) : onWear(entry)"
                  >Wear</k-button>
                </template>
              </div>
            </template>
```

(The guard is deliberately `entry.category.type !== 'rotation' || ...` rather than just `effectiveRestRemainingSeconds(entry) === 0`. Duration categories must keep showing their picker during their own overridable rest period — that's the whole point of the rest-warning dialog — so the picker only ever gets hidden by this new `v-if` when the category is actually a rotation category resting from the daily cap. For duration categories the left side of the `||` is always `true`, so the div always renders and duration's existing `restRemainingSeconds(entry) > 0` guard on the Wear button's `:disabled`/`opacity-60` classes and click handler continues to work exactly as before, untouched by this task.)

- [ ] **Step 5: Verify the frontend builds and the existing suite stays green**

Run: `npm --prefix src/frontend run build`
Expected: PASS — clean type-check and build.

Run: `npm --prefix src/frontend run test:ci`
Expected: PASS (full suite, no regressions).

- [ ] **Step 6: Hand-trace and manually verify**

Hand-trace these scenarios and record the reasoning:
- Rotation category, no session ever: `resting_until` is `null` → `effectiveRestRemainingSeconds` is `0` → picker shows normally.
- Rotation category, session ended today: `resting_until` is set → Row2 shows "Rest" bar counting down to midnight, Row3 shows Remaining/Total, `#after` shows nothing (no picker, no button).
- Rotation category, session ended yesterday: `resting_until` is `null` (Task 4's backend logic) → normal picker/lock display resumes.
- Duration category, currently in its own overridable rest period: `entry.category.type !== 'rotation'` is `true`, so the picker (dropdown + Wear button, with the rest-warning override dialog) shows exactly as before this task — confirm this holds.
- Duration category, not resting: unaffected, confirm no change.

If you have dev-server + browser access in this environment, additionally start the dev server and manually create a rotation category, start and end a session, and confirm the Rest bar appears with a countdown to midnight and no picker is shown. If you don't have browser access, say so explicitly in your report and rely on the hand-trace above.

- [ ] **Step 7: Commit**

```bash
git add src/frontend/src/composables/useWear.ts src/frontend/src/components/ActionPane.vue
git commit -m "feat(frontend): show rest-until-midnight for rotation categories with a same-day session"
```

---

## Self-review notes

- **Spec coverage:** midnight helpers (Task 1), day-boundary query (Task 2), backend hard-block enforcement (Task 3), `resting_until` exposure (Task 4), frontend rest display + picker hiding (Task 5) — every section of the spec has a task.
- **No placeholders:** every step has literal code.
- **Type consistency:** `resting_until: number | null` is identical across Task 4 (backend response) and Task 5 (`CurrentEntry` type, template usage). `startOfTodayLocal`/`startOfNextLocalMidnight` signatures match between Task 1's definition and Tasks 3/4's usage.
- **Bug caught during plan self-review:** an earlier draft of Task 5 Step 4 gated the item picker on `effectiveRestRemainingSeconds(entry) === 0` alone, which would have also hidden duration categories' picker during their own overridable rest period. Fixed to `entry.category.type !== 'rotation' || effectiveRestRemainingSeconds(entry) === 0` before finalizing this plan.
