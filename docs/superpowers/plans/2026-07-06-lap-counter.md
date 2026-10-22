# Lap Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the null-max "lap counter" mechanic from
`docs/superpowers/specs/2026-07-06-lap-counter-design.md`: the active-session
bar wraps every time elapsed crosses a multiple of target, a lap badge and
escalating glow/sparkle effects render on the bar, and long sessions carry a
bonus into the next session's target growth.

**Architecture:** Backend: extend `PreviousSession`/`computeSessionStart` in
`src/backend/src/db/calculations.ts` with a `lapCount` helper and the
carry-over term on both session-start branches (also fixing a bug where the
early-restart branch ignored the difficulty modifier). Frontend: add pure
`lapCount`/`lapFillFraction`/`lapTier` helpers to `wearCalculations.ts`, and
extract the active-session bar out of `ActionPane.vue` into a new
`WearProgressBar.vue` component that owns fill/target-marker/badge/glow/
sparkle rendering. This component is intentionally built to also accept
rest/decay modes later (see the separate active-session-row-layout plan) but
this plan only implements its wear-mode behavior.

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, Vitest (unit tests),
Playwright (e2e), Hono + `better-sqlite3` backend.

## Global Constraints

- `lap_count` is only ever nonzero when `category.initial_max_wear_duration_seconds`
  is null. Categories with a max are completely unaffected by every change in
  this plan.
- No new DB columns/migrations. `lap_count` is always derived, never stored.
- Bar effects escalate through tiers 0–4 and cap at tier 4 (`lap_count >= 8`).
- All CSS animations respect `prefers-reduced-motion: reduce`.

---

### Task 1: Backend — thread `started_at` through `PreviousSession`

**Files:**
- Modify: `src/backend/src/db/calculations.ts:22-27` (interface)
- Modify: `src/backend/src/db/stores/session-store.ts:124-133` (SQL)
- Modify: `src/backend/tests/db/calculations.test.ts:60-100` (existing fixtures)

**Interfaces:**
- Produces: `PreviousSession` now includes `started_at: number`, consumed by
  Task 2's `lapCount()`.

Lap counting needs the previous session's elapsed time
(`ended_at - started_at`), but `PreviousSession` currently only carries
`ended_at`. This task plumbs `started_at` through with no behavior change.

- [ ] **Step 1: Add `started_at` to the `PreviousSession` interface**

In `src/backend/src/db/calculations.ts`, change:

```ts
export interface PreviousSession {
  target_wear_seconds: number;
  max_wear_seconds: number | null;
  ended_at: number;
  rest_seconds: number;
}
```

to:

```ts
export interface PreviousSession {
  target_wear_seconds: number;
  max_wear_seconds: number | null;
  ended_at: number;
  started_at: number;
  rest_seconds: number;
}
```

- [ ] **Step 2: Select `started_at` in the query that builds it**

In `src/backend/src/db/stores/session-store.ts`, change `findLastEndedInCategory`:

```ts
  findLastEndedInCategory(categoryId: number): PreviousSession | undefined {
    return db
      .prepare(
        `SELECT s.target_wear_seconds, s.max_wear_seconds, s.ended_at, s.rest_seconds
         FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.ended_at IS NOT NULL AND s.ended_in_injury = 0
         ORDER BY s.ended_at DESC LIMIT 1`,
      )
      .get(categoryId) as PreviousSession | undefined;
  }
```

to:

```ts
  findLastEndedInCategory(categoryId: number): PreviousSession | undefined {
    return db
      .prepare(
        `SELECT s.target_wear_seconds, s.max_wear_seconds, s.ended_at, s.started_at, s.rest_seconds
         FROM sessions s JOIN items i ON i.id = s.item_id
         WHERE i.category_id = ? AND s.ended_at IS NOT NULL AND s.ended_in_injury = 0
         ORDER BY s.ended_at DESC LIMIT 1`,
      )
      .get(categoryId) as PreviousSession | undefined;
  }
```

- [ ] **Step 3: Fix existing test fixtures to satisfy the wider interface**

`PreviousSession` object literals in `src/backend/tests/db/calculations.test.ts`
now need a `started_at` field to type-check. All of these fixtures use a
category with a max set, so `lap_count` never applies to them regardless of
the value chosen — pick any value earlier than `ended_at`.

Update each of the 5 literals in the `computeSessionStart` describe block
(the ones with `target_wear_seconds`, `max_wear_seconds`, `ended_at`,
`rest_seconds`) by adding `started_at: <ended_at value> - 100` to each. For
example:

```ts
  it('after rest, grows by difficulty * (prev + initial)', () => {
    const prev = { target_wear_seconds: 900, max_wear_seconds: 1800, ended_at: 0, started_at: -100, rest_seconds: 100 };
    // earliest_start = 100; start at 200 (>= earliest, <= latest 100+86400)
    const r = computeSessionStart(cat, item, prev, 200, false);
    expect(r).toEqual({ target: 1800, max: 3600 });
  });
```

Apply the same `started_at: <ended_at> - 100` pattern to the other 4
literals (`inside rest period halves prev target/max`, `past grace applies
daily decay`, `floors target and max at initial values when halving inside
rest period would go below`, and any other `PreviousSession` literal in the
file).

- [ ] **Step 4: Run the backend test suite to confirm nothing broke**

Run: `cd src/backend && npm test -- calculations.test.ts`
Expected: All existing tests still PASS (this step only added a field, no
behavior changed).

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/db/calculations.ts src/backend/src/db/stores/session-store.ts src/backend/tests/db/calculations.test.ts
git commit -m "refactor(backend): thread started_at through PreviousSession"
```

---

### Task 2: Backend — `lapCount` and the session-start carry-over formula

**Files:**
- Modify: `src/backend/src/db/calculations.ts:54-109` (`growDurations`, `rawDurations`, new `lapCount`)
- Modify: `src/backend/tests/db/calculations.test.ts` (new tests)

**Interfaces:**
- Consumes: `PreviousSession` (with `started_at`, from Task 1).
- Produces: `lapCount(previous: PreviousSession): number`, exported for
  potential reuse; `computeSessionStart` behavior changes described below.

- [ ] **Step 1: Write the failing tests**

Add to `src/backend/tests/db/calculations.test.ts` (update the import line
to also bring in `lapCount`):

```ts
import {
  restWeight,
  riskLevelFor,
  computeSessionStart,
  computeRest,
  lapCount,
  type Category,
} from '../../src/db/calculations.js';
```

Add these new `describe` blocks after the existing `computeSessionStart`
block:

```ts
describe('lapCount', () => {
  it('floors elapsed/target', () => {
    const prev = { target_wear_seconds: 100, max_wear_seconds: null, ended_at: 350, started_at: 0, rest_seconds: 0 };
    expect(lapCount(prev)).toBe(3);
  });

  it('is 0 when elapsed is less than one target', () => {
    const prev = { target_wear_seconds: 100, max_wear_seconds: null, ended_at: 50, started_at: 0, rest_seconds: 0 };
    expect(lapCount(prev)).toBe(0);
  });
});

describe('computeSessionStart — lap carry-over (null-max categories only)', () => {
  const noMaxCat: Category = { ...cat, initial_max_wear_duration_seconds: null, initial_target_wear_duration_seconds: 50 };

  it('adds floor(lapCount/2) * previous.target on the normal-growth branch', () => {
    // previous session: target 100, elapsed 350 (1000 - 650) => lapCount = 3, floor(3/2) = 1
    const prev = { target_wear_seconds: 100, max_wear_seconds: null, ended_at: 1000, started_at: 650, rest_seconds: 0 };
    // earliest_start = 1000; start at 1000 (>= earliest, <= latest 1000+86400) => normal-growth branch
    const r = computeSessionStart(noMaxCat, item, prev, 1000, false);
    // target = 1 * (100 + 50 + 1*100) = 250
    expect(r).toEqual({ target: 250, max: null });
  });

  it('adds the same carry-over on the early-restart branch, scaled by difficulty/2', () => {
    // previous session: target 100, elapsed 450 (1000 - 550) => lapCount = 4, floor(4/2) = 2
    const prev = { target_wear_seconds: 100, max_wear_seconds: null, ended_at: 1000, started_at: 550, rest_seconds: 500 };
    // earliest_start = 1500; start at 1000 (< earliest_start) => early-restart branch
    const r = computeSessionStart(noMaxCat, item, prev, 1000, false);
    // target = (1/2) * (100 + 2*100) = 150
    expect(r).toEqual({ target: 150, max: null });
  });

  it('never applies a lap carry-over to max-set categories', () => {
    // same shape as the normal-growth test above, but on `cat` (max is set)
    const prev = { target_wear_seconds: 100, max_wear_seconds: 1800, ended_at: 1000, started_at: 650, rest_seconds: 0 };
    const r = computeSessionStart(cat, item, prev, 1000, false);
    // unaffected by lapCount(=3) despite elapsed(350) > target(100) — `cat` has a max set
    expect(r).toEqual({ target: 1000, max: 3600 });
  });
});

describe('computeSessionStart — difficulty modifier now applied on the early-restart branch', () => {
  it('scales the halved target by the item difficulty modifier (bug fix)', () => {
    const prev = { target_wear_seconds: 2000, max_wear_seconds: 4000, ended_at: 0, started_at: -100, rest_seconds: 500 };
    const hardItem = { difficulty_multiplier: 2 }; // dm = 1/2 = 0.5
    const r = computeSessionStart(cat, hardItem, prev, 100, false); // start(100) < earliest_start(500)
    // target = (dm/2) * (2000 + 0) = 500
    expect(r.target).toBe(500);
    // max is untouched by this fix: previous.max/2 = 2000 (no difficulty modifier applied to max)
    expect(r.max).toBe(2000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/backend && npm test -- calculations.test.ts`
Expected: FAIL — `lapCount` is not exported yet, and the lap-carry-over /
difficulty-modifier tests produce the old (wrong) numbers.

- [ ] **Step 3: Implement `lapCount` and update the formula**

In `src/backend/src/db/calculations.ts`, add the exported function (place it
near the top, after `parseRiskLevels`/`riskLevelFor`):

```ts
/** Completed laps in a previous session: floor(elapsed / target). Only meaningful for null-max categories. */
export function lapCount(previous: PreviousSession): number {
  const elapsed = previous.ended_at - previous.started_at;
  return Math.floor(elapsed / previous.target_wear_seconds);
}
```

Replace `growDurations`:

```ts
/** Previous durations grown by one category increment, scaled by difficulty modifier. */
function growDurations(
  previous: PreviousSession,
  category: Category,
  dm: number,
): { target: number; max: number | null } {
  const maxIsSet = category.initial_max_wear_duration_seconds !== null;
  const lapBonus = maxIsSet ? 0 : Math.floor(lapCount(previous) / 2) * previous.target_wear_seconds;
  return {
    target: dm * (previous.target_wear_seconds + category.initial_target_wear_duration_seconds + lapBonus),
    max: maxIsSet
      ? dm * ((previous.max_wear_seconds ?? 0) + category.initial_max_wear_duration_seconds!)
      : null,
  };
}
```

Replace the early-restart branch inside `rawDurations`:

```ts
/** Raw durations for the three start situations: first session, inside rest (halve), or post-rest (grow + optional decay). */
function rawDurations(
  previous: PreviousSession | null,
  category: Category,
  dm: number,
  startTime: number,
): { target: number; max: number | null } {
  const maxIsSet = category.initial_max_wear_duration_seconds !== null;

  if (!previous) {
    return {
      target: dm * category.initial_target_wear_duration_seconds,
      max: maxIsSet ? dm * category.initial_max_wear_duration_seconds! : null,
    };
  }

  const earliestStart = previous.ended_at + previous.rest_seconds;
  const latestStart = earliestStart + category.break_grace_time;

  let target: number;
  let max: number | null;

  if (startTime < earliestStart) {
    const lapBonus = maxIsSet ? 0 : Math.floor(lapCount(previous) / 2) * previous.target_wear_seconds;
    target = (dm / 2) * (previous.target_wear_seconds + lapBonus);
    max = maxIsSet ? (previous.max_wear_seconds ?? 0) / 2 : null;
  } else {
    ({ target, max } = growDurations(previous, category, dm));
  }

  if (startTime > latestStart) {
    const daysSinceGrace = Math.floor((startTime - latestStart) / 86400);
    ({ target, max } = applyBreakDecay(target, max, daysSinceGrace, category.break_decay_multiplier));
  }

  return { target, max };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/backend && npm test -- calculations.test.ts`
Expected: All tests PASS, including the new lap-counter and difficulty-fix
tests.

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/db/calculations.ts src/backend/tests/db/calculations.test.ts
git commit -m "feat(backend): add null-max lap carry-over to session-start formula"
```

---

### Task 3: Frontend — `lapCount`/`lapFillFraction`/`lapTier` utilities

**Files:**
- Modify: `src/frontend/src/utils/wearCalculations.ts`
- Modify: `src/frontend/src/utils/wearCalculations.test.ts`

**Interfaces:**
- Produces: `lapCount(elapsed: number, target: number): number`,
  `lapFillFraction(elapsed: number, target: number): number` (0–1),
  `lapTier(lapCount: number): number` (0–4). Consumed by Task 4
  (`WearProgressBar.vue`) and Task 5 (`ActionPane.vue`).

- [ ] **Step 1: Write the failing tests**

Add to `src/frontend/src/utils/wearCalculations.test.ts`:

```ts
import { targetWearSeconds, maxWearSeconds, remainingWearSeconds, lapCount, lapFillFraction, lapTier } from './wearCalculations.js';

describe('lapCount', () => {
  it('is 0 before the first lap completes', () => {
    expect(lapCount(50, 100)).toBe(0);
  });

  it('counts completed laps', () => {
    expect(lapCount(350, 100)).toBe(3);
  });
});

describe('lapFillFraction', () => {
  it('matches plain elapsed/target before the first wrap', () => {
    expect(lapFillFraction(40, 100)).toBeCloseTo(0.4);
  });

  it('wraps back to 0 exactly at a multiple of target', () => {
    expect(lapFillFraction(300, 100)).toBe(0);
  });

  it('wraps partway through a later lap', () => {
    expect(lapFillFraction(350, 100)).toBeCloseTo(0.5);
  });
});

describe('lapTier', () => {
  it.each([
    [0, 0], [1, 0], [2, 1], [3, 2], [4, 2], [5, 3], [7, 3], [8, 4], [20, 4],
  ])('lapTier(%i) === %i', (count, tier) => {
    expect(lapTier(count)).toBe(tier);
  });
});
```

(Update the top `import` line in the same file to add `lapCount`,
`lapFillFraction`, `lapTier` to the existing named imports rather than
duplicating the import statement.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/frontend && npx vitest run wearCalculations.test.ts`
Expected: FAIL — `lapCount`, `lapFillFraction`, `lapTier` are not exported
yet.

- [ ] **Step 3: Implement the utilities**

Add to `src/frontend/src/utils/wearCalculations.ts`:

```ts
/** Completed laps for the current elapsed time (null-max categories only). */
export function lapCount(elapsed: number, target: number): number {
  if (target <= 0) return 0;
  return Math.floor(elapsed / target);
}

/** Bar fill fraction (0-1) that wraps every `target` seconds instead of capping at 1. */
export function lapFillFraction(elapsed: number, target: number): number {
  if (target <= 0) return 0;
  return (elapsed % target) / target;
}

/** Visual effect tier (0-4) for a given lap count. Caps at tier 4 from lap 8 onward. */
export function lapTier(lapCount: number): number {
  if (lapCount >= 8) return 4;
  if (lapCount >= 5) return 3;
  if (lapCount >= 3) return 2;
  if (lapCount >= 2) return 1;
  return 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/frontend && npx vitest run wearCalculations.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/utils/wearCalculations.ts src/frontend/src/utils/wearCalculations.test.ts
git commit -m "feat(frontend): add lap count/fill/tier calculation helpers"
```

---

### Task 4: Frontend — `WearProgressBar.vue` component

**Files:**
- Create: `src/frontend/src/components/WearProgressBar.vue`

**Interfaces:**
- Consumes: `lapTier` from `../utils/wearCalculations.js` (Task 3).
- Produces: A Vue component with props
  `{ fillFraction: number; color: string; targetMarkerFraction?: number | null; lapCount?: number }`,
  rendering the bar, an optional target marker (`data-testid="target-marker"`),
  an optional lap badge (`data-testid="lap-badge"`, text `${lapCount}x`,
  shown only when `lapCount >= 1`), and tiered glow/sparkle effects. Root
  element carries `data-testid="wear-progress-bar"` and a `tier-{N}` class.
  Consumed by Task 5 (`ActionPane.vue`).

There is no component-testing framework in this codebase (`@vue/test-utils`
is not installed; component behavior is verified via Playwright e2e against
the rendered DOM — see Task 6). This task has no isolated unit-test step;
its behavior is verified end-to-end once wired into `ActionPane.vue`.

- [ ] **Step 1: Create the component**

Create `src/frontend/src/components/WearProgressBar.vue`:

```vue
<template>
  <div class="wear-progress" :class="`tier-${tier}`" :style="{ '--glow-color': color }" data-testid="wear-progress-bar">
    <span v-if="lapCount >= 1" class="lap-badge" data-testid="lap-badge">{{ lapCount }}x</span>
    <div class="bar-wrap">
      <div class="bar-fill" :style="{ width: fillFraction * 100 + '%', background: color }"></div>
      <div
        v-if="targetMarkerFraction !== null"
        class="target-marker"
        data-testid="target-marker"
        :style="{ left: targetMarkerFraction * 100 + '%' }"
      ></div>
      <div v-if="tier >= 2" class="sparkle-field">
        <div
          v-for="(s, i) in sparkles"
          :key="i"
          class="sparkle"
          :style="{ left: s.left + '%', top: s.top + '%', animationDelay: s.delay + 's' }"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { lapTier } from '../utils/wearCalculations.js';

const props = withDefaults(
  defineProps<{
    fillFraction: number;
    color: string;
    targetMarkerFraction?: number | null;
    lapCount?: number;
  }>(),
  {
    targetMarkerFraction: null,
    lapCount: 0,
  },
);

const tier = computed(() => lapTier(props.lapCount));

/** Sparkle count per tier: 0 (plain), 1 (glow only), 2, 3, 4 (max, capped). */
const SPARKLE_COUNTS = [0, 0, 6, 20, 28];

function generateSparkles(n: number): { left: number; top: number; delay: number }[] {
  if (n === 0) return [];
  const tops = [0, 15, 30, 45, 60];
  return Array.from({ length: n }, (_, i) => ({
    left: Math.round(i * (96 / (n - 1)) * 10) / 10,
    top: tops[i % tops.length],
    delay: Math.round(i * (1.4 / n) * 100) / 100,
  }));
}

const sparkles = computed(() => generateSparkles(SPARKLE_COUNTS[tier.value]));
</script>

<style scoped>
.wear-progress {
  position: relative;
}
.lap-badge {
  position: absolute;
  top: -18px;
  right: 0;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  color: #fff;
  background: var(--glow-color);
}
.bar-wrap {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: #e5e7eb;
  overflow: visible;
}
.bar-fill {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  transition: width 1s;
}
.target-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #4b5563;
}
.sparkle-field {
  position: absolute;
  inset: -6px -2px;
  pointer-events: none;
}
.sparkle {
  position: absolute;
  width: 6px;
  height: 6px;
  background: var(--glow-color);
  clip-path: polygon(50% 0%, 63% 37%, 100% 50%, 63% 63%, 50% 100%, 37% 63%, 0% 50%, 37% 37%);
  opacity: 0;
  animation: sparkle-pop 1.6s ease-in-out infinite;
}
@keyframes sparkle-pop {
  0% { opacity: 0; transform: scale(0.3) rotate(0deg); }
  40% { opacity: 1; transform: scale(1.15) rotate(25deg); }
  100% { opacity: 0; transform: scale(0.3) rotate(45deg); }
}
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 2px 0 var(--glow-color); }
  50% { box-shadow: 0 0 10px 2px var(--glow-color); }
}
.tier-1 .bar-fill { animation: glow-pulse 1.8s ease-in-out infinite; }
.tier-2 .bar-fill { animation: glow-pulse 1.6s ease-in-out infinite; }
.tier-3 .bar-fill { animation: glow-pulse 1.1s ease-in-out infinite; }
.tier-4 .bar-fill { animation: glow-pulse 0.7s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .bar-fill, .sparkle { animation: none !important; }
}
</style>
```

- [ ] **Step 2: Typecheck**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: No new type errors from `WearProgressBar.vue`.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/components/WearProgressBar.vue
git commit -m "feat(frontend): add WearProgressBar component with lap tier effects"
```

---

### Task 5: Frontend — wire `WearProgressBar` into `ActionPane.vue`

**Files:**
- Modify: `src/frontend/src/components/ActionPane.vue:39-46` (template)
- Modify: `src/frontend/src/components/ActionPane.vue:147-160` (imports)
- Modify: `src/frontend/src/components/ActionPane.vue:239-250` (helpers)

**Interfaces:**
- Consumes: `WearProgressBar` (Task 4), `lapCount`/`lapFillFraction` from
  `wearCalculations.ts` (Task 3).
- Produces: `barFillFraction(entry)`, `targetMarkerFraction(entry)`,
  `lapCountFor(entry)` — local to `ActionPane.vue`, no other file depends on
  them.

- [ ] **Step 1: Replace the inline bar markup**

In `src/frontend/src/components/ActionPane.vue`, replace:

```html
        <template v-if="entry.session && entry.item" #inner>
          <div class="relative h-1.5 rounded-full bg-gray-200 overflow-hidden mt-1">
            <div class="h-full rounded-full transition-all duration-1000"
              :style="{ width: wearProgress(entry) + '%', background: entry.item.color }"></div>
            <div class="absolute top-0 bottom-0 w-0.5 bg-gray-600"
              :style="{ left: targetMarkerPercent(entry) + '%' }" data-testid="target-marker"></div>
          </div>
        </template>
```

with:

```html
        <template v-if="entry.session && entry.item" #inner>
          <WearProgressBar
            class="mt-1"
            :fill-fraction="barFillFraction(entry)"
            :color="entry.item.color"
            :target-marker-fraction="targetMarkerFraction(entry)"
            :lap-count="lapCountFor(entry)"
          />
        </template>
```

- [ ] **Step 2: Update imports**

Change:

```ts
import { kBlockTitle, kList, kListItem, kButton, kDialog, kDialogButton } from 'konsta/vue';
import { useWear, type CurrentEntry, type Session, type ItemWithLastSession } from '../composables/useWear.js';
import { useItems } from '../composables/useItems.js';
import { useNow } from '../composables/useNow.js';
import { useToast } from '../composables/useToast.js';
import { formatDuration, shortDuration } from '../utils/formatDuration.js';
import { targetWearSeconds, maxWearSeconds, currentWear, remainingWearSeconds } from '../utils/wearCalculations.js';
```

to:

```ts
import { kBlockTitle, kList, kListItem, kButton, kDialog, kDialogButton } from 'konsta/vue';
import WearProgressBar from './WearProgressBar.vue';
import { useWear, type CurrentEntry, type Session, type ItemWithLastSession } from '../composables/useWear.js';
import { useItems } from '../composables/useItems.js';
import { useNow } from '../composables/useNow.js';
import { useToast } from '../composables/useToast.js';
import { formatDuration, shortDuration } from '../utils/formatDuration.js';
import { targetWearSeconds, maxWearSeconds, currentWear, remainingWearSeconds, lapCount, lapFillFraction } from '../utils/wearCalculations.js';
```

- [ ] **Step 3: Replace `wearProgress`/`targetMarkerPercent` with fraction-based helpers**

`barCeiling` stays (it's also used by `rowBg`, which is unchanged). Replace
only `wearProgress` and `targetMarkerPercent`:

```ts
function wearProgress(entry: CurrentEntry): number {
  const ceiling = barCeiling(entry);
  if (!entry.session || ceiling <= 0) return 0;
  return Math.min((sessionSeconds(entry.session) / ceiling) * 100, 100);
}

/** Target marker position as a percentage of the bar ceiling. */
function targetMarkerPercent(entry: CurrentEntry): number {
  const ceiling = barCeiling(entry);
  if (!entry.session || ceiling <= 0) return 100;
  return Math.min((targetWearSeconds(entry.session) / ceiling) * 100, 100);
}
```

with:

```ts
/** Bar fill fraction (0-1): fraction of max if set, else wraps every `target` seconds (lap mechanic). */
function barFillFraction(entry: CurrentEntry): number {
  if (!entry.session) return 0;
  const max = maxWearSeconds(entry.session);
  const target = targetWearSeconds(entry.session);
  const elapsed = sessionSeconds(entry.session);
  if (max === null) return lapFillFraction(elapsed, target);
  if (max <= 0) return 0;
  return Math.min(elapsed / max, 1);
}

/** Target marker position as a fraction of the bar. Null when max is unset (wrap mode has no fixed marker). */
function targetMarkerFraction(entry: CurrentEntry): number | null {
  if (!entry.session) return null;
  const max = maxWearSeconds(entry.session);
  if (max === null || max <= 0) return null;
  return Math.min(targetWearSeconds(entry.session) / max, 1);
}

/** Completed laps this session (null-max categories only; 0 otherwise). */
function lapCountFor(entry: CurrentEntry): number {
  if (!entry.session) return 0;
  if (maxWearSeconds(entry.session) !== null) return 0;
  return lapCount(sessionSeconds(entry.session), targetWearSeconds(entry.session));
}
```

- [ ] **Step 4: Typecheck**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: No type errors (no remaining references to `wearProgress` /
`targetMarkerPercent`).

- [ ] **Step 5: Manually verify in the dev server**

Run: `cd src/frontend && npm run dev`, open the app, start a wear session on
a category with a max set (target marker still shows, bar behaves as
before), and confirm nothing visually regressed for that case (lap badge
should not appear).

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/components/ActionPane.vue
git commit -m "refactor(frontend): render the active-session bar via WearProgressBar"
```

---

### Task 6: E2E — lap badge and tier progression over real time

**Files:**
- Modify: `src/frontend/tests/e2e/wear.spec.ts`

**Interfaces:**
- Consumes: `data-testid="lap-badge"` and `data-testid="wear-progress-bar"`
  from Task 4; `POST /api/sessions/start`, `GET /api/sessions/current`,
  `POST /api/sessions/:id/end` (all pre-existing endpoints, used elsewhere in
  this file).

This test uses a category with a 2-second target and no max, so laps
complete quickly enough to assert on in real time without mocking the clock
(this codebase's e2e suite does not mock time elsewhere).

- [ ] **Step 1: Add the test**

Add to `src/frontend/tests/e2e/wear.spec.ts` (a new top-level `describe`,
alongside the existing `Wear sessions` and `Wear session conflict` blocks):

```ts
test.describe('Lap counter (null-max categories)', () => {
  let categoryId: number;
  let categoryName: string;
  let itemId: number;

  test.beforeAll(async ({ request }) => {
    categoryName = `LapCat-${uid()}`;
    const catRes = await request.post('/api/categories', {
      data: {
        name: categoryName,
        icon: '🔁',
        initial_target_wear_duration_seconds: 2,
        initial_max_wear_duration_seconds: null,
        rest_multiplier: 0,
        minimum_rest: 0,
        risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
        break_decay_multiplier: 0.91,
        break_grace_time: 86400,
      },
    });
    const cat = await catRes.json();
    categoryId = cat.id;

    const itemRes = await request.post('/api/items', {
      data: { name: `LapItem-${uid()}`, color: '#a855f7', category_id: categoryId },
    });
    const item = await itemRes.json();
    itemId = item.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/categories/${categoryId}`);
  });

  test('lap badge appears after the first lap and advances tiers over time', async ({ page, request }) => {
    await request.post('/api/sessions/start', { data: { item_id: itemId } });
    await page.goto('/');

    const row = page.locator('li', { hasText: categoryName });
    const badge = row.getByTestId('lap-badge');

    // target is 2s; badge is hidden until the first lap completes.
    await expect(badge).not.toBeVisible();
    await expect(badge).toHaveText('1x', { timeout: 4000 });
    await expect(badge).toHaveText('2x', { timeout: 4000 });
    await expect(row.getByTestId('wear-progress-bar')).toHaveClass(/tier-1/);

    const current = (await request
      .get('/api/sessions/current')
      .then((r) => r.json())) as Array<{ category: { id: number }; session: { id: number } | null }>;
    const entry = current.find((e) => e.category.id === categoryId);
    if (entry?.session) await request.post(`/api/sessions/${entry.session.id}/end`, { data: {} });
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `cd src/frontend && npx playwright test wear.spec.ts -g "Lap counter"`
Expected: PASS.

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd src/frontend && npm run test:ci && npx playwright test`
Expected: All unit and e2e tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/tests/e2e/wear.spec.ts
git commit -m "test(e2e): verify lap badge and tier progression over real time"
```
