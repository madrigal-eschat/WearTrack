# Decay Warnings & Rest-Period Wear Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `decay_start_time`/`decay_state` to the `/current` API, then surface "Start before" dates, decay warning badges, a greyed Wear button during rest, and a rest-penalty confirmation dialog on the home tab.

**Architecture:** Backend computes `decay_start_time` and `decay_state` from the already-fetched `previous` session in `sessions.ts`; no new DB queries. Frontend consumes the new fields as part of `CurrentEntry` and renders everything inside the existing idle branch of `ActionPane.vue`.

**Tech Stack:** Hono + better-sqlite3 (backend), Vue 3 + Konsta UI (frontend), Vitest (unit tests), TypeScript throughout.

## Global Constraints

- `decay_start_time`: unix timestamp (seconds), `null` when no prior non-injury session exists.
- `decay_state`: `'none' | 'decaying' | 'fully_decayed'` — backend-computed, frontend only renders.
- "Start before" date format: `{ day: 'numeric', month: 'short' }` via `toLocaleDateString`, no year.
- Wear button: `opacity-60` when resting, never the `:disabled` attribute for rest state.
- Decay warning colours: orange for `'decaying'`, red for `'fully_decayed'`.
- All changes to active-session rows are out of scope.

---

### Task 1: Backend — compute and expose `decay_start_time` and `decay_state`

**Files:**
- Modify: `src/backend/src/controllers/sessions.ts`
- Test: `src/backend/tests/sessions/controller.test.ts`

**Interfaces:**
- Produces: each entry from `GET /api/sessions/current` gains:
  ```ts
  decay_start_time: number | null
  decay_state: 'none' | 'decaying' | 'fully_decayed'
  ```

- [ ] **Step 1: Write failing tests**

Add a new `describe` block at the bottom of `src/backend/tests/sessions/controller.test.ts`:

```ts
describe('GET /api/sessions/current — decay fields', () => {
  it('returns decay_start_time null and decay_state none when no prior session', async () => {
    // Use the existing categoryId (fresh DB in beforeAll, all sessions ended cleanly)
    // At test-suite start there are no sessions yet for this category
    const catRes = await app.request(CATEGORIES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'DecayCat',
        icon: 'ph:sneaker',
        initial_target_wear_duration_seconds: 900,
        initial_max_wear_duration_seconds: 1800,
        rest_multiplier: 6,
        minimum_rest: 86400,
        risk_levels: [{ lower: null, upper: null, text: 'safe', severity: 1 }],
        break_decay_multiplier: 0.91,
        break_grace_time: 86400,
      }),
    });
    const cat = await catRes.json();
    const itemRes = await app.request(ITEMS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Decay Shoe', category_id: cat.id, color: '#aabbcc' }),
    });
    const item = await itemRes.json();

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === cat.id);

    expect(entry.decay_start_time).toBeNull();
    expect(entry.decay_state).toBe('none');

    // Store for later tests
    decayCategoryId = cat.id;
    decayItemId = item.id;
  });

  it('returns decay_start_time and state none when within grace period', async () => {
    // End a session 1 second ago — still in rest period (minimum_rest = 86400)
    const now = Math.floor(Date.now() / 1000);
    const startTs = now - 3600;
    const endTs = now - 1;
    const s = await (await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: decayItemId, started_at: startTs }),
    })).json();
    await app.request(`${SESSIONS}/${s.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: endTs }),
    });

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === decayCategoryId);

    // decay_start_time = endTs + rest_seconds + break_grace_time — well in the future
    expect(entry.decay_start_time).toBeGreaterThan(now);
    expect(entry.decay_state).toBe('none');
  });

  it('returns decay_state decaying when past grace period', async () => {
    // End a session 30 days ago so decay_start_time is in the past
    const now = Math.floor(Date.now() / 1000);
    const endTs = now - 30 * 86400;
    const s = await (await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: decayItemId, started_at: endTs - 3600 }),
    })).json();
    // End with ended_at so rest_seconds is minimal (elapsed is small → rest ≈ minimum)
    await app.request(`${SESSIONS}/${s.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: endTs }),
    });

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === decayCategoryId);

    expect(entry.decay_state).toBe('decaying');
    expect(entry.decay_start_time).toBeLessThan(now);
  });

  it('returns decay_state fully_decayed when target has decayed to initial', async () => {
    // End a session 10 000 days ago — 0.91^10000 rounds to 0, definitely fully decayed
    const now = Math.floor(Date.now() / 1000);
    const endTs = now - 10_000 * 86400;
    const s = await (await app.request(`${SESSIONS}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: decayItemId, started_at: endTs - 3600 }),
    })).json();
    await app.request(`${SESSIONS}/${s.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: endTs }),
    });

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === decayCategoryId);

    expect(entry.decay_state).toBe('fully_decayed');
  });
});
```

Add this variable declaration near the top of the file (after `let itemId`):
```ts
let decayCategoryId: number;
let decayItemId: number;
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd src/backend && npm test -- --reporter=verbose 2>&1 | grep -A3 "decay fields"
```

Expected: 4 failures — `decay_start_time` and `decay_state` undefined on entry.

- [ ] **Step 3: Implement in `sessions.ts`**

In `src/backend/src/controllers/sessions.ts`, replace the `router.get('/current', ...)` handler. The new version adds a helper function and includes the two new fields in every response entry.

Add this helper above the router:

```ts
type DecayState = 'none' | 'decaying' | 'fully_decayed';

function computeDecay(
  previous: { ended_at: number; rest_seconds: number; target_wear_seconds: number } | null,
  category: { break_grace_time: number; break_decay_multiplier: number; initial_target_wear_duration_seconds: number },
  now: number,
): { decay_start_time: number | null; decay_state: DecayState } {
  if (!previous) return { decay_start_time: null, decay_state: 'none' };

  const decayStartTime = previous.ended_at + previous.rest_seconds + category.break_grace_time;
  if (now <= decayStartTime) return { decay_start_time: decayStartTime, decay_state: 'none' };

  const daysSinceGrace = Math.floor((now - decayStartTime) / 86400);
  const decayFactor = category.break_decay_multiplier ** daysSinceGrace;
  const initial = category.initial_target_wear_duration_seconds;
  const decayed = (previous.target_wear_seconds + initial) * decayFactor;

  const decay_state: DecayState = decayed <= initial ? 'fully_decayed' : 'decaying';
  return { decay_start_time: decayStartTime, decay_state };
}
```

Then in the handler body, after `const previous = sessionStore.findLastEndedInCategory(cat.id) ?? null;`, compute decay and spread it into the returned object:

```ts
router.get('/current', (c) => {
  const categories = categoryStore.findAll();
  const openSessions = sessionStore.findOpenWithItemData();
  const allItems = sessionStore.findAllLastSessions();
  const now = nowSeconds();

  const sessionByCategory = new Map(openSessions.map((s) => [s.category_id, s]));
  const itemsByCategory = new Map<number, ItemWithLastSession[]>();
  for (const item of allItems) {
    if (!itemsByCategory.has(item.category_id)) itemsByCategory.set(item.category_id, []);
    itemsByCategory.get(item.category_id)!.push(item);
  }

  return c.json(
    categories.map((cat) => {
      const previous = sessionStore.findLastEndedInCategory(cat.id) ?? null;
      const injuryActive = injuryStore.hasActiveInCategory(cat.id);
      const { decay_start_time, decay_state } = computeDecay(previous, cat, now);

      const items: ItemWithExpected[] = (itemsByCategory.get(cat.id) ?? []).map((it) => {
        const { target, max } = computeSessionStart(
          cat,
          { difficulty_multiplier: it.difficulty_multiplier },
          previous,
          now,
          injuryActive,
        );
        return { ...it, expected_target: target, expected_max: max };
      });

      const s = sessionByCategory.get(cat.id);
      if (!s) return { category: cat, item: null, session: null, items, decay_start_time, decay_state };

      const item = {
        id: s.item_id, category_id: s.category_id, name: s.item_name,
        color: s.item_color, difficulty_multiplier: s.item_difficulty_multiplier,
      };
      const session = {
        id: s.id, item_id: s.item_id, started_at: s.started_at, ended_at: s.ended_at,
        target_wear_seconds: s.target_wear_seconds, max_wear_seconds: s.max_wear_seconds,
        rest_seconds: s.rest_seconds, ended_in_injury: s.ended_in_injury,
      };
      return { category: cat, item, session, items, decay_start_time, decay_state };
    }),
  );
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd src/backend && npm test -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|decay)"
```

Expected: all 4 new tests pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/controllers/sessions.ts src/backend/tests/sessions/controller.test.ts
git commit -m "feat(api): add decay_start_time and decay_state to /sessions/current"
```

---

### Task 2: Frontend — update types and render decay info + warnings

**Files:**
- Modify: `src/frontend/src/composables/useWear.ts`
- Modify: `src/frontend/src/components/ActionPane.vue`

**Interfaces:**
- Consumes (from Task 1): `decay_start_time: number | null`, `decay_state: 'none' | 'decaying' | 'fully_decayed'` on every entry from `/api/sessions/current`.

- [ ] **Step 1: Update `CurrentEntry` type in `useWear.ts`**

In `src/frontend/src/composables/useWear.ts`, change the `CurrentEntry` interface:

```ts
export interface CurrentEntry {
  category: Category;
  item: Item | null;
  session: Session | null;
  items: ItemWithLastSession[];
  decay_start_time: number | null;
  decay_state: 'none' | 'decaying' | 'fully_decayed';
}
```

No other changes to `useWear.ts` — `fetchCurrent` deserialises from JSON automatically.

- [ ] **Step 2: Add `formatDecayDate` helper and decay UI to `ActionPane.vue`**

In `src/frontend/src/components/ActionPane.vue`, add a helper function in the `<script setup>` block (after the existing `restRemainingMinutes` function):

```ts
function formatDecayDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
```

Then, inside the idle branch template (`<template v-else>` — the block containing the item picker and Wear button), add the following **below** the existing target/max/rest `<div>`:

```html
<!-- Decay info: "Start before" date + warning badge -->
<template v-if="entry.decay_start_time !== null">
  <div class="text-xs text-gray-500 mt-0.5 whitespace-nowrap">
    <span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Start before</span>{{ formatDecayDate(entry.decay_start_time) }}
  </div>
  <div v-if="entry.decay_state === 'decaying'" class="text-xs text-orange-500 mt-0.5">
    <Icon icon="ph:warning" class="inline w-3 h-3 mr-0.5" />Durations are decaying
  </div>
  <div v-else-if="entry.decay_state === 'fully_decayed'" class="text-xs text-red-500 mt-0.5">
    <Icon icon="ph:warning-circle" class="inline w-3 h-3 mr-0.5" />Target and max have returned to initial values
  </div>
</template>
```

The existing `<div v-if="restRemainingMinutes(entry) > 0" ...>` rest countdown stays exactly where it is.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd src/frontend && npx vue-tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/composables/useWear.ts src/frontend/src/components/ActionPane.vue
git commit -m "feat(fe): show Start before date and decay warnings on idle category rows"
```

---

### Task 3: Frontend — greyed Wear button and rest confirmation dialog

**Files:**
- Modify: `src/frontend/src/components/ActionPane.vue`

**Interfaces:**
- Consumes: `restRemainingMinutes(entry)` (existing helper), `selectedItemData(entry)` (existing helper returning `ItemWithLastSession | null`), `formatDuration` (already imported), `onWear(entry)` (existing handler).

- [ ] **Step 1: Add dialog reactive state and `showRestWarning` to `ActionPane.vue` script**

In the `<script setup>` block, add after the existing `selectedItem` declaration:

```ts
import { reactive, ref, onMounted } from 'vue';
```

(Replace the existing `import { reactive, onMounted } from 'vue';` — just add `ref`.)

Then add below the `selectedItem` declaration:

```ts
const restWarning = reactive<{
  visible: boolean;
  entry: CurrentEntry | null;
}>({ visible: false, entry: null });

function showRestWarning(entry: CurrentEntry) {
  restWarning.entry = entry;
  restWarning.visible = true;
}

async function onWearConfirmed() {
  restWarning.visible = false;
  if (restWarning.entry) await onWear(restWarning.entry);
}
```

- [ ] **Step 2: Grey the Wear button and intercept click while resting**

Find this snippet in the `<template v-else>` idle branch of `ActionPane.vue`:

```html
<k-button
  small
  :disabled="!selectedItem[entry.category.id]"
  @click="onWear(entry)"
>Wear</k-button>
```

Replace it with:

```html
<k-button
  small
  :disabled="!selectedItem[entry.category.id]"
  :class="{ 'opacity-60': restRemainingMinutes(entry) > 0 }"
  @click="restRemainingMinutes(entry) > 0 ? showRestWarning(entry) : onWear(entry)"
>Wear</k-button>
```

- [ ] **Step 3: Add the confirmation dialog to the template**

Konsta's dialog needs `kDialog`, `kDialogButton` imports. Add them to the existing konsta import line:

```ts
import { kBlockTitle, kList, kListItem, kButton, kDialog, kDialogButton } from 'konsta/vue';
```

At the very bottom of the `<template>` (just before the closing `</template>` tag of `ActionPane.vue`), add:

```html
<!-- Rest-period confirmation dialog -->
<k-dialog
  :opened="restWarning.visible"
  @backdropclick="restWarning.visible = false"
>
  <template #title>Start during rest?</template>
  <template #content>
    <template v-if="restWarning.entry">
      {{ restRemainingMinutes(restWarning.entry) }} min of rest remaining.
      Starting early will halve your target:
      <strong>{{ idleTarget(restWarning.entry) }}</strong> instead of the normal value.
    </template>
  </template>
  <template #buttons>
    <k-dialog-button @click="restWarning.visible = false">Cancel</k-dialog-button>
    <k-dialog-button strong @click="onWearConfirmed">Start anyway</k-dialog-button>
  </template>
</k-dialog>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd src/frontend && npx vue-tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/ActionPane.vue
git commit -m "feat(fe): grey Wear button during rest; show penalty confirmation dialog"
```
