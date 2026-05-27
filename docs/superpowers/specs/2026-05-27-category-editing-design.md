# Category Editing — Design Spec

**Date:** 2026-05-27  
**Status:** Approved

## Overview

Existing categories need to be editable. The edit form appears inline, directly below the category row it belongs to, and contains the same fields as the add form (name, icon, initial wear, rest multiplier, risk bands). Saving submits a PATCH request; cancelling discards changes with no server call.

---

## 1. Component Structure

### New: `CategoryForm.vue`

All form fields are extracted from `CategoriesSection.vue` into a single reusable component.

**Props:**
```ts
interface CategoryFormState {
  name: string;
  icon: string;
  initialWearSeconds: number;
  restMultiplier: number;
  bandCount: number;
  crossoverPoints: number[];
}

defineProps<{
  initialValues?: Partial<CategoryFormState>; // omit for add (defaults apply)
  submitLabel?: string;                        // default: "Save"
}>();
```

**Emits:**
```ts
defineEmits<{
  submit: [data: CategoryFormState];
  cancel: [];
}>();
```

`CategoryForm` owns its own internal `reactive` copy of the form state, seeded from `initialValues` on mount. It manages `showIconPicker` and `durationPickerTarget`/`durationPickerValue`/`showDurationPicker` internally. The submit button is disabled when `name` or `icon` is empty.

### Updated: `CategoriesSection.vue`

Becomes a coordinator. It:
- Renders the collapsible add panel using `<CategoryForm submitLabel="Add" @submit="onAddCategory" @cancel="showCatForm = false" />`
- Renders the category list; each item is optionally followed by `<CategoryForm :initialValues="..." @submit="onSaveCategory(cat.id, $event)" @cancel="editingCategoryId = null" />`
- Handles all API calls (`createCategory`, `updateCategory`) and error reporting via `showError`

---

## 2. Edit Mode State

`CategoriesSection.vue` adds:

```ts
const editingCategoryId = ref<number | null>(null);
```

Behaviour:
- Clicking **Edit** on a row sets `editingCategoryId = cat.id` and closes the add panel (`showCatForm = false`) if it's open — only one form is open at a time.
- Clicking **Edit** on the row that is *already* being edited closes the form (toggle).
- The list item's `#after` slot contains **Edit** and **Delete** buttons side by side (Delete behaviour unchanged).

---

## 3. Data Flow

### Editing

1. User clicks **Edit** → `editingCategoryId = cat.id`
2. `CategoryForm` renders below the row, pre-filled via `initialValues` (mapped from the `Category` API shape to `CategoryFormState`)
3. User edits fields and clicks **Save**
4. `CategoriesSection` maps `CategoryFormState` back to API shape and calls `updateCategory(id, data)`
5. **On success:** `editingCategoryId = null`; the `categories` reactive ref from `useCategories` already reflects the update
6. **On error:** `showError(String(e))`; form stays open for retry

### Adding (unchanged flow, new component)

1. User opens add panel, fills in `CategoryForm`
2. On `submit`: `CategoriesSection` calls `createCategory(data)`, closes panel, resets form (the form resets automatically because `CategoryForm` is re-mounted fresh each time it's shown)
3. On error: `showError(String(e))`

### Field Mapping

| `CategoryFormState` field | API field |
|---|---|
| `name` | `name` |
| `icon` | `icon` |
| `initialWearSeconds` | `initial_wear_duration_seconds` |
| `restMultiplier` | `rest_multiplier` |
| `bandCount` + `crossoverPoints` | `risk_levels` (via `buildRiskLevels`) |

Fields not exposed in the form (`rest_constant_seconds`, `break_decay_multiplier`, `break_starts_after_seconds`) use `DEFAULT_CATEGORY_FIELDS` for creates and are omitted from PATCH payloads for edits (backend ignores absent fields).

---

## 4. Error Handling

- API errors surface via `showError(String(e))` toast (existing pattern)
- Edit form stays open on error so the user can correct and retry
- Add form stays open on error (existing behaviour, unchanged)

---

## 5. Files Affected

| File | Change |
|---|---|
| `src/frontend/src/components/CategoryForm.vue` | **New** — extracted form fields |
| `src/frontend/src/components/CategoriesSection.vue` | **Updated** — uses `CategoryForm`, adds `editingCategoryId` |
| `src/frontend/src/composables/useCategories.ts` | No change (PATCH already exists via `updateCategory`) |
| `src/backend/` | No change (PATCH endpoint already exists) |
