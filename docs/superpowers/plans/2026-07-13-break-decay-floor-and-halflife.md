# Break Decay Floor + Half-Life UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change break decay so each day's loss amount (not just the final result) is floored at the category's initial target/max, and let users configure decay speed via a half-life (days) instead of a raw multiplier.

**Architecture:** Backend (`calculations.ts`) switches from a closed-form `multiplier ** days` exponentiation to a day-by-day loop where each day's loss is `max(loss_fraction * current, floor)`. Frontend gains no new stored field — `break_decay_multiplier` is still what's persisted — but the category form now shows/edits a derived half-life, converted to/from the multiplier at the form boundary.

**Tech Stack:** TypeScript, Vitest (both backend and frontend), Vue 3 `<script setup>`.

## Global Constraints

- No DB schema/migration changes — `break_decay_multiplier` storage is unchanged.
- No change to `break_grace_time`, injury halving, rest calculation, or risk levels.
- Spec: `docs/superpowers/specs/2026-07-13-break-decay-floor-and-halflife-design.md`

---

### Task 1: Backend — floored day-by-day decay in `computeSessionStart`

**Files:**
- Modify: `src/backend/src/db/calculations.ts:77-124` (`applyBreakDecay`, `rawDurations`)
- Test: `src/backend/tests/db/calculations.test.ts`

**Interfaces:**
- Consumes: nothing new — operates on `Category`/`PreviousSession` already defined in `calculations.ts`.
- Produces: `applyBreakDecay(target, max, daysSinceGrace, decayMultiplier, floorTarget, floorMax)` — signature gains two new required params (`floorTarget: number`, `floorMax: number | null`), used by `rawDurations` and, in Task 2, shares its per-day step logic with `daysUntilFullyDecayed`/`computeDecay` via a new helper `decayOneDay`.

- [ ] **Step 1: Write the failing tests for the new floored decay behavior**

Replace the existing decay test in `src/backend/tests/db/calculations.test.ts` (the `it('past grace applies daily decay', ...)` block inside `describe('computeSessionStart', ...)`, currently around lines 76-83) with:

```typescript
  it('past grace applies floored daily decay', () => {
    const prev = { target_wear_seconds: 900, max_wear_seconds: 1800, ended_at: 0, started_at: -100, rest_seconds: 0 };
    // latest_start = 0 + 0 + 86400. Start 2 days past latest_start => days_since_grace = 2
    const start = 86400 + 2 * 86400;
    const r = computeSessionStart(cat, item, prev, start, false);
    // grown target=1800, max=3600 (dm=1 * (prev + initial)). Each day's loss is
    // floored at initial (900/1800), so both reach the floor on day 1 already:
    // day1: target loss = max(0.09*1800, 900) = 900 -> target 900
    // day1: max loss    = max(0.09*3600, 1800) = 1800 -> max 1800
    expect(r.target).toBe(900);
    expect(r.max).toBe(1800);
  });
```

Then add a new describe block right after the `computeSessionStart` describe block (after its closing `});` around line 103):

```typescript
describe('computeSessionStart — floored break decay reaches floor in bounded days', () => {
  const noMaxCat: Category = { ...cat, initial_max_wear_duration_seconds: null };

  it('matches the day-by-day worked example (5000 -> 900 over 5 days)', () => {
    const prev = { target_wear_seconds: 4100, max_wear_seconds: null, ended_at: 0, started_at: -100, rest_seconds: 0 };
    const start = 86400 + 5 * 86400; // 5 days past grace
    const r = computeSessionStart(noMaxCat, item, prev, start, false);
    // grown target = 1 * (4100 + 900) = 5000
    // day1: loss=max(450,900)=900 -> 4100
    // day2: loss=max(369,900)=900 -> 3200
    // day3: loss=max(288,900)=900 -> 2300
    // day4: loss=max(207,900)=900 -> 1400
    // day5: loss=max(126,900)=900 -> 900 (floor)
    expect(r.target).toBe(900);
  });

  it('never overshoots below the floor for very long gaps', () => {
    const prev = { target_wear_seconds: 4100, max_wear_seconds: null, ended_at: 0, started_at: -100, rest_seconds: 0 };
    const start = 86400 + 1000 * 86400; // 1000 days past grace
    const r = computeSessionStart(noMaxCat, item, prev, start, false);
    expect(r.target).toBe(900);
  });

  it('applies the same floored decay to max independently, for categories with a maximum', () => {
    const prev = { target_wear_seconds: 4100, max_wear_seconds: 8200, ended_at: 0, started_at: -100, rest_seconds: 0 };
    const start = 86400 + 5 * 86400;
    const r = computeSessionStart(cat, item, prev, start, false);
    // grown target = 4100+900 = 5000 -> floors to 900 by day 5 (see worked example above)
    // grown max = 8200+1800 = 10000 -> day1:8200 day2:6400 day3:4600 day4:2800 day5: floor 1800
    expect(r.target).toBe(900);
    expect(r.max).toBe(1800);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix src/backend test -- calculations.test.ts`
Expected: FAIL — `'past grace applies floored daily decay'` gets the old exponential value (1490-ish) instead of 900; the new describe block's tests fail similarly.

- [ ] **Step 3: Rewrite `applyBreakDecay` and its call site**

In `src/backend/src/db/calculations.ts`, replace the existing `applyBreakDecay` function (lines 77-86):

```typescript
/** One day's floored decay step: loses at least `floor` even if the percentage loss would be smaller. */
function decayOneDay(value: number, floor: number, lossFraction: number): number {
  const loss = Math.max(lossFraction * value, floor);
  return Math.max(value - loss, floor);
}

/** `value` decayed by `days` floored daily steps (see `decayOneDay`). */
function decayValue(value: number, floor: number, lossFraction: number, days: number): number {
  let v = value;
  for (let day = 0; day < days; day++) v = decayOneDay(v, floor, lossFraction);
  return v;
}

/** Day-by-day decay past grace: each day's loss is at least `floorTarget`/`floorMax`, so the value reaches the floor in a bounded number of days instead of trailing off asymptotically. */
function applyBreakDecay(
  target: number,
  max: number | null,
  daysSinceGrace: number,
  decayMultiplier: number,
  floorTarget: number,
  floorMax: number | null,
): { target: number; max: number | null } {
  const lossFraction = 1 - decayMultiplier;
  return {
    target: decayValue(target, floorTarget, lossFraction, daysSinceGrace),
    max: max === null || floorMax === null ? max : decayValue(max, floorMax, lossFraction, daysSinceGrace),
  };
}
```

Then update the call site inside `rawDurations` (currently lines 118-121):

```typescript
  if (startTime > latestStart) {
    const daysSinceGrace = Math.floor((startTime - latestStart) / 86400);
    ({ target, max } = applyBreakDecay(
      target,
      max,
      daysSinceGrace,
      category.break_decay_multiplier,
      dm * category.initial_target_wear_duration_seconds,
      maxIsSet ? dm * category.initial_max_wear_duration_seconds! : null,
    ));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix src/backend test -- calculations.test.ts`
Expected: PASS for all `computeSessionStart` tests. (`computeDecay` tests will still fail — that's Task 2.)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/db/calculations.ts src/backend/tests/db/calculations.test.ts
git commit -m "feat: floor break decay loss amount per-day, not just the final value"
```

---

### Task 2: Backend — floored `daysUntilFullyDecayed` / `computeDecay`, and docs

**Files:**
- Modify: `src/backend/src/db/calculations.ts:166-199` (`computeDecay`, `daysUntilFullyDecayed`)
- Modify: `docs/design/duration-formula.md:115-119`
- Test: `src/backend/tests/db/calculations.test.ts` (the `describe('computeDecay', ...)` block, currently lines 159-194)

**Interfaces:**
- Consumes: `decayValue`, `decayOneDay` from Task 1 (same file, module-private functions — no import needed).
- Produces: no external signature changes — `computeDecay`'s exported signature is unchanged.

- [ ] **Step 1: Write the failing tests**

Replace the entire `describe('computeDecay', ...)` block in `src/backend/tests/db/calculations.test.ts` (currently lines 159-194) with:

```typescript
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
    const previous = { ended_at: 0, rest_seconds: 50, target_wear_seconds: 4100 };
    const r = computeDecay(previous, decayCat, 0);
    const decayStart = 0 + 50 + 100; // 150
    expect(r.decay_start_time).toBe(decayStart);
    // (4100+900) decays 5000 -> 4100 -> 3200 -> 2300 -> 1400 -> 900, floor reached after 5 days
    // (same worked example as Task 1's computeSessionStart test)
    expect(r.decay_full_time).toBe(decayStart + 5 * 86400);
    expect(r.decay_state).toBe('none');
  });

  it('is "decaying" once past decay_start_time but before decay_full_time', () => {
    const previous = { ended_at: 0, rest_seconds: 50, target_wear_seconds: 4100 };
    const decayStart = 150;
    const r = computeDecay(previous, decayCat, decayStart + 3 * 86400); // 3 days into a 5-day decay
    expect(r.decay_state).toBe('decaying');
  });

  it('is "fully_decayed" at decay_full_time', () => {
    const previous = { ended_at: 0, rest_seconds: 50, target_wear_seconds: 4100 };
    const decayStart = 150;
    const r = computeDecay(previous, decayCat, decayStart + 5 * 86400);
    expect(r.decay_state).toBe('fully_decayed');
    expect(r.decay_full_time).toBe(decayStart + 5 * 86400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix src/backend test -- calculations.test.ts`
Expected: FAIL — `decay_full_time` currently comes out as `decayStart + 8 * 86400` (old log-based formula) instead of `decayStart + 5 * 86400`.

- [ ] **Step 3: Rewrite `daysUntilFullyDecayed` and `computeDecay`'s decay-state calculation**

In `src/backend/src/db/calculations.ts`, replace `daysUntilFullyDecayed` (currently lines 194-199):

```typescript
/** Full days of floored decay (see `decayOneDay`) until (previousTarget + initial) reaches initial. */
function daysUntilFullyDecayed(previousTarget: number, initial: number, multiplier: number): number {
  if (previousTarget <= 0 || multiplier <= 0 || multiplier >= 1) return 0;
  const lossFraction = 1 - multiplier;
  let target = previousTarget + initial;
  let days = 0;
  while (target > initial) {
    target = decayOneDay(target, initial, lossFraction);
    days++;
  }
  return days;
}
```

Then update the decay-state calculation inside `computeDecay` (currently lines 186-190):

```typescript
  const daysSinceGrace = Math.floor((now - decayStartTime) / 86400);
  const lossFraction = 1 - category.break_decay_multiplier;
  const decayed = decayValue(previous.target_wear_seconds + initial, initial, lossFraction, daysSinceGrace);

  const decay_state: DecayState = decayed <= initial ? 'fully_decayed' : 'decaying';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix src/backend test -- calculations.test.ts`
Expected: PASS — all tests in the file green.

- [ ] **Step 5: Update the design doc**

In `docs/design/duration-formula.md`, replace the `* If start_time > previous_session.latest_start` block (currently lines 115-119):

```markdown
  * If `start_time > previous_session.latest_start`:
    Decay applies once per full day since grace ended (`new_session.days_since_grace`).
    Each day's loss amount is itself floored, so `target`/`max` reach
    `category.initial_target`/`category.initial_max` in a bounded number of
    days instead of trailing off asymptotically:
    ```
    loss_fraction = 1 - category.break_decay_multiplier

    for day in 1..new_session.days_since_grace:
      target_loss = max(loss_fraction * target, category.initial_target)
      target = max(target - target_loss, category.initial_target)

      # only when category has a max:
      max_loss = max(loss_fraction * max, category.initial_max)
      max = max(max - max_loss, category.initial_max)
    ```
```

- [ ] **Step 6: Commit**

```bash
git add src/backend/src/db/calculations.ts src/backend/tests/db/calculations.test.ts docs/design/duration-formula.md
git commit -m "feat: floor daily decay loss in decay-progress calculation, update formula docs"
```

---

### Task 3: Frontend — half-life <-> multiplier conversion helpers

**Files:**
- Modify: `src/frontend/src/utils/categoryForm.ts`
- Test: `src/frontend/src/utils/categoryForm.test.ts`

**Interfaces:**
- Produces: `multiplierToHalfLifeDays(multiplier: number): number` and `halfLifeDaysToMultiplier(halfLifeDays: number): number`, exported from `categoryForm.ts` — consumed by Task 4 (`CategoryForm.vue`).
- Note: this task also changes `CategoryFormState.breakDecayMultiplier` references to `breakDecayHalfLifeDays` inside `categoryToFormState`/`formStateToApiPayload`. `CategoryFormState` itself is defined in `CategoryForm.vue` (Task 4) — until Task 4 lands, `categoryForm.ts` will reference a field name (`breakDecayHalfLifeDays`) that doesn't exist yet on the type, so this task's typecheck will fail until Task 4 is done. That's expected; run only the test file (not full typecheck) between Task 3 and Task 4.

- [ ] **Step 1: Write the failing tests**

Replace `src/frontend/src/utils/categoryForm.test.ts` entirely with:

```typescript
import { describe, it, expect } from 'vitest';
import { categoryToFormState, formStateToApiPayload, multiplierToHalfLifeDays, halfLifeDaysToMultiplier } from './categoryForm.js';
import type { CategoryApiShape } from './categoryForm.js';

const BASE_CATEGORY: CategoryApiShape = {
  id: 1,
  name: 'Earrings',
  icon: '💎',
  initial_target_wear_duration_seconds: 900,
  initial_max_wear_duration_seconds: 1800,
  rest_multiplier: 2,
  minimum_rest: 86400,
  break_decay_multiplier: 0.91,
  break_grace_time: 86400,
  risk_levels: [
    { lower: null, upper: 3600, text: 'Low', severity: 1 },
    { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
    { lower: 7200, upper: null, text: 'High', severity: 3 },
  ],
};

describe('multiplierToHalfLifeDays / halfLifeDaysToMultiplier', () => {
  it('round-trips a multiplier through half-life and back', () => {
    const halfLife = multiplierToHalfLifeDays(0.91);
    expect(halfLifeDaysToMultiplier(halfLife)).toBeCloseTo(0.91);
  });

  it('a half-life of 1 day means multiplier 0.5', () => {
    expect(halfLifeDaysToMultiplier(1)).toBeCloseTo(0.5);
  });
});

describe('categoryToFormState', () => {
  it('maps target/max/min-rest/grace/decay', () => {
    const s = categoryToFormState(BASE_CATEGORY);
    expect(s.initialWearTargetSeconds).toBe(900);
    expect(s.initialWearMaxSeconds).toBe(1800);
    expect(s.minimumRestSeconds).toBe(86400);
    expect(s.breakGraceSeconds).toBe(86400);
    expect(s.breakDecayHalfLifeDays).toBeCloseTo(7.35, 1);
    expect(s.restMultiplier).toBe(2);
  });

  it('preserves a null maximum', () => {
    const s = categoryToFormState({ ...BASE_CATEGORY, initial_max_wear_duration_seconds: null });
    expect(s.initialWearMaxSeconds).toBeNull();
  });

  it('derives bandCount and crossoverPoints', () => {
    const s = categoryToFormState(BASE_CATEGORY);
    expect(s.bandCount).toBe(3);
    expect(s.crossoverPoints).toEqual([3600, 7200]);
  });
});

describe('formStateToApiPayload', () => {
  it('maps all fields to snake_case incl. null max', () => {
    const payload = formStateToApiPayload({
      name: 'Test', icon: '🎯',
      initialWearTargetSeconds: 1800, initialWearMaxSeconds: null,
      restMultiplier: 1.5, minimumRestSeconds: 1200,
      breakGraceSeconds: 3600, breakDecayHalfLifeDays: multiplierToHalfLifeDays(0.8),
      bandCount: 2, crossoverPoints: [3600],
    });
    expect(payload.initial_target_wear_duration_seconds).toBe(1800);
    expect(payload.initial_max_wear_duration_seconds).toBeNull();
    expect(payload.minimum_rest).toBe(1200);
    expect(payload.break_grace_time).toBe(3600);
    expect(payload.break_decay_multiplier).toBeCloseTo(0.8);
    expect(payload.rest_multiplier).toBe(1.5);
    expect(payload.risk_levels).toEqual([
      { lower: null, upper: 3600, text: 'Low', severity: 1 },
      { lower: 3600, upper: null, text: 'High', severity: 2 },
    ]);
  });

  it('round-trips', () => {
    const payload = formStateToApiPayload(categoryToFormState(BASE_CATEGORY));
    expect(payload.initial_target_wear_duration_seconds).toBe(900);
    expect(payload.initial_max_wear_duration_seconds).toBe(1800);
    expect(payload.break_grace_time).toBe(86400);
    expect(payload.break_decay_multiplier).toBeCloseTo(0.91);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix src/frontend test -- categoryForm.test.ts`
Expected: FAIL — `multiplierToHalfLifeDays`/`halfLifeDaysToMultiplier` don't exist yet; `s.breakDecayHalfLifeDays` is `undefined`.

- [ ] **Step 3: Implement the helpers and wire them in**

Replace `src/frontend/src/utils/categoryForm.ts` entirely with:

```typescript
import { buildRiskLevels } from './riskLevels.js';
import type { CategoryFormState } from '../components/CategoryForm.vue';
import type { RiskLevel } from './riskLevels.js';

export interface CategoryApiShape {
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  break_decay_multiplier: number;
  break_grace_time: number;
  risk_levels: RiskLevel[];
  [key: string]: unknown;
}

/** Days for a value decaying at `multiplier` retained per day to halve. */
export function multiplierToHalfLifeDays(multiplier: number): number {
  return Math.log(0.5) / Math.log(multiplier);
}

/** The daily retain-fraction that gives a value the given half-life in days. */
export function halfLifeDaysToMultiplier(halfLifeDays: number): number {
  return 0.5 ** (1 / halfLifeDays);
}

export function categoryToFormState(cat: CategoryApiShape): CategoryFormState {
  return {
    name: cat.name,
    icon: cat.icon,
    initialWearTargetSeconds: cat.initial_target_wear_duration_seconds,
    initialWearMaxSeconds: cat.initial_max_wear_duration_seconds,
    minimumRestSeconds: cat.minimum_rest,
    breakGraceSeconds: cat.break_grace_time,
    breakDecayHalfLifeDays: multiplierToHalfLifeDays(cat.break_decay_multiplier),
    restMultiplier: cat.rest_multiplier,
    bandCount: cat.risk_levels.length,
    crossoverPoints: cat.risk_levels.slice(0, -1).map((l) => l.upper as number),
  };
}

export function formStateToApiPayload(data: CategoryFormState): {
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  break_decay_multiplier: number;
  break_grace_time: number;
  risk_levels: RiskLevel[];
} {
  return {
    name: data.name,
    icon: data.icon,
    initial_target_wear_duration_seconds: data.initialWearTargetSeconds,
    initial_max_wear_duration_seconds: data.initialWearMaxSeconds,
    rest_multiplier: data.restMultiplier,
    minimum_rest: data.minimumRestSeconds,
    break_decay_multiplier: halfLifeDaysToMultiplier(data.breakDecayHalfLifeDays),
    break_grace_time: data.breakGraceSeconds,
    risk_levels: buildRiskLevels(data.bandCount, data.crossoverPoints),
  };
}
```

- [ ] **Step 4: Run tests (expect the two `categoryToFormState`/`formStateToApiPayload` describe blocks to still fail — that's fine, they need Task 4)**

Run: `npm --prefix src/frontend test -- categoryForm.test.ts`
Expected: the two new `multiplierToHalfLifeDays`/`halfLifeDaysToMultiplier` tests PASS. The `categoryToFormState`/`formStateToApiPayload` tests will fail to *compile* (TS error: `CategoryFormState` has no `breakDecayHalfLifeDays` property, still has `breakDecayMultiplier`) until Task 4 updates `CategoryForm.vue`. This is expected — proceed to Task 4 immediately, don't commit yet.

- [ ] **Step 5: Commit (after Task 4's Step 3 makes the whole suite pass — see Task 4)**

This task's commit is deferred to the end of Task 4's steps, since `categoryForm.ts` and `CategoryForm.vue` change the same shared type and must land together for the test suite to compile. Continue directly to Task 4.

---

### Task 4: Frontend — `CategoryForm.vue` half-life field

**Files:**
- Modify: `src/frontend/src/components/CategoryForm.vue`

**Interfaces:**
- Consumes: `multiplierToHalfLifeDays` from `src/frontend/src/utils/categoryForm.ts` (Task 3).
- Produces: `CategoryFormState.breakDecayHalfLifeDays: number` (replaces `breakDecayMultiplier: number`), consumed by `categoryForm.ts` (Task 3, already written) and `CategoriesSection.vue` (unchanged — it only passes `CategoryFormState` through opaquely).

- [ ] **Step 1: Update the `CategoryFormState` interface and default state**

In `src/frontend/src/components/CategoryForm.vue`, add an import near the top of the `<script setup>` block (after the existing imports, e.g. after line 151's `DurationTrigger` import):

```typescript
import { multiplierToHalfLifeDays } from '../utils/categoryForm.js';
```

Replace the `CategoryFormState` interface (currently lines 153-164):

```typescript
export interface CategoryFormState {
  name: string;
  icon: string;
  initialWearTargetSeconds: number;
  initialWearMaxSeconds: number | null;
  minimumRestSeconds: number;
  breakGraceSeconds: number;
  breakDecayHalfLifeDays: number;
  restMultiplier: number;
  bandCount: number;
  crossoverPoints: number[];
}

const DEFAULT_HALF_LIFE_DAYS = multiplierToHalfLifeDays(0.91);
```

Replace the `DEFAULT_STATE` object (currently lines 166-177):

```typescript
const DEFAULT_STATE: CategoryFormState = {
  name: '',
  icon: '',
  initialWearTargetSeconds: 900,
  initialWearMaxSeconds: 1350,
  minimumRestSeconds: 86400,
  breakGraceSeconds: 86400,
  breakDecayHalfLifeDays: DEFAULT_HALF_LIFE_DAYS,
  restMultiplier: 2,
  bandCount: 3,
  crossoverPoints: [3600, 7200],
};
```

- [ ] **Step 2: Update the template field**

Replace the "Break decay / day" `NumberField` (currently lines 48-56):

```html
      <NumberField
        id="cat-decay"
        label="Break half-life (days)"
        v-model="catForm.breakDecayHalfLifeDays"
        :min="0.1"
        :default="DEFAULT_HALF_LIFE_DAYS"
        :step="0.1"
      />
```

- [ ] **Step 3: Update `onSubmit`**

Replace the `breakDecayMultiplier` line inside `onSubmit()` (currently line 249):

```typescript
    breakDecayHalfLifeDays: catForm.breakDecayHalfLifeDays,
```

- [ ] **Step 4: Run the frontend test suite to verify Tasks 3+4 together pass**

Run: `npm --prefix src/frontend test -- categoryForm.test.ts`
Expected: PASS — all tests in `categoryForm.test.ts` green, including the ones deferred from Task 3.

Run: `npm --prefix src/frontend run typecheck` (or `npm --prefix src/frontend run build` if no separate typecheck script — check `src/frontend/package.json` for the exact script name)
Expected: no type errors referencing `breakDecayMultiplier`/`breakDecayHalfLifeDays`.

- [ ] **Step 5: Manually verify the form in the browser**

Run the app (check for a project `run`/dev skill or `npm --prefix src/frontend run dev`), open the category create/edit form, and confirm:
- A new category shows "Break half-life (days)" defaulting to ~7.3.
- Editing an existing category with `break_decay_multiplier: 0.91` shows ~7.3 as well.
- Changing the half-life and saving persists a sensible `break_decay_multiplier` (spot-check via the API response or DB row if convenient).

- [ ] **Step 6: Commit (covers Task 3 + Task 4 together)**

```bash
git add src/frontend/src/utils/categoryForm.ts src/frontend/src/utils/categoryForm.test.ts src/frontend/src/components/CategoryForm.vue
git commit -m "feat: replace break-decay multiplier input with a half-life (days) field"
```

---

## Self-Review Notes

- **Spec coverage:** floored day-by-day formula (Task 1 + 2), docs update (Task 2 Step 5), half-life UI (Task 3 + 4), tests for both backend formula and frontend conversion (all tasks) — all spec sections have a corresponding task.
- **Type consistency:** `CategoryFormState.breakDecayHalfLifeDays` (Task 4) matches the field name used in `categoryForm.ts` (Task 3) and in the `onSubmit` emit payload (Task 4 Step 3).
- **No placeholders:** all steps contain complete code, not descriptions.
