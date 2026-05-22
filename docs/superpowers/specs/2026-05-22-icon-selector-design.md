# Icon Selector for Add Category — Design Spec

**Date:** 2026-05-22  
**Branch:** feat/ui-polish  
**Status:** Approved

---

## Overview

Replace the free-text `TextField` icon input in the Add Category form (`CategoriesSection.vue`) with a proper icon picker. Users choose from the bundled Phosphor icon set (regular weight only) via a bottom sheet. Icons are presented in their official Phosphor categories with horizontal shortcut pills and a search filter.

---

## Data Pipeline

### New dev dependency
`@phosphor-icons/core` — provides `icons: IconEntry[]` with `name`, `categories`, and `tags` per icon.

### Vite plugin
**File:** `src/frontend/vite-plugin-ph-categories.ts`

- Hook: `buildStart` (runs on both `vite dev` and `vite build`)
- Imports `icons` from `@phosphor-icons/core`
- Filters to base (regular) icons only — excludes any name ending in `-bold`, `-fill`, `-light`, `-thin`, `-duotone`
- Groups icons into `Record<string, string[]>`: category label → array of `"ph:<name>"` strings
- Writes output to `src/frontend/src/generated/ph-categories.json`
- Registered in `vite.config.ts`

**Generated file:** `src/frontend/src/generated/ph-categories.json`  
- Gitignored (regenerated at build time)  
- Approximately 60–80 KB uncompressed, ~15 KB gzipped  
- Shape: `{ "arrows": [{ "id": "ph:arrow-up", "tags": ["direction","up"] }, ...], ... }`
- Each entry includes `id` (the `ph:name` string) and `tags` (from `@phosphor-icons/core`) so the search filter can match against tags without a separate lookup

---

## Components

### `IconPickerSheet.vue` (new)

Bottom sheet containing the full icon browser.

**Props:**
- `modelValue: string` — current icon value (e.g. `"ph:sneaker"`)
- `open: boolean`

**Emits:**
- `update:modelValue` — emits `"ph:<name>"` string on selection
- `update:open` — emits `false` when sheet should close

**Layout (inside Konsta `k-sheet`, ~85% viewport height):**
1. Header row: title ("Choose Icon") + close button (×)
2. Search input — filters by icon name and tags across all categories
3. Category shortcut pills — horizontal scroll row; tapping smooth-scrolls grid to that section; active pill highlights via `IntersectionObserver`
4. Scrollable icon grid:
   - **Normal mode:** sections headed by category name, icons in a grid (~7–8 per row)
   - **Search mode:** flat grid across all categories (no section headings)
   - Currently selected icon shows a highlight ring
   - "No icons found" message when search yields no results
5. Tapping an icon emits `update:modelValue` with the icon string and emits `update:open` with `false`

**Behaviour:**
- Search input clears when the sheet closes
- `IntersectionObserver` watches category heading elements to track which section is in view, keeping the active shortcut pill in sync

### `IconPickerTrigger.vue` (new)

Button that opens the sheet, styled to match existing form fields.

**Props:**
- `modelValue: string` — current icon value

**Emits:**
- `click` — parent opens the sheet

**Display:**
- If `modelValue` is set: renders `<Icon :icon="modelValue">` at 24px + icon name (without `ph:` prefix) as small text below
- If empty: placeholder grid icon + "Choose icon" text
- Bordered button styled to match `TextField`

### `CategoriesSection.vue` (modified)

- Remove `TextField` for icon
- Add `IconPickerTrigger` (opens sheet on click) + `IconPickerSheet` (bound via `v-model` to `catForm.icon`)
- Sheet open state managed by a local `showIconPicker` ref

---

## Data Flow

```
CategoriesSection
  catForm.icon (ref<string>)
    ├── IconPickerTrigger  :modelValue="catForm.icon"  → shows current selection
    └── IconPickerSheet    v-model="catForm.icon"      → updates on selection
                           :open="showIconPicker"
                           @update:open="showIconPicker = $event"
```

---

## Storage

No backend changes required. The `icon` field on `Category` is already a plain `string` stored as-is. A Phosphor icon is stored as `"ph:icon-name"` — the same format already used and rendered throughout the app.

---

## What's Not In Scope

- Emoji support (removed from the icon field — Phosphor only)
- Icon weight selection (regular only)
- Editing an existing category's icon (no edit flow exists yet)
- Drag-to-dismiss on the sheet
