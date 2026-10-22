# Category Streak Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-07-07-category-streak-badge-design.md`:
show each category's current streak (`category_stats.streak_count`) as a
small flame-icon badge next to the category name on its Home-tab row.

**Architecture:** Backend: expose the already-tracked `streak_count` on
`GET /api/sessions/current` by reusing `statsStore.findForCategory`. No new
streak logic, no DB changes. Frontend: add the field to `CurrentEntry` and
render it in `ActionPane.vue`'s shared `#title` slot (introduced by the
active-session-row-layout plan), which already renders on both active and
idle rows.

**Tech Stack:** TypeScript, Hono, better-sqlite3, Vue 3 `<script setup>`,
Vitest, Playwright.

## Global Constraints

- No new DB columns/migrations — `streak_count` already exists in
  `category_stats`.
- Badge hidden entirely when `streak_count` is 0.
- Shown on both active-session and idle rows (category-level stat).
- Out of scope: any change to streak calculation/reset logic; best-streak
  display.

## Prerequisite

This plan depends on the `#title` slot added to `ActionPane.vue` by the
active-session-row-layout plan (Task 4 there). That slot currently reads:

```html
<template #title>
  <span v-if="entry.session && entry.item" class="ml-1.5 text-sm font-normal text-gray-500">{{ entry.item.name }}</span>
</template>
```

Confirm this slot exists (and the row-layout plan's Task 4/5 are merged)
before starting Task 2 below — if the file doesn't match, stop and check
what changed rather than guessing.

---

### Task 1: Backend — `streak_count` on `/api/sessions/current`

**Files:**
- Modify: `src/backend/src/controllers/sessions.ts`
- Test: `src/backend/tests/sessions/controller.test.ts`

**Interfaces:**
- Consumes: `statsStore.findForCategory(categoryId): (CategoryStats & { item_count: number }) | undefined`
  (existing, `src/backend/src/db/stores/stats-store.ts:118`), whose
  `CategoryStats` includes `streak_count: number`.
- Produces: each entry from `GET /api/sessions/current` gains
  `streak_count: number`, consumed by Task 2 (frontend type + UI).

- [ ] **Step 1: Write the failing tests**

Add to `src/backend/tests/sessions/controller.test.ts` (new `describe`
block; the file already imports `describe`, `it`, `expect`, `beforeAll`,
`app`, `runMigrations`, `createCategory`, `createItem` — reuse those):

```ts
describe('GET /api/sessions/current streak_count', () => {
  it('is 0 for a fresh category with no sessions', async () => {
    const cat = await (await createCategory({ name: 'Streak Fresh Cat' })).json();
    await createItem(cat.id, { name: 'Streak Fresh Item' });

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === cat.id);
    expect(entry.streak_count).toBe(0);
  });

  it('reflects the category streak after consecutive sessions', async () => {
    const cat = await (
      await createCategory({
        name: 'Streak Active Cat',
        rest_multiplier: 0,
        minimum_rest: 0,
        break_grace_time: 1000,
      })
    ).json();
    const item = await (await createItem(cat.id, { name: 'Streak Active Item' })).json();

    // First session: 0 -> 50, ends with rest_seconds 0 (rest_multiplier 0).
    const s1 = await (
      await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, started_at: 0 }),
      })
    ).json();
    await app.request(`${SESSIONS}/${s1.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 50 }),
    });

    // Second session starts at 100 — within earliest_start(50)..latest_start(50+1000).
    const s2 = await (
      await app.request(`${SESSIONS}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, started_at: 100 }),
      })
    ).json();
    await app.request(`${SESSIONS}/${s2.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: 150 }),
    });

    const res = await app.request(`${SESSIONS}/current`);
    const body = await res.json();
    const entry = body.find((e: { category: { id: number } }) => e.category.id === cat.id);
    expect(entry.streak_count).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/backend && npm test -- controller.test.ts`
Expected: FAIL — `entry.streak_count` is `undefined`.

- [ ] **Step 3: Implement**

In `src/backend/src/controllers/sessions.ts`, add the import:

```ts
import { statsStore } from '../db/stores/stats-store.js';
```

Change the `/current` handler's category-mapping body from:

```ts
    categories.map((cat) => {
      const previous = sessionStore.findLastEndedInCategory(cat.id) ?? null;
      const injuryActive = injuryStore.hasActiveInCategory(cat.id);
      const { decay_start_time, decay_state, decay_full_time } = computeDecay(previous, cat, now);

      const items = enrichItemsWithExpected(itemsByCategory.get(cat.id) ?? [], cat, previous, now, injuryActive);

      const s = sessionByCategory.get(cat.id);
      if (!s) return { category: cat, item: null, session: null, items, decay_start_time, decay_state, decay_full_time };

      const item = {
        id: s.item_id, category_id: s.category_id, name: s.item_name,
        color: s.item_color, difficulty_multiplier: s.item_difficulty_multiplier,
      };
      const session = {
        id: s.id, item_id: s.item_id, started_at: s.started_at, ended_at: s.ended_at,
        target_wear_seconds: s.target_wear_seconds, max_wear_seconds: s.max_wear_seconds,
        rest_seconds: s.rest_seconds, ended_in_injury: s.ended_in_injury,
      };
      return { category: cat, item, session, items, decay_start_time, decay_state, decay_full_time };
    }),
```

to:

```ts
    categories.map((cat) => {
      const previous = sessionStore.findLastEndedInCategory(cat.id) ?? null;
      const injuryActive = injuryStore.hasActiveInCategory(cat.id);
      const { decay_start_time, decay_state, decay_full_time } = computeDecay(previous, cat, now);
      const streak_count = statsStore.findForCategory(cat.id)?.streak_count ?? 0;

      const items = enrichItemsWithExpected(itemsByCategory.get(cat.id) ?? [], cat, previous, now, injuryActive);

      const s = sessionByCategory.get(cat.id);
      if (!s) return { category: cat, item: null, session: null, items, decay_start_time, decay_state, decay_full_time, streak_count };

      const item = {
        id: s.item_id, category_id: s.category_id, name: s.item_name,
        color: s.item_color, difficulty_multiplier: s.item_difficulty_multiplier,
      };
      const session = {
        id: s.id, item_id: s.item_id, started_at: s.started_at, ended_at: s.ended_at,
        target_wear_seconds: s.target_wear_seconds, max_wear_seconds: s.max_wear_seconds,
        rest_seconds: s.rest_seconds, ended_in_injury: s.ended_in_injury,
      };
      return { category: cat, item, session, items, decay_start_time, decay_state, decay_full_time, streak_count };
    }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/backend && npm test -- controller.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `cd src/backend && npm test`
Expected: All tests PASS (confirms `statsStore.findForCategory` returning
`undefined` for a category with no `category_stats` row, if that's ever
possible, doesn't throw — `initCategory` is called on category creation, so
in practice every category has a row from the start).

- [ ] **Step 6: Commit**

```bash
git add src/backend/src/controllers/sessions.ts src/backend/tests/sessions/controller.test.ts
git commit -m "feat(backend): expose category streak_count on /api/sessions/current"
```

---

### Task 2: Frontend — streak badge in the shared title slot

**Files:**
- Modify: `src/frontend/src/composables/useWear.ts`
- Modify: `src/frontend/src/components/ActionPane.vue`

**Interfaces:**
- Consumes: `streak_count` from the API (Task 1).
- Produces: `CurrentEntry.streak_count: number`. No new functions — this is
  a type addition plus template markup only.

- [ ] **Step 1: Add `streak_count` to `CurrentEntry`**

In `src/frontend/src/composables/useWear.ts`, change:

```ts
export interface CurrentEntry {
  category: Category;
  item: Item | null;
  session: Session | null;
  items: ItemWithLastSession[];
  decay_start_time: number | null;
  decay_state: 'none' | 'decaying' | 'fully_decayed';
  decay_full_time: number | null;
}
```

to:

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
}
```

- [ ] **Step 2: Add the badge to the `#title` slot**

In `src/frontend/src/components/ActionPane.vue`, change:

```html
        <template #title>
          <span v-if="entry.session && entry.item" class="ml-1.5 text-sm font-normal text-gray-500">{{ entry.item.name }}</span>
        </template>
```

to:

```html
        <template #title>
          <span
            v-if="entry.streak_count > 0"
            class="ml-1.5 text-xs text-orange-500 inline-flex items-center gap-0.5 align-middle"
            data-testid="streak-badge"
          >
            <Icon icon="ph:flame" class="w-3 h-3" />{{ entry.streak_count }}
          </span>
          <span v-if="entry.session && entry.item" class="ml-1.5 text-sm font-normal text-gray-500">{{ entry.item.name }}</span>
        </template>
```

(`Icon` from `@iconify/vue` is already imported in this file — no import
changes needed.)

- [ ] **Step 3: Typecheck**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 4: Manually verify**

Run: `cd src/frontend && npm run dev`. Confirm a category with a streak
shows the flame badge next to its name on both an idle row and (start a
session) an active row; confirm a category with no streak shows nothing
extra next to its name.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/composables/useWear.ts src/frontend/src/components/ActionPane.vue
git commit -m "feat(frontend): show category streak badge next to the category name"
```

---

### Task 3: E2E — streak badge visibility

**Files:**
- Modify: `src/frontend/tests/e2e/wear.spec.ts`

**Interfaces:**
- Consumes: `data-testid="streak-badge"` from Task 2; `POST
  /api/sessions/start` and `POST /api/sessions/:id/end` accepting explicit
  `started_at`/`ended_at` (pre-existing, used elsewhere in this file).

- [ ] **Step 1: Add the test**

Add to `src/frontend/tests/e2e/wear.spec.ts`:

```ts
test.describe('Category streak badge', () => {
  let categoryId: number;
  let categoryName: string;
  let itemId: number;

  test.beforeAll(async ({ request }) => {
    categoryName = `StreakCat-${uid()}`;
    const catRes = await request.post('/api/categories', {
      data: {
        name: categoryName,
        icon: '🔥',
        initial_target_wear_duration_seconds: 100,
        initial_max_wear_duration_seconds: 200,
        rest_multiplier: 0,
        minimum_rest: 0,
        risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
        break_decay_multiplier: 0.91,
        break_grace_time: 1000,
      },
    });
    const cat = await catRes.json();
    categoryId = cat.id;

    const itemRes = await request.post('/api/items', {
      data: { name: `StreakItem-${uid()}`, color: '#f97316', category_id: categoryId },
    });
    itemId = (await itemRes.json()).id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/categories/${categoryId}`);
  });

  test('hidden with no streak, shown with count after consecutive sessions', async ({ page, request }) => {
    await page.goto('/');
    const row = page.locator('li', { hasText: categoryName });
    await expect(row.getByTestId('streak-badge')).not.toBeVisible();

    const s1 = await (
      await request.post('/api/sessions/start', { data: { item_id: itemId, started_at: 0 } })
    ).json();
    await request.post(`/api/sessions/${s1.id}/end`, { data: { ended_at: 50 } });
    const s2 = await (
      await request.post('/api/sessions/start', { data: { item_id: itemId, started_at: 100 } })
    ).json();
    await request.post(`/api/sessions/${s2.id}/end`, { data: { ended_at: 150 } });

    await page.reload();
    await expect(row.getByTestId('streak-badge')).toBeVisible();
    await expect(row.getByTestId('streak-badge')).toHaveText('2');
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `cd src/frontend && npx playwright test wear.spec.ts -g "Category streak badge"`
Expected: PASS.

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd src/frontend && npm run test:ci && npx playwright test`
Expected: All unit and e2e tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/tests/e2e/wear.spec.ts
git commit -m "test(e2e): verify category streak badge visibility"
```
