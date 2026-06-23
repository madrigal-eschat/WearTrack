# Target & Maximum Wear Durations — Design Spec

**Date:** 2026-06-23

## Overview

Split the single `initial_wear_duration_seconds` per category into a **target**
and a **maximum**. The maximum is optional (nullable). Make the **minimum rest
period** and **break grace time** customisable per category, and expose the
**break decay multiplier** in the UI.

This reworks the whole wear/rest model to match the rewritten formula in
[`docs/design/duration-formula.md`](../../design/duration-formula.md), which is
the authoritative source for all calculations. Where this spec and the formula
doc disagree, the formula doc wins.

### Key semantic change

Today `sessions.calculated_wear_seconds` is mutated at session end to
`initial + elapsed`. Under the new model it is renamed `max_wear_seconds`, set
**once at session start**, and never changed. A sibling `target_wear_seconds` is
added with the same lifecycle. Elapsed wear is always derived as
`ended_at - started_at`; it is never stored.

`previous_session` (for the start-of-session growth formula) is the most
recently ended session for **any item in the category**, not just the item
being started.

### Out of scope

- The null-max "lap counter" mechanic (bar resets, "Nx" multiplier, `floor(N/2)`
  carry-over). Pinned as a separate follow-up feature. For this change, when max
  is null the active-session progress bar fills toward target and caps at 100%.
- Cross-category injury effects (halving other categories). Abandoned.

---

## Data model

### Migration 003 (additive + renames)

**`categories`:**
- ADD `initial_target_wear_duration_seconds` INTEGER NOT NULL DEFAULT 0
- ADD `initial_max_wear_duration_seconds` INTEGER (nullable)
- ADD `break_grace_time` INTEGER NOT NULL DEFAULT 86400
- ADD `minimum_rest` REAL NOT NULL DEFAULT 0
- Populate from existing rows:
  - `initial_max_wear_duration_seconds = initial_wear_duration_seconds`
  - `initial_target_wear_duration_seconds = CAST(initial_wear_duration_seconds * 2 / 3 AS INTEGER)`
  - `minimum_rest = rest_constant_seconds`
  - `break_decay_multiplier = 0.91` (was 0.75)
- DROP `break_starts_after_seconds` (no longer used by the formula)

**`sessions`:**
- RENAME `calculated_wear_seconds` → `max_wear_seconds`
- ADD `target_wear_seconds` INTEGER NOT NULL DEFAULT 0; populate existing rows as
  `CAST(max_wear_seconds * 2 / 3 AS INTEGER)`
- RENAME `calculated_rest_seconds` → `rest_seconds`

`initial_wear_duration_seconds` and `rest_constant_seconds` are intentionally
left in place by 003 and removed in 004 (so 003 can read them during the UPDATE).

### Migration 004 (cleanup, same deploy)

- `ALTER TABLE categories DROP COLUMN initial_wear_duration_seconds`
- `ALTER TABLE categories DROP COLUMN rest_constant_seconds`

(SQLite ≥ 3.35 / better-sqlite3 supports `DROP COLUMN`.)

---

## Backend

### `db/calculations.ts`

Implements the formula doc. All functions are pure and unit-tested against the
worked examples in the formula doc.

- **`RiskLevel`** gains `rest_weight: number` — precomputed
  `count > 1 ? 2 * (index / (count - 1)) : 0`. Computed when risk levels are
  built (see `riskLevels.ts` on the frontend / validation on POST). Persisted in
  the `risk_levels` JSON.
- **`riskLevelFor(elapsed, category): RiskLevel | null`** — replaces
  `getRiskLevel`; the caller reads `.rest_weight` directly (no index/count math).
- **`computeSessionStart(category, item, previousSession | null, startTime, injuryActive): { target: number; max: number | null }`**
  — the full Session-Start formula:
  - `difficulty_modifier = 1 / item.difficulty_multiplier`
  - no previous: `target = difficulty_modifier * initial_target`
  - within rest (`startTime < earliest_start`): `prev.target / 2`
  - after rest: `difficulty_modifier * (prev.target + initial_target)`
  - past grace (`startTime > latest_start`): multiply by
    `break_decay_multiplier ^ days_since_grace`
  - active injury: halve target and max
  - `max` is `null` throughout when `initial_max_wear_duration_seconds` is null
- **`computeRest(elapsed, category, riskLevel, maxIsSet, injuryActive): number`**
  — the Session-End rest formula:
  - `combined = (1 + riskLevel.rest_weight) * rest_multiplier`
  - `rest = elapsed * combined`
  - if `elapsed > max` (max set): `rest += (elapsed - max) * 2`
  - floor: `rest = max(rest, maxIsSet ? minimum_rest : 0)`
  - active injury: `rest *= 1.5`

### `db/stores/category-store.ts`

- `Category` / `CategoryRow` / `CategoryCreate`: replace
  `initial_wear_duration_seconds` and `rest_constant_seconds` with the four new
  fields; drop `break_starts_after_seconds`.
- `create` / `update` SQL updated for the new column set.

### `db/stores/session-store.ts`

- `Session` interface: `calculated_wear_seconds` → `max_wear_seconds` (add
  `target_wear_seconds`), `calculated_rest_seconds` → `rest_seconds`.
- `start(itemId, category, item, startedAt)` — now takes the item (for
  `difficulty_multiplier`). Looks up `previous_session` **per category** (last
  ended session for any item in the category), calls `computeSessionStart`, and
  writes `target_wear_seconds` + `max_wear_seconds` (the latter nullable).
- `end(session, category, endedAt)` — derive `elapsed = endedAt - started_at`,
  look up the risk band for `elapsed`, call `computeRest`, write `ended_at` and
  `rest_seconds` only. `target_wear_seconds` / `max_wear_seconds` are untouched.
- `resolveInitialWear` is removed (superseded by `computeSessionStart`).
- `ItemWithLastSession`: rename fields to `max_wear_seconds`, `rest_seconds`, add
  `target_wear_seconds`, plus `started_at` (needed to derive elapsed if required).
- New per-category previous-session lookup helper.

### `db/stores/stats-store.ts`

- `SessionSnapshot`: rename fields to match; the wear metric is now
  `ended_at - started_at` (elapsed), not the stored threshold.
- `recordItemSession` / `recordCategorySession`: use derived elapsed.
- `recordCategorySession`: receives `category.break_grace_time` instead of the
  hardcoded `GRACE_SECONDS` for the streak-break check.
- `history()`: `SUM(calculated_wear_seconds)` → `SUM(ended_at - started_at)`.

### `controllers/sessions.ts` — `GET /api/sessions/current`

For each item, compute the **expected** next session's target/max via
`computeSessionStart(category, item, previousSessionForCategory, now, injuryActive)`
and return them on each `ItemWithLastSession` entry (fields `expected_target`,
`expected_max`). This keeps the formula in one place (the backend) and lets the
idle UI display the right numbers without re-implementing decay/injury logic.

### `controllers/categories.ts`

POST and PATCH validate and accept: `initial_target_wear_duration_seconds`
(number), `initial_max_wear_duration_seconds` (number **or null**),
`break_grace_time` (number), `minimum_rest` (number), `break_decay_multiplier`
(number). Old fields (`initial_wear_duration_seconds`, `rest_constant_seconds`,
`break_starts_after_seconds`) are removed from validation and payloads.

---

## Frontend

### `utils/wearCalculations.ts`

- `maxWearSeconds(session)` → reads `session.max_wear_seconds` (nullable).
- `targetWearSeconds(session)` → reads `session.target_wear_seconds`.
- Idle-state display uses the API-provided `expected_target` / `expected_max`
  rather than recomputing.

### `utils/riskLevels.ts`

`buildRiskLevels` populates each band's `rest_weight` using the
`2 * (index / (count - 1))` rule (0 when a single band).

### `composables/useWear.ts`

- `Session` / `ItemWithLastSession` types: rename fields, add
  `target_wear_seconds`, `expected_target`, `expected_max`.
- `currentWear(session)` simplifies to `now - started_at` (elapsed). The old
  `calculated_wear_seconds + elapsed` semantics are gone.

### `components/ActionPane.vue`

- **Active session bar:** show a **target marker** at
  `target / max * 100%` and the bar fills toward `max` (100%). When max is null,
  the bar fills toward target (target = 100%) and caps there.
- Colour thresholds (red/orange/yellow) key off `max` when set, otherwise off
  `target`.
- **Idle row:** "Target" and (when set) "Max" labels use `expected_target` /
  `expected_max` from the API. Rest-remaining countdown unchanged in behaviour
  (reads renamed `rest_seconds`).

### `components/CategoryForm.vue` + `utils/categoryForm.ts` + `utils/categoryDefaults.ts`

`CategoryFormState` changes:
- `initialWearSeconds` → `initialWearTargetSeconds` (number) and
  `initialWearMaxSeconds` (number | null)
- add `breakGraceSeconds`, `minimumRestSeconds`, `breakDecayMultiplier`

Form UI:
- **Target wear** duration picker (always shown).
- **Maximum wear** duration picker, clearable to null. A clear/"no maximum"
  affordance sets it null.
- **Minimum rest period** duration picker — disabled when max is null (no effect
  per the formula).
- **Break grace time** duration picker.
- **Break decay multiplier** numeric input (0 ≤ x < 1), newly exposed.
- Existing rest-multiplier input and risk bands unchanged.

`categoryToFormState` / `formStateToApiPayload` map all new fields.
`DEFAULT_CATEGORY_FIELDS`: target 900, max 1350 (target = ⌊max·2/3⌋), minimum
rest 86400, break grace 86400, break decay 0.91.

---

## Testing

- **Backend unit (`calculations.test.ts`):** worked examples from the formula
  doc for `computeSessionStart` (first session, within-rest, after-rest growth,
  past-grace decay, injury, null max) and `computeRest` (each risk band, over-max
  penalty, minimum-rest floor with/without max, injury).
- **Backend integration:** session start/end persists correct target/max/rest;
  `GET /api/sessions/current` returns expected target/max; category CRUD round-trips
  the new fields incl. null max.
- **Migration test:** 003 + 004 on a seeded pre-migration DB yields correct
  populated values and dropped columns.
- **Frontend unit:** `wearCalculations`, `categoryForm` mapping (incl. null max),
  `riskLevels` rest_weight.
- **E2E:** category form create/edit with target/max/min-rest/grace/decay; bar
  shows target marker; null-max category hides min-rest and caps bar at target.

---

## Migration / rollout

Migrations 003 and 004 run in sequence on the same deploy. Existing categories
keep their current behaviour as closely as possible: old wear value becomes the
max, target is two-thirds of it, the old 24h rest constant becomes `minimum_rest`,
grace defaults to 24h, and decay is bumped to 0.91.
