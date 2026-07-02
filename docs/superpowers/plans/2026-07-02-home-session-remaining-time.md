# Home tab session remaining time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show remaining time (to target, then to max) for the active wear session on the Home tab, and reflow the Worn/Target/Max display into two rows of two.

**Architecture:** Add a pure `remainingWearSeconds` helper to `src/frontend/src/utils/wearCalculations.ts` (returns seconds left, or `null` once the session is overdue). Wire it into `src/frontend/src/components/ActionPane.vue`, which already ticks a `now` ref every second via `useNow()` and already reads `targetWearSeconds`/`maxWearSeconds`/`currentWear` from the same module. Reflow the existing single-column Worn/Target/Max block into two rows: `Worn / Remaining` then `Target / Max`.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Vitest for unit tests. No backend or API changes — session data already includes `target_wear_seconds` and `max_wear_seconds`.

## Global Constraints

- No backend/API changes — this is frontend-only, using data already returned by `/api/sessions/current`.
- Follow existing code style in `wearCalculations.ts` / `ActionPane.vue` (label pattern: `text-xs text-gray-400 uppercase tracking-wide mr-1` for labels, `text-sm text-gray-600` for values, `formatDuration` for full-precision durations).
- No `@vue/test-utils` / component-level tests exist in this codebase — logic lives in testable pure functions in `utils/`, tested with Vitest. Follow that convention; don't introduce a new component-testing setup.
- Test command: `cd src/frontend && npm run test:ci` (Vitest, one-shot).

---

### Task 1: `remainingWearSeconds` helper + unit tests

**Files:**
- Modify: `src/frontend/src/utils/wearCalculations.ts`
- Test: `src/frontend/src/utils/wearCalculations.test.ts`

**Interfaces:**
- Consumes: existing `currentWear(session, now)` from the same file (`src/frontend/src/utils/wearCalculations.ts:11-13`).
- Produces: `remainingWearSeconds(session: { started_at: number; ended_at: number | null; target_wear_seconds: number; max_wear_seconds: number | null }, now: number): number | null` — used by Task 2. Returns:
  - `target_wear_seconds - elapsed` while `elapsed < target_wear_seconds`
  - `max_wear_seconds - elapsed` while `elapsed >= target_wear_seconds` and `max_wear_seconds !== null` and `elapsed < max_wear_seconds`
  - `null` once `elapsed >= max_wear_seconds`, or once `elapsed >= target_wear_seconds` with `max_wear_seconds === null` (i.e. "overdue, nothing more to count down")

- [ ] **Step 1: Write the failing tests**

Add to `src/frontend/src/utils/wearCalculations.test.ts` (after the existing `maxWearSeconds` describe block):

```ts
describe('remainingWearSeconds', () => {
  it('counts down to target before target is reached', () => {
    const session = { started_at: 1000, ended_at: null, target_wear_seconds: 900, max_wear_seconds: 1800 };
    expect(remainingWearSeconds(session, 1000 + 300)).toBe(600);
  });

  it('counts down to max once target is passed, when max is set', () => {
    const session = { started_at: 1000, ended_at: null, target_wear_seconds: 900, max_wear_seconds: 1800 };
    expect(remainingWearSeconds(session, 1000 + 1000)).toBe(800);
  });

  it('returns null once max is reached', () => {
    const session = { started_at: 1000, ended_at: null, target_wear_seconds: 900, max_wear_seconds: 1800 };
    expect(remainingWearSeconds(session, 1000 + 1800)).toBeNull();
  });

  it('returns null once target is reached when there is no max', () => {
    const session = { started_at: 1000, ended_at: null, target_wear_seconds: 900, max_wear_seconds: null };
    expect(remainingWearSeconds(session, 1000 + 900)).toBeNull();
  });

  it('returns null past target with no max even well beyond it', () => {
    const session = { started_at: 1000, ended_at: null, target_wear_seconds: 900, max_wear_seconds: null };
    expect(remainingWearSeconds(session, 1000 + 5000)).toBeNull();
  });
});
```

Update the import line at the top of the test file:

```ts
import { targetWearSeconds, maxWearSeconds, remainingWearSeconds } from './wearCalculations.js';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/frontend && npx vitest run src/utils/wearCalculations.test.ts`
Expected: FAIL — `remainingWearSeconds is not a function` (or TS error: `remainingWearSeconds` has no exported member).

- [ ] **Step 3: Implement `remainingWearSeconds`**

Add to `src/frontend/src/utils/wearCalculations.ts` (after `currentWear`):

```ts
/**
 * Seconds left in an active session: counts down to target first, then to
 * max (if set). Returns null once there's nothing left to count down —
 * max reached, or target reached with no max set.
 */
export function remainingWearSeconds(
  session: { started_at: number; ended_at: number | null; target_wear_seconds: number; max_wear_seconds: number | null },
  now: number
): number | null {
  const elapsed = currentWear(session, now);
  if (elapsed < session.target_wear_seconds) {
    return session.target_wear_seconds - elapsed;
  }
  if (session.max_wear_seconds !== null && elapsed < session.max_wear_seconds) {
    return session.max_wear_seconds - elapsed;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/frontend && npx vitest run src/utils/wearCalculations.test.ts`
Expected: PASS (all `remainingWearSeconds` and pre-existing tests green).

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/utils/wearCalculations.ts src/frontend/src/utils/wearCalculations.test.ts
git commit -m "feat(frontend): add remainingWearSeconds helper for active sessions"
```

---

### Task 2: Wire remaining time into ActionPane, reflow into two rows

**Files:**
- Modify: `src/frontend/src/components/ActionPane.vue`

**Interfaces:**
- Consumes: `remainingWearSeconds` from Task 1 (`src/frontend/src/utils/wearCalculations.ts`), plus existing `formatDuration`, `elapsed`, `targetLabel`, `maxWear`, `entry.session`, `now` (all already present in `ActionPane.vue`).
- Produces: nothing consumed elsewhere — this is the leaf UI change.

- [ ] **Step 1: Add script helpers**

In `src/frontend/src/components/ActionPane.vue`, update the import from `wearCalculations.js` (currently line 141):

```ts
import { targetWearSeconds, maxWearSeconds, currentWear, remainingWearSeconds } from '../utils/wearCalculations.js';
```

Add two new functions right after the existing `maxWear` function (after line 199):

```ts
function remainingSecondsFor(session: Session): number | null {
  return remainingWearSeconds(session, Math.floor(now.value / 1000));
}

function remainingLabel(entry: CurrentEntry): string {
  if (!entry.session) return '';
  const remaining = remainingSecondsFor(entry.session);
  return remaining === null ? 'Stop wearing' : formatDuration(remaining);
}

function isOverdue(entry: CurrentEntry): boolean {
  if (!entry.session) return false;
  return remainingSecondsFor(entry.session) === null;
}
```

- [ ] **Step 2: Reflow the template into two rows**

Replace the active-session block (currently `src/frontend/src/components/ActionPane.vue:41-45`):

```html
              <div class="text-right tabular-nums leading-snug whitespace-nowrap">
                <div class="text-sm text-gray-600"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Worn</span>{{ elapsed(entry.session) }}</div>
                <div class="text-sm text-gray-600 mt-0.5"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ targetLabel(entry) }}</div>
                <div v-if="entry.session.max_wear_seconds !== null" class="text-sm text-gray-600 mt-0.5"><span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ maxWear(entry) }}</div>
              </div>
```

with:

```html
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
```

- [ ] **Step 3: Typecheck and run full frontend test suite**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no errors.

Run: `cd src/frontend && npm run test:ci`
Expected: all tests PASS, including the new `remainingWearSeconds` tests from Task 1.

- [ ] **Step 4: Manual verification**

Run: `cd src/frontend && npm run dev`, open the app, start a wear session on any item with a short target (or use an existing item), and confirm:
- "Worn" and "Remaining" appear on one row, "Target" and "Max" (if set) on the row below.
- "Remaining" counts down live (ticks with `now`).
- Once elapsed passes target (with no max, or once past max with a max set), the field switches to "Stop wearing" in red/warning styling.

Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/ActionPane.vue
git commit -m "feat(frontend): show remaining session time on Home tab"
```
