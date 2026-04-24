# Color Picker for Items — Design Spec

**Date:** 2026-04-24

## Overview

Add a color picker to the item create/edit form. Colors are selected in oklch color space, clamped to a lightness threshold that ensures good contrast against a light background. Colors are stored as valid CSS oklch strings.

---

## Data Model

The `color` column in the `items` table already exists as TEXT. A new migration changes the stored format convention from hex strings to valid CSS oklch strings (e.g. `oklch(0.45 0.15 230)`).

- No column type change required.
- Existing rows are reset to the neutral default `oklch(0.55 0.15 240)` — hex→oklch conversion is not feasible in SQLite.
- The backend treats `color` as an opaque string. No backend changes are needed beyond accepting oklch strings through existing validation (field must be present).

---

## Contrast Clamping

Contrast clamping is a frontend-only concern. A constant `MAX_LIGHTNESS = 0.55` (oklch L on the 0–1 scale) is the heuristic threshold — colors at L ≤ 0.55 are dark enough to read clearly on a light/white background without requiring a WCAG luminance calculation.

Lightness is never user-adjustable. All swatches and slider-picked colors use `MAX_LIGHTNESS` as their L value.

---

## Components

### `ColorPicker.vue`

A new component used in the item create/edit form in `Items.vue`.

**Props/emits:** Standard Vue v-model — `modelValue: string` (CSS oklch string), emits `update:modelValue`.

**Trigger:** A small color circle (`w-3 h-3 rounded-full`) next to the name field. Tapping opens a Konsta `Popover`.

**Popover contents:**

1. **Preset swatches row** — 12 swatches at hues 0°, 30°, 60°, …, 330°, all at chroma `0.15` and `MAX_LIGHTNESS`. The active swatch is indicated with a ring/check. Selecting a swatch emits the corresponding oklch string.

2. **Advanced disclosure** — a toggle that expands to show two range sliders:
   - Hue: 0–360
   - Chroma: 0–0.3
   
   Both update the color in real-time. Lightness remains fixed at `MAX_LIGHTNESS`. The emitted value is assembled as `oklch(${MAX_LIGHTNESS} ${chroma} ${hue})`.

### `randomSwatchColor()`

A helper (in a composable or utility file) that returns one of the 12 preset swatch oklch strings chosen at random. Called by `Items.vue` when initializing the create form, replacing the hardcoded `#3b82f6` default.

---

## Migration

A new migration file resets all existing `items.color` values to `oklch(0.55 0.15 240)` (a valid swatch color at `MAX_LIGHTNESS`).

---

## Testing

New tests added to `src/frontend/tests/e2e/items.spec.ts`:

1. **Swatch selection** — create an item, open the color popover, click a swatch, save. Assert the item's color circle `background` style contains `oklch`.

2. **Random default color** — create 4 items in sequence. Assert that at least one item's color circle differs from the others (verifies the random default is not always the same value).

3. **Advanced sliders** — create an item, open the color popover, expand the Advanced section, set the hue slider to a specific value and the chroma slider to a specific value, save. Assert the item's color circle `background` style contains an `oklch` string reflecting both the chosen hue and chroma values.
