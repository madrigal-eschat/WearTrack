# Rotation Categories — Design Spec

**Date:** 2026-07-19

## Overview

Add a second category type: **rotation**. Instead of the target/max/rest/decay/
injury formula in [`duration-formula.md`](../../design/duration-formula.md),
a rotation category has a fixed wear duration and enforces that items are worn
in rotation — you can't repeat an item until every other active item in the
category has had a turn. An optional **consecutive wear-days** setting nudges
the UI to keep suggesting the same item for N days in a row before moving on
(e.g. for items that don't need daily washing), with an escape hatch to bail
out early.

Existing (`duration`) categories are unaffected.

### Key semantic differences from `duration` categories

- No growth formula, no rest period, no decay, no injuries. Target duration is
  fixed per category, set once, never modified per-session.
- No `max_wear_seconds` — rotation sessions never have a maximum.
- Availability (which items can be started next) is **derived from session
  history on every read/write** — nothing about "whose turn it is" or "which
  cycle we're in" is stored. This means adding or removing items from the
  category mid-rotation just works: a new item is immediately available (it's
  never appeared in history), a removed item silently drops out of
  consideration.
- The consecutive-wear-days lock is a **frontend-only UX default**. The
  backend has no concept of it and never rejects a session for "not yet
  finishing the lock" — the item the lock would suggest is always the (or an)
  available item under the base rotation rule anyway, so overriding it via the
  UI's "Wear something else" escape hatch requires no special backend
  permission and persists nothing.

### Out of scope

- Any interaction between rotation categories and the injury/streak-decay
  mechanics of duration categories.
- Editing/backdating rotation-category sessions differently from today's
  session-edit flow (out of scope; existing edit/delete behaviour applies
  unchanged).

---

## Data model

### Migration 009

**`categories`:**
- ADD `type TEXT NOT NULL DEFAULT 'duration'` — `'duration'` or `'rotation'`.
- ADD `consecutive_wear_days INTEGER NOT NULL DEFAULT 1`.

No other schema change. For `rotation` categories:
- `initial_target_wear_duration_seconds` is reused as the fixed target — set
  once at category creation/edit, never grown.
- `initial_max_wear_duration_seconds`, `rest_multiplier`, `minimum_rest`,
  `break_decay_multiplier`, `break_grace_time`, `risk_levels` are present in
  the row (schema unchanged) but **ignored** by all rotation-category logic.
  The category form never shows or lets the user edit them for this type.

**`sessions`:** no schema change.
- `target_wear_seconds` = the category's fixed target, copied in at session
  start (same field, same lifecycle as today).
- `max_wear_seconds` = always `null` for rotation-category sessions.
- `rest_seconds` = always `null` for rotation-category sessions (no rest
  formula runs).

No new tables. Skips/overrides are never persisted.

---

## Backend

### `db/calculations.ts`

New pure function:

```ts
function rotationAvailability(
  activeItemIds: number[],
  recentSessions: { item_id: number }[], // newest first
): Set<number>
```

Walks `recentSessions` newest→oldest, building a `seen` set of item ids. Stops
at the first item id already in `seen`. If `seen` ends up equal to the full
`activeItemIds` set with no repeat encountered (i.e. a full rotation just
completed with no leftovers), the result is **all active items** (fresh
reset). Otherwise the result is `activeItemIds` minus `seen`.

`computeSessionStart` / `computeRest` / `riskLevelFor` are untouched and are
simply never called for `type === 'rotation'` categories.

### `db/stores/category-store.ts`

`Category` / `CategoryRow` / `CategoryCreate` gain `type` and
`consecutive_wear_days`. `create` / `update` SQL and `ALLOWED_COLUMNS` updated
accordingly.

### `db/stores/session-store.ts`

- `start()`: branches on `category.type`.
  - `'duration'`: unchanged, calls `computeSessionStart`.
  - `'rotation'`: `target = category.initial_target_wear_duration_seconds`,
    `max = null`. No previous-session lookup needed for the formula, but the
    availability check (below) still needs recent category session history.
- `end()`: branches on `category.type`.
  - `'duration'`: unchanged, calls `computeRest`.
  - `'rotation'`: `rest_seconds` stays `null`; stats recording
    (`recordItemSession`, `recordCategorySession` — including the existing
    per-category streak logic) still runs unchanged, since that logic is
    generic over "a session ended on day X" and isn't tied to the duration
    formula.
- New method `findRecentInCategory(categoryId, limit)`: last N sessions
  (any item) for a category, newest first, `{ item_id }[]` — feeds
  `rotationAvailability`. Limit = comfortably more than any realistic item
  count (e.g. 100) so a full cycle is always visible.

### `controllers/sessions.ts` — `POST /api/sessions` (start)

For `type === 'rotation'` categories: before calling `sessionStore.start`,
compute `rotationAvailability(activeItemIdsInCategory, recentSessions)` and
reject with 400 if the requested `itemId` isn't in the set. `duration`
categories are unaffected (no new check).

### `controllers/sessions.ts` — `GET /api/sessions/current`

`ItemWithLastSession` gains `rotation_available: boolean`. For `duration`
categories this is always `true` (unused by the frontend). For `rotation`
categories it's the same `rotationAvailability` computation, so the frontend
never re-implements the algorithm.

### `controllers/categories.ts`

POST/PATCH validate and accept `type` (`'duration' | 'rotation'`) and
`consecutive_wear_days` (positive integer). For `type === 'rotation'`,
`initial_max_wear_duration_seconds` must be `null` and the rest/decay/grace/
risk-level fields are ignored if sent (not persisted as meaningful — they keep
their column defaults but are never read).

Injuries (`controllers/injuries.ts`): reject creating an injury for a
`rotation` category (400) — the mechanic doesn't apply.

---

## Frontend

### `utils/wearCalculations.ts`

No change to existing functions. Rotation sessions naturally have
`max_wear_seconds === null`, so the existing null-max bar/lap code path
already renders them reasonably; rotation categories don't use the lap
mechanic though (target is fixed, sessions aren't expected to run long enough
to lap) — no new code needed here, just note it's compatible.

### `composables/useWear.ts`

`ItemWithLastSession` type gains `rotation_available: boolean`.

### `components/CategoryForm.vue` + `utils/categoryForm.ts` + `utils/categoryDefaults.ts`

- Add a type selector (`duration` / `rotation`), defaulting to `duration` for
  new categories (unchanged behaviour).
- When `type === 'rotation'`: show only name, icon, items, a single fixed
  target-duration picker (maps to `initial_target_wear_duration_seconds`), and
  a `consecutive_wear_days` number field (default 1, meaning "no lock, plain
  rotation"). Hide max/rest/decay/grace/risk-band UI entirely.
- `categoryToFormState` / `formStateToApiPayload` map the two new fields and
  branch the payload shape by type.

### `components/ActionPane.vue`

For `entry.category.type === 'rotation'` (idle, no active session):

- Compute `forcedItem`: the item of the most recent session in the category,
  **if** the trailing run of consecutive sessions all naming that same item
  (scanning the same recent-sessions list newest→oldest, no gap-tolerance
  change needed — a missed day doesn't reset the count, since we simply count
  same-item repeats until we hit a different item, ignoring dates) has length
  `< category.consecutive_wear_days`. `null` if no sessions yet or the count
  already reached `consecutive_wear_days`.
- Local reactive per-category flag `overrideLock[categoryId]` (starts
  `false`), reset whenever a session starts/ends for that category.
- If `forcedItem && !overrideLock[categoryId]`: render the item name as plain
  text (no `<select>`), Wear button starts that item directly, plus a "Wear
  something else" button that sets `overrideLock[categoryId] = true` (pure
  local state, no request).
- Otherwise: existing `<select>` dropdown, still built from
  `itemsForCategory`, but each `<option>` is marked `disabled` (greyed out,
  not removed) when `rotation_available` is `false` for that item — this
  replaces the current unconditional `<option>` loop for `type === 'rotation'`
  categories only; `duration` categories keep today's behaviour untouched.
- The "Currently Wearing" active-session display (progress bar, elapsed,
  target) reuses the existing null-max rendering path as-is — no rotation-
  specific active-session UI needed since `max_wear_seconds` is always `null`.

---

## Testing

- **Backend unit (`calculations.test.ts`):** `rotationAvailability` — empty
  history (all available), partial cycle, full-cycle reset, item added
  mid-cycle (immediately available), item removed mid-cycle (drops out even
  if it was in `seen`).
- **Backend integration:** `POST /api/sessions` rejects a non-available item
  for a rotation category (400) and accepts one that is available; duration
  categories unaffected; `GET /api/sessions/current` returns correct
  `rotation_available` per item; injury creation rejected for rotation
  categories; category CRUD round-trips `type` and `consecutive_wear_days`.
- **Migration test:** 009 adds columns with correct defaults on a seeded
  pre-migration DB; existing categories come out as `type = 'duration'`,
  `consecutive_wear_days = 1`.
- **Frontend unit:** forced-item derivation (empty history, mid-run, run
  complete, gap in dates doesn't break the count); category form
  create/edit payload mapping for rotation type incl. hidden-field defaults.
- **E2E:** create a rotation category with 3 items and
  `consecutive_wear_days = 1`; wear A, B, C in sequence, verify greying out
  and full-cycle reset back to all-available. Create one with
  `consecutive_wear_days = 2`; wear A, verify next visit shows the locked
  label for A (not a dropdown); wear A again, verify dropdown appears showing
  B/C available, A greyed; verify "Wear something else" on a still-locked day
  reveals the dropdown without making a network request.

---

## Migration / rollout

Migration 009 is additive only, single deploy. Existing categories default to
`type = 'duration'`, `consecutive_wear_days = 1` — fully backward compatible,
no behaviour change for any existing category.
