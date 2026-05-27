# Category Form Fields Design

**Date:** 2026-05-27  
**Status:** Approved

## Overview

Add three new fields to the "Add Category" form: `initial_wear_duration_seconds`, `rest_multiplier`, and `risk_levels`. Currently all categories are created with hardcoded defaults from `categoryDefaults.ts`. After this change, users can configure these values per category at creation time.

---

## New Component: `DurationPickerSheet.vue`

A reusable iOS-style drum-roll picker that opens in a `kSheet` (same pattern as `IconPickerSheet`).

**Props:** `modelValue: number` (seconds), `open: boolean`  
**Emits:** `update:modelValue` (seconds), `update:open` (boolean)

### Drum columns
- Two snap-scroll columns: hours (0–23) and minutes (0–59)
- Each column uses `scroll-snap-type: y mandatory` with each item as a snap point
- The selected value is the middle (centred) row; a fixed highlight bar sits behind it
- **Infinite wrap-around:** each column's item list is tripled. On `scrollend` (with a debounced `scroll` fallback for Safari where `scrollend` is unsupported), if the scroll position is in the top or bottom third, it silently repositions to the equivalent item in the middle third. This makes 23→0 and 59→0 seamless.
- A "Done" button in the `kToolbar` commits the current position and closes the sheet

---

## Form Changes: `CategoriesSection.vue`

All three new fields are added inline below the existing icon row. No collapsing or second step.

### `catForm` state additions

```ts
catForm: {
  name: string,
  icon: string,
  initialWearSeconds: number,   // default 900 (15 min)
  restMultiplier: number,        // default 2
  bandCount: number,             // default 3, range 1–5
  crossoverPoints: number[],     // length = bandCount − 1, default [3600, 7200]
}
```

### Initial wear field

A tappable row displaying the current value formatted via `shortDuration` (e.g. `"15m"`). Tapping opens `DurationPickerSheet`. On picker close, `catForm.initialWearSeconds` is updated.

### Rest multiplier field

A plain `<input type="number" min="0" step="0.1">` inline. On blur, empty/NaN values reset to 2; negative values clamp to 0.

### Risk bands editor

An interleaved list of band rows and crossover points rendered inline:

```
[ Low        ]   ← colored band row (no interaction)
  [ 1h 0m ▾ ]   ← tappable → opens DurationPickerSheet
[ Medium     ]   ← colored band row
  [ 2h 0m ▾ ]   ← tappable → opens DurationPickerSheet
[ High       ]   ← colored band row
       [−] [+]   ← remove/add buttons
```

**Band names** are fixed by count — the user never types them:

| Count | Names |
|-------|-------|
| 1 | Medium |
| 2 | Low, High |
| 3 | Low, Medium, High |
| 4 | Lower, Low, High, Higher |
| 5 | Lowest, Low, Medium, High, Highest |

**Severity** is assigned by position (1 = first/lowest, N = last/highest). Auto-derived; not user-editable.

**Colors** — fixed per count, always green→red:

| Count | Colors (position 1 → last) |
|-------|---------------------------|
| 1 | yellow |
| 2 | green, red |
| 3 | green, yellow, red |
| 4 | green, yellow-green, orange, red |
| 5 | green, yellow-green, yellow, orange, red |

**Add/remove:** `[+]` appends a new band; `[−]` removes the last band. Both buttons are disabled at the respective limit (1 and 5). When a band is added, a new crossover point is appended at `lastCrossover + 3600` (or 3600 if no crossovers yet). When a band is removed, the last crossover point is dropped.

**Crossover validation:** On picker close, if the new value ≤ the preceding crossover point (or ≤ 0 for the first), it clamps to `precedingValue + 60` (1 minute). If the new value ≥ the following crossover point, it clamps to `followingValue − 60`. Clamping is silent.

---

## Data Mapping: `catForm` → API payload

When `onAddCategory` submits, `bandCount` and `crossoverPoints` are converted to the `risk_levels` array:

```ts
function buildRiskLevels(bandCount: number, crossoverPoints: number[]) {
  return Array.from({ length: bandCount }, (_, i) => ({
    lower: i === 0 ? null : crossoverPoints[i - 1],
    upper: i === bandCount - 1 ? null : crossoverPoints[i],
    text: BAND_NAMES[bandCount - 1][i],
    severity: i + 1,
  }));
}
```

`BAND_NAMES` is a static lookup keyed by count.

---

## Pure Utility Functions (new, in `src/utils/`)

- **`buildRiskLevels(bandCount, crossoverPoints)`** — as above
- **`bandNamesForCount(count)`** — returns the name array for a given count

Both are pure functions, tested in a new `riskLevels.test.ts` alongside `formatDuration.test.ts`.

---

## Error Handling

- Crossover clamping: silent, snaps to nearest valid value on picker close
- Rest multiplier out of range: clamps/resets on blur, no toast
- No backend changes required — existing `POST /api/categories` already accepts all fields

---

## Testing

- **Unit:** `riskLevels.test.ts` covering `buildRiskLevels` (all counts, correct lower/upper/text/severity) and `bandNamesForCount` (all five counts). Crossover clamping is component logic and is not unit-tested separately.
- **Drum-roll wrap-around:** e2e verification — scroll to the end of each column and confirm it wraps to 0
- **E2e (new test in `categories.spec.ts`):** create a category with non-default values for initial wear, rest multiplier, and risk bands (add/remove a band, set a crossover point), then verify the saved category reflects those values via the API
