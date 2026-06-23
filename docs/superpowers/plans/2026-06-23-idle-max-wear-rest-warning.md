# Idle Max Wear & Rest Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the selected item's max wear duration and a rest countdown warning in the idle (not currently wearing) state on the Home tab, updated reactively every second.

**Architecture:** Enrich the existing `GET /api/sessions/current` backend endpoint to include all items per category with their last-session data. On the frontend, extract the max-wear formula into a shared utility, add a `useNow` composable for reactive 1-second time, and update `ActionPane.vue` to display Max and rest-warning labels in the idle row.

**Tech Stack:** Hono (backend), better-sqlite3, Vue 3 Composition API, Konsta UI, Iconify (`ph:bed` icon), Vitest (both frontend and backend unit tests)

## Global Constraints

- All timestamps are Unix epoch integers (seconds), not ISO 8601 strings
- `now` from `useNow` is milliseconds (`Date.now()`); convert to seconds with `/ 1000` before comparing to DB timestamps
- API poll interval: 60s. Browser-only re-render interval: 1s.
- Follow existing test patterns: backend tests use `app.request()` against the Hono app, frontend util tests use plain Vitest imports
- Run backend tests from `src/backend/`: `npm test`
- Run frontend tests from `src/frontend/`: `npm test`

---

## File Map

| File | Change |
|---|---|
| `src/frontend/src/utils/wearCalculations.ts` | **Create** — `maxWearSeconds` utility |
| `src/frontend/src/utils/wearCalculations.test.ts` | **Create** — unit tests for above |
| `src/backend/src/db/stores/session-store.ts` | **Modify** — add `ItemWithLastSession` type + `findAllLastSessions()` |
| `src/backend/src/controllers/sessions.ts` | **Modify** — call `findAllLastSessions()`, add `items` field to `/current` response |
| `src/backend/tests/sessions/controller.test.ts` | **Modify** — tests for `items` field in `/current` |
| `src/frontend/src/composables/useNow.ts` | **Create** — reactive `now` ref, 1s interval |
| `src/frontend/src/composables/useWear.ts` | **Modify** — add `ItemWithLastSession` type, `items` field on `CurrentEntry`, bump poll to 60s |
| `src/frontend/src/components/ActionPane.vue` | **Modify** — use shared utility + `useNow`; add idle Max label and rest warning |

---

## Task 1: `maxWearSeconds` frontend utility

**Files:**
- Create: `src/frontend/src/utils/wearCalculations.ts`
- Create: `src/frontend/src/utils/wearCalculations.test.ts`

**Interfaces:**
- Produces: `maxWearSeconds(category: { initial_wear_duration_seconds: number }, item: { difficulty_multiplier: number }): number`

- [ ] **Step 1: Write the failing test**

Create `src/frontend/src/utils/wearCalculations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { maxWearSeconds } from './wearCalculations';

describe('maxWearSeconds', () => {
  it('returns initial duration unchanged for multiplier of 1', () => {
    expect(maxWearSeconds({ initial_wear_duration_seconds: 3600 }, { difficulty_multiplier: 1 })).toBe(3600);
  });

  it('scales down for multiplier less than 1', () => {
    expect(maxWearSeconds({ initial_wear_duration_seconds: 3600 }, { difficulty_multiplier: 0.5 })).toBe(1800);
  });

  it('scales up for multiplier greater than 1', () => {
    expect(maxWearSeconds({ initial_wear_duration_seconds: 3600 }, { difficulty_multiplier: 2 })).toBe(7200);
  });

  it('returns 0 for zero multiplier', () => {
    expect(maxWearSeconds({ initial_wear_duration_seconds: 3600 }, { difficulty_multiplier: 0 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
cd src/frontend && npm test -- wearCalculations
```

Expected: FAIL — `Cannot find module './wearCalculations'`

- [ ] **Step 3: Write the implementation**

Create `src/frontend/src/utils/wearCalculations.ts`:

```ts
export function maxWearSeconds(
  category: { initial_wear_duration_seconds: number },
  item: { difficulty_multiplier: number },
): number {
  return category.initial_wear_duration_seconds * item.difficulty_multiplier;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```
cd src/frontend && npm test -- wearCalculations
```

Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/utils/wearCalculations.ts src/frontend/src/utils/wearCalculations.test.ts
git commit -m "feat: add maxWearSeconds utility"
```

---

## Task 2: Backend — `findAllLastSessions` + enriched `/current` endpoint

**Files:**
- Modify: `src/backend/src/db/stores/session-store.ts`
- Modify: `src/backend/src/controllers/sessions.ts`
- Modify: `src/backend/tests/sessions/controller.test.ts`

**Interfaces:**
- Produces: `sessionStore.findAllLastSessions(): ItemWithLastSession[]`
- Produces: `ItemWithLastSession` exported type (used by frontend in Task 4)
- Produces: every `/current` entry gains `items: ItemWithLastSession[]`

- [ ] **Step 1: Write failing tests**

Add this `describe` block to the end of `src/backend/tests/sessions/controller.test.ts`:

```ts
describe('GET /api/sessions/current — items field', () => {
  it('includes an items array on every entry', async () => {
    const res = await app.request(`${SESSIONS}/current`);
    expect(res.status).toBe(200);
    const body = await res.json();
    body.forEach((entry: { items: unknown }) => {
      expect(Array.isArray(entry.items)).toBe(true);
    });
  });

  it('lists the item with null last-session fields when it has no history', async () => {
    // Create a fresh category + item with no sessions
    const catRes = await app.request(CATEGORIES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Fresh Cat',
        icon: 'ph:sneaker',
        initial_wear_duration_seconds: 900,
        rest_multiplier: 6,
        rest_constant_seconds: 86400,
        risk_levels: [{ lower: null, upper: null, text: 'safe', severity: 1 }],
        break_decay_multiplier: 0.75,
        break_starts_after_seconds: 168,
      }),
    });
    const cat = await catRes.json();

    const itemRes = await app.request(ITEMS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Fresh Shoe', category_id: cat.id, color: '#123456' }),
    });
    const item = await itemRes.json();

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === cat.id);
    expect(entry).toBeDefined();
    expect(entry.items).toHaveLength(1);

    const ourItem = entry.items[0];
    expect(ourItem.item_id).toBe(item.id);
    expect(ourItem.name).toBe('Fresh Shoe');
    expect(ourItem.difficulty_multiplier).toBeTypeOf('number');
    expect(ourItem.ended_at).toBeNull();
    expect(ourItem.calculated_wear_seconds).toBeNull();
    expect(ourItem.calculated_rest_seconds).toBeNull();
  });

  it('populates last-session fields after a session ends', async () => {
    const s = await (await startSession()).json();
    await endSession(s.id);

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === categoryId);
    const ourItem = entry.items.find((i: { item_id: number }) => i.item_id === itemId);

    expect(ourItem).toBeDefined();
    expect(ourItem.ended_at).toBeTypeOf('number');
    expect(ourItem.calculated_wear_seconds).toBeTypeOf('number');
    expect(ourItem.calculated_rest_seconds).toBeTypeOf('number');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd src/backend && npm test -- controller
```

Expected: FAIL — `entry.items` is undefined

- [ ] **Step 3: Add `ItemWithLastSession` type and `findAllLastSessions` to session-store**

In `src/backend/src/db/stores/session-store.ts`, add the interface after the existing `OpenSessionWithItem` interface (around line 22), then add the method to the `SessionStore` class before `findAll`:

```ts
export interface ItemWithLastSession {
  item_id: number;
  category_id: number;
  name: string;
  color: string;
  difficulty_multiplier: number;
  ended_at: number | null;
  calculated_wear_seconds: number | null;
  calculated_rest_seconds: number | null;
}
```

Then add this method inside the `SessionStore` class, before `findAll()`:

```ts
findAllLastSessions(): ItemWithLastSession[] {
  return db
    .prepare(
      `SELECT
         i.id          AS item_id,
         i.category_id,
         i.name,
         i.color,
         i.difficulty_multiplier,
         s.ended_at,
         s.calculated_wear_seconds,
         s.calculated_rest_seconds
       FROM items i
       LEFT JOIN sessions s ON s.id = (
         SELECT id FROM sessions
         WHERE item_id = i.id AND ended_at IS NOT NULL
         ORDER BY ended_at DESC
         LIMIT 1
       )`,
    )
    .all() as ItemWithLastSession[];
}
```

- [ ] **Step 4: Enrich the `/current` route in the controller**

Replace the existing `router.get('/current', ...)` handler in `src/backend/src/controllers/sessions.ts` with:

Also update the import at the top of `src/backend/src/controllers/sessions.ts` to include the new type:

```ts
import { sessionStore, type ItemWithLastSession } from '../db/stores/session-store.js';
```

Then replace the existing `router.get('/current', ...)` handler:

```ts
// GET /api/sessions/current — one entry per category with active session or nulls
router.get('/current', (c) => {
  const categories = categoryStore.findAll();
  const openSessions = sessionStore.findOpenWithItemData();
  const allItems = sessionStore.findAllLastSessions();

  const sessionByCategory = new Map(openSessions.map((s) => [s.category_id, s]));

  const itemsByCategory = new Map<number, ItemWithLastSession[]>();
  for (const item of allItems) {
    if (!itemsByCategory.has(item.category_id)) {
      itemsByCategory.set(item.category_id, []);
    }
    itemsByCategory.get(item.category_id)!.push(item);
  }

  return c.json(
    categories.map((cat) => {
      const s = sessionByCategory.get(cat.id);
      const items = itemsByCategory.get(cat.id) ?? [];
      if (!s) {
        return { category: cat, item: null, session: null, items };
      }
      const item = {
        id: s.item_id,
        category_id: s.category_id,
        name: s.item_name,
        color: s.item_color,
        difficulty_multiplier: s.item_difficulty_multiplier,
      };
      const session = {
        id: s.id,
        item_id: s.item_id,
        started_at: s.started_at,
        ended_at: s.ended_at,
        calculated_wear_seconds: s.calculated_wear_seconds,
        calculated_rest_seconds: s.calculated_rest_seconds,
        ended_in_injury: s.ended_in_injury,
      };
      return { category: cat, item, session, items };
    }),
  );
});
```

- [ ] **Step 5: Run tests to confirm they pass**

```
cd src/backend && npm test -- controller
```

Expected: PASS — all existing + 3 new tests

- [ ] **Step 6: Commit**

```bash
git add src/backend/src/db/stores/session-store.ts \
        src/backend/src/controllers/sessions.ts \
        src/backend/tests/sessions/controller.test.ts
git commit -m "feat: enrich /current endpoint with items and last-session data"
```

---

## Task 3: `useNow` composable

**Files:**
- Create: `src/frontend/src/composables/useNow.ts`

**Interfaces:**
- Produces: `useNow(): Ref<number>` — milliseconds, updated every 1s, cleared on unmount

- [ ] **Step 1: Create the composable**

Create `src/frontend/src/composables/useNow.ts`:

```ts
import { ref, onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';

export function useNow(): Ref<number> {
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  onMounted(() => {
    timer = setInterval(() => {
      now.value = Date.now();
    }, 1000);
  });

  onUnmounted(() => {
    if (timer !== null) clearInterval(timer);
  });

  return now;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/composables/useNow.ts
git commit -m "feat: add useNow composable for reactive 1-second clock"
```

---

## Task 4: Update `useWear.ts` — new types + bump poll interval

**Files:**
- Modify: `src/frontend/src/composables/useWear.ts`

**Interfaces:**
- Consumes: `ItemWithLastSession` shape from Task 2 (same fields, mirrored as a frontend type)
- Produces: `ItemWithLastSession` exported type; `CurrentEntry.items: ItemWithLastSession[]`

- [ ] **Step 1: Add `ItemWithLastSession` interface**

In `src/frontend/src/composables/useWear.ts`, add this interface after the `Session` interface (around line 31):

```ts
export interface ItemWithLastSession {
  item_id: number;
  category_id: number;
  name: string;
  color: string;
  difficulty_multiplier: number;
  ended_at: number | null;
  calculated_wear_seconds: number | null;
  calculated_rest_seconds: number | null;
}
```

- [ ] **Step 2: Add `items` to `CurrentEntry`**

Replace the existing `CurrentEntry` interface:

```ts
export interface CurrentEntry {
  category: Category;
  item: Item | null;
  session: Session | null;
  items: ItemWithLastSession[];
}
```

- [ ] **Step 3: Bump the poll interval from 30s to 60s**

In the `useWear()` function body, change:

```ts
pollTimer = setInterval(fetchCurrent, 30_000);
```

to:

```ts
pollTimer = setInterval(fetchCurrent, 60_000);
```

- [ ] **Step 4: Verify the frontend still builds**

```
cd src/frontend && npm test
```

Expected: PASS — existing frontend tests unaffected (type changes don't break runtime tests)

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/composables/useWear.ts
git commit -m "feat: add ItemWithLastSession type to useWear and bump poll to 60s"
```

---

## Task 5: Update `ActionPane.vue` — shared utility, live clock, idle Max + rest warning

**Files:**
- Modify: `src/frontend/src/components/ActionPane.vue`

**Interfaces:**
- Consumes: `maxWearSeconds` from `../utils/wearCalculations.js` (Task 1)
- Consumes: `useNow` from `../composables/useNow.js` (Task 3)
- Consumes: `ItemWithLastSession` from `../composables/useWear.js` (Task 4)

- [ ] **Step 1: Replace the `<script setup>` block entirely**

Replace the full `<script setup>` block in `src/frontend/src/components/ActionPane.vue` with:

```ts
<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { kBlockTitle, kList, kListItem, kButton } from 'konsta/vue';
import { useWear, type CurrentEntry, type Session, type ItemWithLastSession } from '../composables/useWear.js';
import { useItems } from '../composables/useItems.js';
import { useNow } from '../composables/useNow.js';
import { useToast } from '../composables/useToast.js';
import { formatDuration } from '../utils/formatDuration.js';
import { maxWearSeconds } from '../utils/wearCalculations.js';

const { currentSessions, loaded, startSession, endSession } = useWear();
const { loadItems, itemsForCategory } = useItems();
const { showError } = useToast();
const now = useNow();

const selectedItem = reactive<Record<number, number | null>>({});

onMounted(async () => {
  await loadItems();
  for (const entry of currentSessions.value) {
    const first = itemsForCategory(entry.category.id)[0];
    selectedItem[entry.category.id] = first?.id ?? null;
  }
});

function subtitle(entry: CurrentEntry): string {
  if (entry.session !== null && entry.item !== null) {
    return entry.item.name;
  }
  return 'Idle';
}

function sessionSeconds(session: Session): number {
  return Math.floor(now.value / 1000) - session.started_at;
}

function elapsed(session: Session): string {
  return formatDuration(sessionSeconds(session));
}

function maxWear(entry: CurrentEntry): string {
  if (!entry.item) return '';
  return formatDuration(maxWearSeconds(entry.category, entry.item));
}

function wearProgress(entry: CurrentEntry): number {
  if (!entry.session || !entry.item) return 0;
  const max = maxWearSeconds(entry.category, entry.item);
  if (max <= 0) return 0;
  return Math.min((sessionSeconds(entry.session) / max) * 100, 100);
}

function rowBg(entry: CurrentEntry): string {
  if (!entry.session || !entry.item) return '';
  const max = maxWearSeconds(entry.category, entry.item);
  if (max <= 0) return '';
  const remaining = 1 - sessionSeconds(entry.session) / max;
  if (remaining <= 0) return 'bg-red-100';
  if (remaining <= 0.05) return 'bg-orange-100';
  if (remaining <= 0.10) return 'bg-yellow-100';
  return '';
}

function selectedItemData(entry: CurrentEntry): ItemWithLastSession | null {
  const id = selectedItem[entry.category.id];
  if (!id) return null;
  return entry.items.find(i => i.item_id === id) ?? null;
}

function idleMaxWear(entry: CurrentEntry): string {
  const item = selectedItemData(entry);
  if (!item) return '';
  return formatDuration(maxWearSeconds(entry.category, item));
}

function restRemainingMinutes(entry: CurrentEntry): number {
  const item = selectedItemData(entry);
  if (!item || item.ended_at === null || item.calculated_rest_seconds === null) return 0;
  const remainingSeconds = item.ended_at + item.calculated_rest_seconds - now.value / 1000;
  return Math.max(0, Math.ceil(remainingSeconds / 60));
}

async function onWear(entry: CurrentEntry) {
  const itemId = selectedItem[entry.category.id];
  if (!itemId) return;
  try {
    await startSession(itemId);
  } catch (e) {
    showError(String(e));
  }
}

async function onStop(entry: CurrentEntry) {
  if (!entry.session) return;
  try {
    await endSession(entry.session.id);
  } catch (e) {
    showError(String(e));
  }
}
</script>
```

- [ ] **Step 2: Update the idle `<template v-else>` section in the template**

Replace this section inside `<template #after>` → `<div class="flex gap-2 items-center">`:

```html
            <!-- No session: show item picker + Wear buttons -->
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
                >{{ item.name }}</option>
              </select>
              <span v-else class="text-sm text-gray-400 italic">No items</span>
              <k-button
                small
                :disabled="!selectedItem[entry.category.id]"
                @click="onWear(entry)"
              >Wear</k-button>
            </template>
```

with:

```html
            <!-- No session: show max/rest info + item picker + Wear button -->
            <template v-else>
              <div v-if="selectedItemData(entry)" class="text-right tabular-nums leading-snug whitespace-nowrap">
                <div class="text-sm text-gray-600">
                  <span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ idleMaxWear(entry) }}
                </div>
                <div v-if="restRemainingMinutes(entry) > 0" class="text-sm text-amber-600 mt-0.5">
                  <Icon icon="ph:bed" class="inline w-3.5 h-3.5 mr-0.5" />Rest {{ restRemainingMinutes(entry) }}m more
                </div>
              </div>
              <select
                v-if="itemsForCategory(entry.category.id).length > 0"
                v-model="selectedItem[entry.category.id]"
                class="text-sm border rounded px-1 py-0.5"
              >
                <option
                  v-for="item in itemsForCategory(entry.category.id)"
                  :key="item.id"
                  :value="item.id"
                >{{ item.name }}</option>
              </select>
              <span v-else class="text-sm text-gray-400 italic">No items</span>
              <k-button
                small
                :disabled="!selectedItem[entry.category.id]"
                @click="onWear(entry)"
              >Wear</k-button>
            </template>
```

- [ ] **Step 3: Run frontend tests**

```
cd src/frontend && npm test
```

Expected: PASS — all existing tests pass (no component unit tests; TypeScript compilation catches type errors)

- [ ] **Step 4: Run backend tests to confirm nothing regressed**

```
cd src/backend && npm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/ActionPane.vue
git commit -m "feat: show idle max wear and rest warning on Home tab"
```
