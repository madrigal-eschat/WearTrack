# Active-Session Row Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-07-06-active-session-row-layout-design.md`:
rework `ActionPane.vue` rows (active and idle) into a consistent three-line
shape — title line, a state bar (row2), and a stats line (row3) — with new
overdue, resting, and decaying visual states.

**Architecture:** Depends on the lap-counter plan
(`docs/superpowers/plans/2026-07-06-lap-counter.md`), which must be
implemented first — it creates `WearProgressBar.vue` in wear-mode-only form.
This plan: (1) adds a `decay_full_time` derived value to the backend's
`computeDecay`, needed to render a decay countdown; (2) extends
`WearProgressBar.vue` with `rest` and `decay` modes; (3) restructures
`ActionPane.vue`'s row markup to use Konsta's `#title` slot (merging
category+item name, or category+picker, onto one line) and moves the bar and
stats into `#inner` as stacked rows.

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, Konsta UI, Vitest,
Playwright.

## Global Constraints

- Idle-row priority when multiple states could apply: **resting > decaying >
  default**.
- Rest bar: light grey (`#d1d5db`), fills left→right as rest elapses.
- Decay bar: near-black (`#111827`), starts full and un-fills from the left,
  carries a drop-shadow.
- No new DB columns/migrations — `decay_full_time` is derived, never stored.
- This plan assumes Task 1–6 of the lap-counter plan are complete
  (`WearProgressBar.vue` exists with `mode` defaulting to `'wear'`,
  `barFillFraction`/`targetMarkerFraction`/`lapCountFor` exist in
  `ActionPane.vue`).

---

### Task 1: Backend — `decay_full_time` in `computeDecay`

**Files:**
- Modify: `src/backend/src/db/calculations.ts:151-172`
- Modify: `src/backend/src/controllers/sessions.ts:71,76,87`
- Modify: `src/backend/tests/db/calculations.test.ts`

**Interfaces:**
- Produces: `computeDecay(...)` now also returns `decay_full_time: number | null`
  — the timestamp at which `decay_state` becomes `'fully_decayed'`. Consumed
  by Task 2 (frontend `CurrentEntry` type + decay helpers).

- [ ] **Step 1: Write the failing tests**

Add to `src/backend/tests/db/calculations.test.ts` (extend the existing
import to include `computeDecay`):

```ts
import {
  restWeight,
  riskLevelFor,
  computeSessionStart,
  computeRest,
  computeDecay,
  lapCount,
  type Category,
} from '../../src/db/calculations.js';
```

```ts
describe('computeDecay', () => {
  const decayCat = { break_grace_time: 100, break_decay_multiplier: 0.91, initial_target_wear_duration_seconds: 900 };

  it('returns none/null when there is no previous session', () => {
    expect(computeDecay(null, decayCat, 10000)).toEqual({
      decay_start_time: null,
      decay_state: 'none',
      decay_full_time: null,
    });
  });

  it('computes decay_start_time and decay_full_time from the previous session', () => {
    const previous = { ended_at: 0, rest_seconds: 50, target_wear_seconds: 900 };
    const r = computeDecay(previous, decayCat, 0);
    const decayStart = 0 + 50 + 100; // 150
    expect(r.decay_start_time).toBe(decayStart);
    // (900+900)*0.91^days <= 900  =>  days >= ln(0.5)/ln(0.91) ≈ 7.35  =>  8
    expect(r.decay_full_time).toBe(decayStart + 8 * 86400);
    expect(r.decay_state).toBe('none');
  });

  it('is "decaying" once past decay_start_time but before decay_full_time', () => {
    const previous = { ended_at: 0, rest_seconds: 50, target_wear_seconds: 900 };
    const decayStart = 150;
    const r = computeDecay(previous, decayCat, decayStart + 86400); // 1 day into decay
    expect(r.decay_state).toBe('decaying');
  });

  it('is "fully_decayed" at decay_full_time', () => {
    const previous = { ended_at: 0, rest_seconds: 50, target_wear_seconds: 900 };
    const decayStart = 150;
    const r = computeDecay(previous, decayCat, decayStart + 8 * 86400);
    expect(r.decay_state).toBe('fully_decayed');
    expect(r.decay_full_time).toBe(decayStart + 8 * 86400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/backend && npm test -- calculations.test.ts`
Expected: FAIL — `decay_full_time` is not returned yet.

- [ ] **Step 3: Implement `decay_full_time`**

In `src/backend/src/db/calculations.ts`, replace `computeDecay`:

```ts
export function computeDecay(
  previous: { ended_at: number; rest_seconds: number; target_wear_seconds: number } | null,
  category: { break_grace_time: number; break_decay_multiplier: number; initial_target_wear_duration_seconds: number },
  now: number,
): { decay_start_time: number | null; decay_state: DecayState; decay_full_time: number | null } {
  if (!previous) return { decay_start_time: null, decay_state: 'none', decay_full_time: null };

  const decayStartTime = previous.ended_at + previous.rest_seconds + category.break_grace_time;
  const initial = category.initial_target_wear_duration_seconds;
  const daysToFull = daysUntilFullyDecayed(previous.target_wear_seconds, initial, category.break_decay_multiplier);
  const decayFullTime = decayStartTime + daysToFull * 86400;

  if (now <= decayStartTime) {
    return { decay_start_time: decayStartTime, decay_state: 'none', decay_full_time: decayFullTime };
  }

  const daysSinceGrace = Math.floor((now - decayStartTime) / 86400);
  const decayFactor = category.break_decay_multiplier ** daysSinceGrace;
  const decayed = (previous.target_wear_seconds + initial) * decayFactor;

  const decay_state: DecayState = decayed <= initial ? 'fully_decayed' : 'decaying';
  return { decay_start_time: decayStartTime, decay_state, decay_full_time: decayFullTime };
}

/** Full days of decay until (previousTarget + initial) * multiplier^days <= initial. */
function daysUntilFullyDecayed(previousTarget: number, initial: number, multiplier: number): number {
  if (previousTarget <= 0 || multiplier <= 0 || multiplier >= 1) return 0;
  const days = Math.log(initial / (previousTarget + initial)) / Math.log(multiplier);
  return Math.max(0, Math.ceil(days));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/backend && npm test -- calculations.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Thread `decay_full_time` through the `/api/sessions/current` response**

In `src/backend/src/controllers/sessions.ts`, change:

```ts
      const { decay_start_time, decay_state } = computeDecay(previous, cat, now);

      const items = enrichItemsWithExpected(itemsByCategory.get(cat.id) ?? [], cat, previous, now, injuryActive);

      const s = sessionByCategory.get(cat.id);
      if (!s) return { category: cat, item: null, session: null, items, decay_start_time, decay_state };
```

to:

```ts
      const { decay_start_time, decay_state, decay_full_time } = computeDecay(previous, cat, now);

      const items = enrichItemsWithExpected(itemsByCategory.get(cat.id) ?? [], cat, previous, now, injuryActive);

      const s = sessionByCategory.get(cat.id);
      if (!s) return { category: cat, item: null, session: null, items, decay_start_time, decay_state, decay_full_time };
```

and change the final `return` a few lines down:

```ts
      return { category: cat, item, session, items, decay_start_time, decay_state };
```

to:

```ts
      return { category: cat, item, session, items, decay_start_time, decay_state, decay_full_time };
```

- [ ] **Step 6: Manually verify the API response**

Run: `cd src/backend && npm run dev` (or however the backend runs in this
repo), then `curl localhost:<port>/api/sessions/current` and confirm each
entry now includes a `decay_full_time` field (a number or `null`).

- [ ] **Step 7: Commit**

```bash
git add src/backend/src/db/calculations.ts src/backend/src/controllers/sessions.ts src/backend/tests/db/calculations.test.ts
git commit -m "feat(backend): add decay_full_time to computeDecay"
```

---

### Task 2: Frontend — decay/rest helpers and `CurrentEntry.decay_full_time`

**Files:**
- Modify: `src/frontend/src/composables/useWear.ts:52-59`
- Modify: `src/frontend/src/utils/wearCalculations.ts`
- Modify: `src/frontend/src/utils/wearCalculations.test.ts`

**Interfaces:**
- Consumes: `decay_full_time` from the API (Task 1).
- Produces: `CurrentEntry.decay_full_time: number | null`;
  `fillUpFraction(remaining: number, total: number): number`;
  `decayFillFraction(now: number, decayStartTime: number, decayFullTime: number): number`;
  `decayTimeLeft(now: number, decayFullTime: number): number`. Consumed by
  Task 4/5 (`ActionPane.vue`).

- [ ] **Step 1: Add `decay_full_time` to `CurrentEntry`**

In `src/frontend/src/composables/useWear.ts`, change:

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
}
```

- [ ] **Step 2: Write the failing tests**

Add to `src/frontend/src/utils/wearCalculations.test.ts` (extend the top
import to add `fillUpFraction`, `decayFillFraction`, `decayTimeLeft`):

```ts
describe('fillUpFraction', () => {
  it('is 0 when no time has elapsed (remaining === total)', () => {
    expect(fillUpFraction(100, 100)).toBeCloseTo(0);
  });

  it('is 1 once remaining reaches 0', () => {
    expect(fillUpFraction(0, 100)).toBe(1);
  });

  it('interpolates between the two', () => {
    expect(fillUpFraction(25, 100)).toBeCloseTo(0.75);
  });
});

describe('decayFillFraction', () => {
  it('is full (1) right at decay_start_time', () => {
    expect(decayFillFraction(1000, 1000, 2000)).toBeCloseTo(1);
  });

  it('is empty (0) at decay_full_time', () => {
    expect(decayFillFraction(2000, 1000, 2000)).toBeCloseTo(0);
  });

  it('un-fills linearly between the two', () => {
    expect(decayFillFraction(1500, 1000, 2000)).toBeCloseTo(0.5);
  });

  it('clamps to 0 past decay_full_time', () => {
    expect(decayFillFraction(3000, 1000, 2000)).toBe(0);
  });
});

describe('decayTimeLeft', () => {
  it('counts down to decay_full_time', () => {
    expect(decayTimeLeft(1500, 2000)).toBe(500);
  });

  it('floors at 0 past decay_full_time', () => {
    expect(decayTimeLeft(2500, 2000)).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src/frontend && npx vitest run wearCalculations.test.ts`
Expected: FAIL — the three functions are not exported yet.

- [ ] **Step 4: Implement the helpers**

Add to `src/frontend/src/utils/wearCalculations.ts`:

```ts
/** Generic fill-up fraction (0-1) for a countdown: 1 - remaining/total, clamped. */
export function fillUpFraction(remaining: number, total: number): number {
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1 - remaining / total, 1));
}

/** Decay bar fill fraction (0-1): starts full at decay_start_time, empties to 0 by decay_full_time. */
export function decayFillFraction(now: number, decayStartTime: number, decayFullTime: number): number {
  const window = decayFullTime - decayStartTime;
  if (window <= 0) return 0;
  const remaining = decayFullTime - now;
  return Math.max(0, Math.min(remaining / window, 1));
}

/** Seconds remaining until fully decayed; 0 once past decay_full_time. */
export function decayTimeLeft(now: number, decayFullTime: number): number {
  return Math.max(0, decayFullTime - now);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src/frontend && npx vitest run wearCalculations.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/composables/useWear.ts src/frontend/src/utils/wearCalculations.ts src/frontend/src/utils/wearCalculations.test.ts
git commit -m "feat(frontend): add rest/decay fill-fraction helpers and decay_full_time type"
```

---

### Task 3: Frontend — `rest`/`decay` modes on `WearProgressBar.vue`

**Files:**
- Modify: `src/frontend/src/components/WearProgressBar.vue`

**Interfaces:**
- Produces: `WearProgressBar` now accepts `mode?: 'wear' | 'rest' | 'decay'`
  (default `'wear'`). In `rest`/`decay` modes, `color`, `targetMarkerFraction`,
  and `lapCount` are ignored (no glow/sparkle/badge/marker — those are
  wear-only). Consumed by Task 5 (idle row2 rest/decay bars).

- [ ] **Step 1: Update the component**

Replace the `<script setup>` block of
`src/frontend/src/components/WearProgressBar.vue`:

```ts
<script setup lang="ts">
import { computed } from 'vue';
import { lapTier } from '../utils/wearCalculations.js';

const props = withDefaults(
  defineProps<{
    mode?: 'wear' | 'rest' | 'decay';
    fillFraction: number;
    color?: string;
    targetMarkerFraction?: number | null;
    lapCount?: number;
  }>(),
  {
    mode: 'wear',
    color: '#000000',
    targetMarkerFraction: null,
    lapCount: 0,
  },
);

const barColor = computed(() => {
  if (props.mode === 'rest') return '#d1d5db';
  if (props.mode === 'decay') return '#111827';
  return props.color;
});

const tier = computed(() => (props.mode === 'wear' ? lapTier(props.lapCount) : 0));

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
```

Replace the `<template>` block:

```vue
<template>
  <div class="wear-progress" :class="`tier-${tier}`" :style="{ '--glow-color': barColor }" data-testid="wear-progress-bar">
    <span v-if="mode === 'wear' && lapCount >= 1" class="lap-badge" data-testid="lap-badge">{{ lapCount }}x</span>
    <div class="bar-wrap">
      <div
        class="bar-fill"
        :class="{ 'decay-shadow': mode === 'decay' }"
        :style="{ width: fillFraction * 100 + '%', background: barColor }"
      ></div>
      <div
        v-if="mode === 'wear' && targetMarkerFraction !== null"
        class="target-marker"
        data-testid="target-marker"
        :style="{ left: targetMarkerFraction * 100 + '%' }"
      ></div>
      <div v-if="mode === 'wear' && tier >= 2" class="sparkle-field">
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
```

Add to the `<style scoped>` block (append, don't remove anything existing):

```css
.decay-shadow {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 3: Manually verify wear mode still works**

Run: `cd src/frontend && npm run dev`, start a wear session, confirm the bar
still renders/fills/animates exactly as before this change (mode defaults to
`'wear'`, nothing about that path changed in effect).

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/components/WearProgressBar.vue
git commit -m "feat(frontend): add rest and decay modes to WearProgressBar"
```

---

### Task 4: Frontend — active-session row: merged title line + full-width bar + wrapped stats

**Files:**
- Modify: `src/frontend/src/components/ActionPane.vue`

**Interfaces:**
- Consumes: `WearProgressBar` (mode defaults to `'wear'`, unaffected by this
  task), `barFillFraction`/`targetMarkerFraction`/`lapCountFor` (already in
  `ActionPane.vue` from the lap-counter plan).
- Produces: `remainingLabel` now returns `'Overdue'` instead of `'Stop
  wearing'` (the CTA text moves to its own line — see below). No other
  function signatures change.

- [ ] **Step 1: Replace the `k-list-item` opening tag and its title binding**

Change:

```html
      <k-list-item
        v-for="entry in currentSessions"
        :key="entry.category.id"
        :title="entry.category.name"
        :subtitle="subtitle(entry)"
        :class="rowBg(entry)"
      >
```

to:

```html
      <k-list-item
        v-for="entry in currentSessions"
        :key="entry.category.id"
        :title="entry.category.name"
        :class="rowBg(entry)"
      >
        <template #title>
          <span v-if="entry.session && entry.item" class="ml-1.5 text-sm font-normal text-gray-500">{{ entry.item.name }}</span>
        </template>
```

(The `:title` prop keeps Konsta's default category-name styling; the
`#title` slot appends the item name — Konsta's `ListItem` renders the prop
text and the slot content together in the same title element, so this
produces one line: `<Category name> <item name>`.)

- [ ] **Step 2: Add the overdue CTA and move stats under the bar in the `#inner` active-session branch**

By this point (after the lap-counter plan), the `#inner` active-session
branch looks like this:

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

Change it to:

```html
        <template v-if="entry.session && entry.item" #inner>
          <div v-if="isOverdue(entry)" class="text-red-600 text-sm font-semibold mt-0.5">Stop wearing</div>
          <WearProgressBar
            class="mt-1"
            :fill-fraction="barFillFraction(entry)"
            :color="entry.item.color"
            :target-marker-fraction="targetMarkerFraction(entry)"
            :lap-count="lapCountFor(entry)"
          />
          <div class="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm tabular-nums">
            <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Worn</span>{{ elapsed(entry.session) }}</span>
            <span :class="isOverdue(entry) ? 'text-red-600 font-semibold' : 'text-gray-600'"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Remaining</span>{{ remainingLabel(entry) }}</span>
            <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ targetLabel(entry) }}</span>
            <span v-if="entry.session.max_wear_seconds !== null" class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ maxWear(entry) }}</span>
          </div>
        </template>
```

The `barFillFraction`/`targetMarkerFraction`/`lapCountFor` functions and the
`WearProgressBar` import already exist from the lap-counter plan — no
`<script setup>` import changes needed here.

- [ ] **Step 3: Replace the `#after` template's active-session branch**

Change the opening of the `#after` template (the part inside
`<template v-if="entry.session !== null">`, keep everything from
`<k-button small outline @click="onStop(entry)">Stop</k-button>` as-is, but
remove the now-redundant stats block above it):

```html
            <template v-if="entry.session !== null">
              <div class="text-right tabular-nums leading-snug whitespace-nowrap">
                <div class="flex gap-3 justify-end">
                  <span class="text-sm text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Worn</span>{{ elapsed(entry.session) }}</span>
                  <span class="text-sm" :class="isOverdue(entry) ? 'text-red-600 font-semibold' : 'text-gray-600'"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Remaining</span>{{ remainingLabel(entry) }}</span>
                </div>
                <div class="flex gap-3 justify-end mt-0.5">
                  <span class="text-sm text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ targetLabel(entry) }}</span>
                  <span v-if="entry.session.max_wear_seconds !== null" class="text-sm text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ maxWear(entry) }}</span>
                </div>
              </div>
              <k-button
                small
                outline
                @click="onStop(entry)"
              >Stop</k-button>
            </template>
```

to:

```html
            <template v-if="entry.session !== null">
              <k-button
                small
                outline
                @click="onStop(entry)"
              >Stop</k-button>
            </template>
```

- [ ] **Step 4: Narrow `isOverdue` to max-set categories, and split "Overdue" from "Target reached"**

Null-max (lap-counter) categories reaching target are not overdue — the
lap mechanic means "keep going, you're lapping," not "stop now." Only a
category with a max set, past that max, is actually overdue.

Change:

```ts
function isOverdue(entry: CurrentEntry): boolean {
  if (!entry.session) return false;
  return remainingSecondsFor(entry.session) === null;
}
```

to:

```ts
function isOverdue(entry: CurrentEntry): boolean {
  if (!entry.session) return false;
  const max = maxWearSeconds(entry.session);
  if (max === null) return false;
  return sessionSeconds(entry.session) >= max;
}
```

Change:

```ts
function remainingLabel(entry: CurrentEntry): string {
  if (!entry.session) return '';
  const remaining = remainingSecondsFor(entry.session);
  return remaining === null ? 'Stop wearing' : formatDuration(remaining);
}
```

to:

```ts
function remainingLabel(entry: CurrentEntry): string {
  if (!entry.session) return '';
  const remaining = remainingSecondsFor(entry.session);
  if (remaining !== null) return formatDuration(remaining);
  return maxWearSeconds(entry.session) === null ? 'Target reached' : 'Overdue';
}
```

This changes what the `#inner` stats line and CTA (from Step 2) render for
null-max categories once target is passed: `isOverdue(entry)` is now
`false` there, so the red "Stop wearing" CTA and red styling do not appear
— only the neutral `remainingLabel` value changes to "Target reached". No
further edits needed to Step 2's or Step 3's markup; both already key off
`isOverdue(entry)` and `remainingLabel(entry)`, which now carry the
corrected meaning.

- [ ] **Step 5: Remove the now-unused `subtitle` function**

Delete:

```ts
function subtitle(entry: CurrentEntry): string {
  if (entry.session !== null && entry.item !== null) {
    return entry.item.name;
  }
  return 'Idle';
}
```

- [ ] **Step 6: Typecheck**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: No type errors (confirms `subtitle` had no other callers).

- [ ] **Step 7: Manually verify**

Run: `cd src/frontend && npm run dev`. Start a session on a category with a
max set: confirm one title line reads "`<Category>` `<item>`", the bar is
full-width below it, and Worn/Remaining/Target/Max sit on one wrapping line
below the bar, with Stop button trailing the title line. Let that session go
past its max (or use a category with a tiny max) and confirm "Stop wearing"
appears under the title and "Remaining" reads "Overdue" in red. Separately,
start a session on a null-max category and let it pass target: confirm no
"Stop wearing" CTA appears and "Remaining" reads "Target reached" (not red).

- [ ] **Step 8: Commit**

```bash
git add src/frontend/src/components/ActionPane.vue
git commit -m "refactor(frontend): merge active-session title line and move stats under the bar"
```

---

### Task 5: Frontend — idle row: merged title line + resting/decaying/default row2 + stats swap

**Files:**
- Modify: `src/frontend/src/components/ActionPane.vue`

**Interfaces:**
- Consumes: `WearProgressBar` with `mode="rest"`/`mode="decay"` (Task 3),
  `fillUpFraction`/`decayFillFraction`/`decayTimeLeft` (Task 2),
  `CurrentEntry.decay_full_time` (Task 2).
- Produces: `restTotalSeconds(entry)`, `restFillFraction(entry)`,
  `decayFillFractionFor(entry)`, `decayTimeLeftLabel(entry)` — local to
  `ActionPane.vue`.

- [ ] **Step 1: Update imports**

Add `fillUpFraction`, `decayFillFraction`, `decayTimeLeft` to the existing
`wearCalculations.js` import in `ActionPane.vue`:

```ts
import { targetWearSeconds, maxWearSeconds, currentWear, remainingWearSeconds, lapCount, lapFillFraction, fillUpFraction, decayFillFraction, decayTimeLeft } from '../utils/wearCalculations.js';
```

- [ ] **Step 2: Replace the `#after` template's idle-item-picker markup**

The idle branch's `#after` content currently mixes the item picker, target/max
display, decay warnings, and the rest indicator into one nested block. Change
the whole `<template v-else>` branch of `#after` (everything from
`<template v-else>` through its matching `</template>`, i.e. today's
idle-branch content):

```html
            <!-- No session: show item picker + Wear button, with target/max tucked below on small screens -->
            <template v-else>
              <div class="flex flex-col items-end gap-1">
              <div class="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                <!-- controls — first on mobile, second on wide (sm:order-2) -->
                <div class="flex gap-2 items-center sm:order-2">
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
                    :class="{ 'opacity-60': restRemainingSeconds(entry) > 0 }"
                    @click="restRemainingSeconds(entry) > 0 ? showRestWarning(entry) : onWear(entry)"
                  >Wear</k-button>
                </div>
                <!-- target/max — second on mobile (below), first on wide (sm:order-1) -->
                <div v-if="selectedItemData(entry)" class="text-right tabular-nums leading-snug whitespace-nowrap sm:order-1">
                  <div class="text-xs text-gray-600 sm:text-sm">
                    <span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ idleTarget(entry) }}
                    <template v-if="idleMax(entry)">
                      <span class="mx-1 text-gray-300 sm:hidden">·</span>
                      <span class="hidden sm:inline mx-1 text-gray-300">/</span>
                      <span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ idleMax(entry) }}
                    </template>
                  </div>
                </div>
                <!-- Decay info: "Start before" date + warning badge (category-level, always visible) -->
                <template v-if="entry.decay_start_time !== null">
                  <div class="text-right text-xs text-gray-500 mt-0.5 whitespace-nowrap sm:order-1">
                    <span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Start before</span>{{ formatDecayDate(entry.decay_start_time) }}
                  </div>
                  <div v-if="entry.decay_state === 'decaying'" class="text-right text-xs text-orange-500 mt-0.5 sm:order-1">
                    <Icon icon="ph:warning" class="inline w-3 h-3 mr-0.5" />Durations are decaying
                  </div>
                  <div v-else-if="entry.decay_state === 'fully_decayed'" class="text-right text-xs text-red-500 mt-0.5 sm:order-1">
                    <Icon icon="ph:warning-circle" class="inline w-3 h-3 mr-0.5" />Target and max have returned to initial values
                  </div>
                </template>
              </div>
              <div v-if="restRemainingSeconds(entry) > 0" class="text-xs text-amber-600">
                <Icon icon="ph:bed" class="inline w-3 h-3 mr-0.5" />Rest {{ shortDuration(restRemainingSeconds(entry)) }} more
              </div>
              </div>
            </template>
```

to:

```html
            <!-- No session: show item picker + Wear button -->
            <template v-else>
              <div class="flex gap-2 items-center">
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
                  :class="{ 'opacity-60': restRemainingSeconds(entry) > 0 }"
                  @click="restRemainingSeconds(entry) > 0 ? showRestWarning(entry) : onWear(entry)"
                >Wear</k-button>
              </div>
            </template>
```

- [ ] **Step 3: Add the idle branch to `#inner`**

The `#inner` template today only has a `v-if="entry.session && entry.item"`
branch (replaced in Task 4). Add an `else` branch alongside it for the idle
row2/row3 content:

```html
        <template #inner>
          <template v-if="entry.session && entry.item">
            <!-- (unchanged from Task 4) -->
            <div v-if="isOverdue(entry)" class="text-red-600 text-sm font-semibold mt-0.5">Stop wearing</div>
            <WearProgressBar
              class="mt-1"
              :fill-fraction="barFillFraction(entry)"
              :color="entry.item.color"
              :target-marker-fraction="targetMarkerFraction(entry)"
              :lap-count="lapCountFor(entry)"
            />
            <div class="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm tabular-nums">
              <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Worn</span>{{ elapsed(entry.session) }}</span>
              <span :class="isOverdue(entry) ? 'text-red-600 font-semibold' : 'text-gray-600'"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Remaining</span>{{ remainingLabel(entry) }}</span>
              <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ targetLabel(entry) }}</span>
              <span v-if="entry.session.max_wear_seconds !== null" class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ maxWear(entry) }}</span>
            </div>
          </template>
          <template v-else>
            <!-- Row2: resting > decaying > default -->
            <template v-if="restRemainingSeconds(entry) > 0">
              <div class="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Icon icon="ph:bed" class="w-3.5 h-3.5" />Rest
              </div>
              <WearProgressBar mode="rest" :fill-fraction="restFillFraction(entry)" />
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
            <div v-if="restRemainingSeconds(entry) > 0" class="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm tabular-nums">
              <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Remaining</span>{{ shortDuration(restRemainingSeconds(entry)) }}</span>
              <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Total</span>{{ shortDuration(restTotalSeconds(entry)) }}</span>
            </div>
            <div v-else-if="selectedItemData(entry)" class="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm tabular-nums">
              <span class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ idleTarget(entry) }}</span>
              <span v-if="idleMax(entry)" class="text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ idleMax(entry) }}</span>
            </div>
          </template>
        </template>
```

- [ ] **Step 4: Add the new helper functions**

Add near `restRemainingSeconds` in the `<script setup>` block:

```ts
function restTotalSeconds(entry: CurrentEntry): number {
  const item = selectedItemData(entry);
  return item?.rest_seconds ?? 0;
}

function restFillFraction(entry: CurrentEntry): number {
  return fillUpFraction(restRemainingSeconds(entry), restTotalSeconds(entry));
}

function decayFillFractionFor(entry: CurrentEntry): number {
  if (entry.decay_start_time === null || entry.decay_full_time === null) return 0;
  return decayFillFraction(Math.floor(now.value / 1000), entry.decay_start_time, entry.decay_full_time);
}

function decayTimeLeftLabel(entry: CurrentEntry): string {
  if (entry.decay_full_time === null) return '';
  return shortDuration(decayTimeLeft(Math.floor(now.value / 1000), entry.decay_full_time));
}
```

- [ ] **Step 5: Typecheck**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Manually verify all three idle states**

Run: `cd src/frontend && npm run dev`.
- Fresh category, no previous session: row2 reads "Start your first session".
- End a session, reload: row2 reads "Start before `<date>`" (default state,
  before the rest/grace window elapses).
- Use a category with a short `minimum_rest` so you can wait it out and
  observe the grey rest bar with Remaining/Total stats while resting.

- [ ] **Step 7: Commit**

```bash
git add src/frontend/src/components/ActionPane.vue
git commit -m "refactor(frontend): unify idle row layout with resting/decaying/default states"
```

---

### Task 6: E2E — verify the restructured rows

**Files:**
- Modify: `src/frontend/tests/e2e/wear.spec.ts`

**Interfaces:**
- Consumes: `POST /api/sessions/start` and `POST /api/sessions/:id/end`
  accept explicit `started_at`/`ended_at` timestamps (pre-existing — see
  `src/backend/src/controllers/sessions.ts:113-159`), used here to engineer
  rest/decay states deterministically instead of waiting on real time.

- [ ] **Step 1: Add a resting-state test**

Add to `src/frontend/tests/e2e/wear.spec.ts`:

```ts
test.describe('Idle row states', () => {
  let categoryId: number;
  let categoryName: string;
  let itemId: number;

  test.beforeAll(async ({ request }) => {
    categoryName = `IdleCat-${uid()}`;
    const catRes = await request.post('/api/categories', {
      data: {
        name: categoryName,
        icon: '🧦',
        initial_target_wear_duration_seconds: 600,
        initial_max_wear_duration_seconds: 900,
        rest_multiplier: 2,
        minimum_rest: 30,
        risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
        break_decay_multiplier: 0.5,
        break_grace_time: 1,
      },
    });
    const cat = await catRes.json();
    categoryId = cat.id;

    const itemRes = await request.post('/api/items', {
      data: { name: `IdleItem-${uid()}`, color: '#22c55e', category_id: categoryId },
    });
    itemId = (await itemRes.json()).id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/categories/${categoryId}`);
  });

  test('shows the resting bar and Remaining/Total stats while resting', async ({ page, request }) => {
    const now = Math.floor(Date.now() / 1000);
    const startRes = await request.post('/api/sessions/start', {
      data: { item_id: itemId, started_at: now - 10 },
    });
    const session = await startRes.json();
    // minimum_rest is 30s — end quickly so most of the rest window is still ahead.
    await request.post(`/api/sessions/${session.id}/end`, { data: { ended_at: now - 5 } });

    await page.goto('/');
    const row = page.locator('li', { hasText: categoryName });
    await expect(row.getByText('Rest')).toBeVisible();
    await expect(row.getByText(/Remaining/)).toBeVisible();
    await expect(row.getByText(/Total/)).toBeVisible();
  });

  test('shows "Total decay in" once the decay window has started', async ({ page, request }) => {
    // ended long enough ago that rest (small) + grace (1s) has passed, but not
    // long enough to be fully decayed (break_decay_multiplier 0.5 halves per day).
    const now = Math.floor(Date.now() / 1000);
    const startRes = await request.post('/api/sessions/start', {
      data: { item_id: itemId, started_at: now - 3600 - 30 },
    });
    const session = await startRes.json();
    await request.post(`/api/sessions/${session.id}/end`, { data: { ended_at: now - 3600 } });

    await page.goto('/');
    const row = page.locator('li', { hasText: categoryName });
    await expect(row.getByText(/Total decay in/)).toBeVisible();
  });

  test('shows "Start your first session" for a category with no previous session', async ({ page, request }) => {
    const freshCatRes = await request.post('/api/categories', {
      data: {
        name: `FreshCat-${uid()}`,
        icon: '🆕',
        initial_target_wear_duration_seconds: 600,
        initial_max_wear_duration_seconds: 900,
        rest_multiplier: 2,
        minimum_rest: 30,
        risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 1 }],
        break_decay_multiplier: 0.91,
        break_grace_time: 86400,
      },
    });
    const freshCat = await freshCatRes.json();
    await request.post('/api/items', {
      data: { name: `FreshItem-${uid()}`, color: '#0ea5e9', category_id: freshCat.id },
    });

    await page.goto('/');
    const row = page.locator('li', { hasText: freshCat.name });
    await expect(row.getByText('Start your first session')).toBeVisible();

    await request.delete(`/api/categories/${freshCat.id}`);
  });
});
```

- [ ] **Step 2: Add an overdue-state test to the existing `Wear sessions` describe block**

Add alongside the existing `active session shows a target marker on the bar`
test. `POST /api/sessions/start` accepts an explicit `started_at`, so the
session can be created already-overdue instead of waiting out the real
target/max (`PATCH /api/sessions/:id` isn't usable here — it only corrects
**completed** sessions; see `src/backend/src/controllers/sessions.ts:162-183`
— `if (session.ended_at === null) throw new ValidationError(...)`, and this
session is still open):

```ts
  test('overdue session shows "Stop wearing" and an Overdue stat', async ({ page, request }) => {
    // Stop any session left open by other tests in this category first.
    const stopBtn = page.getByRole('button', { name: /stop/i }).first();
    if (await stopBtn.isVisible({ timeout: 1500 }).catch(() => false)) await stopBtn.click();

    const itemsRes = await request.get(`/api/items?category_id=${categoryId}`);
    const [item] = await itemsRes.json();
    const now = Math.floor(Date.now() / 1000);
    await request.post('/api/sessions/start', { data: { item_id: item.id, started_at: now - 1000 } });

    await page.goto('/');
    await expect(page.getByText('Stop wearing')).toBeVisible();
    await expect(page.getByText('Overdue')).toBeVisible();

    await page.getByRole('button', { name: /stop/i }).first().click();
  });
```

Add one more test to the same file confirming null-max categories get the
neutral "Target reached" treatment instead — this is the fix from Task 4
Step 4 (`isOverdue` is `false` for null-max categories, so no red styling or
CTA):

```ts
test.describe('Target reached (null-max, no overdue CTA)', () => {
  let categoryId: number;
  let categoryName: string;
  let itemId: number;

  test.beforeAll(async ({ request }) => {
    categoryName = `TargetReachedCat-${uid()}`;
    const catRes = await request.post('/api/categories', {
      data: {
        name: categoryName,
        icon: '🎯',
        initial_target_wear_duration_seconds: 100,
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
      data: { name: `TargetReachedItem-${uid()}`, color: '#f97316', category_id: categoryId },
    });
    itemId = (await itemRes.json()).id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/categories/${categoryId}`);
  });

  test('shows "Target reached" (not "Overdue"/"Stop wearing") once target passes', async ({ page, request }) => {
    const now = Math.floor(Date.now() / 1000);
    await request.post('/api/sessions/start', { data: { item_id: itemId, started_at: now - 150 } });

    await page.goto('/');
    const row = page.locator('li', { hasText: categoryName });
    await expect(row.getByText('Target reached')).toBeVisible();
    await expect(row.getByText('Stop wearing')).not.toBeVisible();
    await expect(row.getByText('Overdue')).not.toBeVisible();

    await row.getByRole('button', { name: /stop/i }).click();
  });
});
```

- [ ] **Step 3: Run the e2e tests**

Run: `cd src/frontend && npx playwright test wear.spec.ts`
Expected: All tests in the file PASS, including the new ones.

- [ ] **Step 4: Run the full test suite**

Run: `cd src/frontend && npm run test:ci && npx playwright test`
Expected: All unit and e2e tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/tests/e2e/wear.spec.ts
git commit -m "test(e2e): verify overdue, resting, decaying, and first-session row states"
```
