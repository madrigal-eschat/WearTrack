# Shared Form Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-duplicated markup (number inputs, duration-picker triggers, section titles, form-card wrappers) across `CategoryForm.vue`, `ItemsSection.vue`, `Settings.vue`, `DurationPickerSheet.vue`, and `IconPickerSheet.vue` with four shared components, backed by Tailwind `@theme` tokens for title font sizes.

**Architecture:** Four new single-purpose Vue SFCs in `src/frontend/src/components/`, following the existing `TextField`/`SelectField`/`IconPickerTrigger` model (label + control, `modelValue`/`update:modelValue`, minimal props). `NumberField`'s clamp/default logic is extracted to a plain `.ts` util so it's unit-testable with Vitest (no `@vue/test-utils` in this repo — components are markup-only and untested by convention; only pure-function logic gets unit tests).

**Tech Stack:** Vue 3 `<script setup>`, Tailwind CSS v4 (CSS-first `@theme`, no `tailwind.config.js`), Vitest (unit), Playwright (e2e, existing specs in `tests/e2e/categories.spec.ts` and `tests/e2e/items.spec.ts` — these must keep passing unmodified).

## Global Constraints

- Tailwind v4 CSS-first config: tokens go in `src/frontend/src/style.css` inside an `@theme` block, not a `tailwind.config.js` (none exists).
- All new components follow the existing prop/emit convention: `id?`, `label?`, `modelValue`, `defineEmits<{ 'update:modelValue': [...] }>()` — see `TextField.vue`, `SelectField.vue`, `IconPickerTrigger.vue`.
- `data-testid` attributes used by existing e2e specs must be preserved exactly: `clear-max`, `min-rest`, `add-band`, `category-form-submit`, `category-form-cancel` (all in `tests/e2e/categories.spec.ts`), plus any item-related testids in `tests/e2e/items.spec.ts`.
- No `@vue/test-utils` / component-mounting test tool exists in this repo — do not introduce one. Verify component changes via the existing Playwright e2e specs, not new unit tests, except where noted (`NumberField`'s clamp logic).
- FormCard unifies to one visual style (`mx-4 mb-3 p-3 bg-white border border-gray-200 rounded-2xl space-y-2`) — the ItemsSection edit-card's distinct gray-50/rounded-xl/mx-2 look is intentionally removed.

---

## File Structure

- Create: `src/frontend/src/utils/clampNumber.ts` — pure clamp/default function, unit-tested.
- Create: `src/frontend/src/utils/clampNumber.test.ts`
- Modify: `src/frontend/src/style.css` — add `@theme` block with 4 title font-size tokens.
- Create: `src/frontend/src/components/SectionTitle.vue`
- Create: `src/frontend/src/components/NumberField.vue`
- Create: `src/frontend/src/components/DurationTrigger.vue`
- Create: `src/frontend/src/components/FormCard.vue`
- Modify: `src/frontend/src/components/FormSectionHeader.vue` — use `SectionTitle` internally.
- Modify: `src/frontend/src/views/Settings.vue` — use `SectionTitle` for the page header.
- Modify: `src/frontend/src/components/DurationPickerSheet.vue` — use `SectionTitle` for sheet title.
- Modify: `src/frontend/src/components/IconPickerSheet.vue` — use `SectionTitle` for sheet title and group headings.
- Modify: `src/frontend/src/components/ItemsSection.vue` — use `SectionTitle` (group), `NumberField`, `FormCard`.
- Modify: `src/frontend/src/components/CategoryForm.vue` — use `NumberField`, `DurationTrigger`, `FormCard`.

---

## Task 1: Title tokens + `SectionTitle.vue`

**Files:**
- Modify: `src/frontend/src/style.css`
- Create: `src/frontend/src/components/SectionTitle.vue`

**Interfaces:**
- Produces: `SectionTitle` component, prop `variant: 'page' | 'section' | 'sheet' | 'group'`, renders a `<span>` with the title text via default slot.

- [ ] **Step 1: Add theme tokens**

Edit `src/frontend/src/style.css` to:

```css
@import "tailwindcss";
@import "konsta/theme.css";
@source "../node_modules/konsta";

@theme {
  --font-size-title-page: 1.125rem;
  --font-size-title-section: 1.0625rem;
  --font-size-title-sheet: 0.875rem;
  --font-size-title-group: 0.75rem;
}
```

- [ ] **Step 2: Create `SectionTitle.vue`**

```vue
<template>
  <span :class="classes"><slot /></span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ variant: 'page' | 'section' | 'sheet' | 'group' }>();

const classes = computed(() => ({
  page: 'text-title-page font-semibold',
  section: 'text-title-section font-semibold text-black/60 dark:text-white/60',
  sheet: 'text-title-sheet font-semibold',
  group: 'text-title-group font-semibold text-gray-500 uppercase tracking-wide',
}[props.variant]));
</script>
```

- [ ] **Step 3: Verify it builds**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/style.css src/frontend/src/components/SectionTitle.vue
git commit -m "feat(frontend): add title tokens and SectionTitle component"
```

---

## Task 2: Apply `SectionTitle` to all 5 call sites

**Files:**
- Modify: `src/frontend/src/components/FormSectionHeader.vue`
- Modify: `src/frontend/src/views/Settings.vue`
- Modify: `src/frontend/src/components/DurationPickerSheet.vue`
- Modify: `src/frontend/src/components/IconPickerSheet.vue`
- Modify: `src/frontend/src/components/ItemsSection.vue`

**Interfaces:**
- Consumes: `SectionTitle` from Task 1 (`variant` prop as defined above).

- [ ] **Step 1: `FormSectionHeader.vue`**

Replace:

```html
<span class="font-semibold text-[17px] text-black/60 dark:text-white/60">{{ title }}</span>
```

with:

```html
<SectionTitle variant="section">{{ title }}</SectionTitle>
```

Add `import SectionTitle from './SectionTitle.vue';` to the `<script setup>` block.

- [ ] **Step 2: `Settings.vue`**

Replace:

```html
<span class="text-lg font-semibold">Settings</span>
```

with:

```html
<SectionTitle variant="page">Settings</SectionTitle>
```

Add the import.

- [ ] **Step 3: `DurationPickerSheet.vue`**

Replace:

```html
<span class="font-semibold text-sm">Duration</span>
```

with:

```html
<SectionTitle variant="sheet">Duration</SectionTitle>
```

Add the import.

- [ ] **Step 4: `IconPickerSheet.vue` — sheet title**

Replace:

```html
<span class="font-semibold whitespace-nowrap text-sm">Choose Icon</span>
```

with:

```html
<SectionTitle variant="sheet">Choose Icon</SectionTitle>
```

- [ ] **Step 5: `IconPickerSheet.vue` — group heading**

Replace:

```html
<h3
  :ref="(el) => setHeadingRef(cat, el)"
  :data-category="cat"
  class="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-2"
>
  {{ cat }}
</h3>
```

with:

```html
<h3
  :ref="(el) => setHeadingRef(cat, el)"
  :data-category="cat"
  class="mt-4 mb-2"
>
  <SectionTitle variant="group">{{ cat }}</SectionTitle>
</h3>
```

Add `import SectionTitle from './SectionTitle.vue';` to `IconPickerSheet.vue`'s script block (only one import needed for both usages in this file).

- [ ] **Step 6: `ItemsSection.vue` — group heading**

Replace:

```html
<div class="px-4 mt-4 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
  {{ cat.name }}
</div>
```

with:

```html
<div class="px-4 mt-4 mb-1">
  <SectionTitle variant="group">{{ cat.name }}</SectionTitle>
</div>
```

Add `import SectionTitle from './SectionTitle.vue';` to `ItemsSection.vue`.

- [ ] **Step 7: Run e2e regression check**

Run: `cd src/frontend && npx playwright test tests/e2e/categories.spec.ts tests/e2e/items.spec.ts`
Expected: all pass (these specs cover `FormSectionHeader`-driven toggles and category/item group listings — no assertions on font classes, so no test changes expected).

- [ ] **Step 8: Commit**

```bash
git add src/frontend/src/components/FormSectionHeader.vue src/frontend/src/views/Settings.vue src/frontend/src/components/DurationPickerSheet.vue src/frontend/src/components/IconPickerSheet.vue src/frontend/src/components/ItemsSection.vue
git commit -m "refactor(frontend): apply SectionTitle across sheet/page/group headers"
```

---

## Task 3: `clampNumber` util + `NumberField.vue`

**Files:**
- Create: `src/frontend/src/utils/clampNumber.ts`
- Create: `src/frontend/src/utils/clampNumber.test.ts`
- Create: `src/frontend/src/components/NumberField.vue`

**Interfaces:**
- Produces: `clampNumber(raw: string, opts: { min?: number; max?: number; default: number }): number`
- Produces: `NumberField` component — props `id?: string`, `label?: string`, `modelValue: number`, `min?: number`, `max?: number`, `default: number`, `step?: number`; emits `update:modelValue: [value: number]`.

- [ ] **Step 1: Write failing test for `clampNumber`**

Create `src/frontend/src/utils/clampNumber.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clampNumber } from './clampNumber.js';

describe('clampNumber', () => {
  it('returns default for empty string', () => {
    expect(clampNumber('', { default: 2 })).toBe(2);
  });

  it('returns default for NaN input', () => {
    expect(clampNumber('abc', { default: 2 })).toBe(2);
  });

  it('clamps below min up to min', () => {
    expect(clampNumber('-5', { min: 0, default: 2 })).toBe(0);
  });

  it('clamps above max down to max', () => {
    expect(clampNumber('5', { max: 0.99, default: 0.91 })).toBe(0.99);
  });

  it('passes through in-range values unchanged', () => {
    expect(clampNumber('0.5', { min: 0, max: 0.99, default: 0.91 })).toBe(0.5);
  });

  it('passes through when no min/max given', () => {
    expect(clampNumber('7', { default: 1 })).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/frontend && npx vitest run src/utils/clampNumber.test.ts`
Expected: FAIL — `Cannot find module './clampNumber.js'`

- [ ] **Step 3: Implement `clampNumber`**

Create `src/frontend/src/utils/clampNumber.ts`:

```ts
export function clampNumber(
  raw: string,
  opts: { min?: number; max?: number; default: number }
): number {
  const val = Number(raw);
  if (raw.trim() === '' || isNaN(val)) return opts.default;
  let result = val;
  if (opts.min !== undefined) result = Math.max(opts.min, result);
  if (opts.max !== undefined) result = Math.min(opts.max, result);
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/frontend && npx vitest run src/utils/clampNumber.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Create `NumberField.vue`**

```vue
<template>
  <div>
    <label v-if="label" :for="id" class="block text-sm font-medium text-gray-700 mb-1">{{ label }}</label>
    <input
      :id="id"
      :value="modelValue"
      @input="$emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
      @blur="onBlur"
      type="number"
      :min="min"
      :max="max"
      :step="step ?? 1"
      class="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </div>
</template>

<script setup lang="ts">
import { clampNumber } from '../utils/clampNumber.js';

const props = defineProps<{
  id?: string;
  label?: string;
  modelValue: number;
  min?: number;
  max?: number;
  default: number;
  step?: number;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();

function onBlur(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  emit('update:modelValue', clampNumber(raw, { min: props.min, max: props.max, default: props.default }));
}
</script>
```

- [ ] **Step 6: Verify it builds**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 7: Commit**

```bash
git add src/frontend/src/utils/clampNumber.ts src/frontend/src/utils/clampNumber.test.ts src/frontend/src/components/NumberField.vue
git commit -m "feat(frontend): add clampNumber util and NumberField component"
```

---

## Task 4: Apply `NumberField` to `CategoryForm.vue` and `ItemsSection.vue`

**Files:**
- Modify: `src/frontend/src/components/CategoryForm.vue`
- Modify: `src/frontend/src/components/ItemsSection.vue`

**Interfaces:**
- Consumes: `NumberField` from Task 3.

- [ ] **Step 1: `CategoryForm.vue` — rest multiplier**

Replace (lines ~31-37):

```html
<div>
  <label for="cat-rest-mult" class="block text-sm font-medium text-gray-700 mb-1">Rest multiplier</label>
  <input id="cat-rest-mult" :value="catForm.restMultiplier"
    @input="catForm.restMultiplier = Number(($event.target as HTMLInputElement).value)" @blur="onRestMultiplierBlur"
    type="number" min="0" step="0.1"
    class="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
</div>
```

with:

```html
<NumberField
  id="cat-rest-mult"
  label="Rest multiplier"
  v-model="catForm.restMultiplier"
  :min="0"
  :default="2"
  :step="0.1"
/>
```

- [ ] **Step 2: `CategoryForm.vue` — break decay**

Replace (lines ~56-62):

```html
<div>
  <label for="cat-decay" class="block text-sm font-medium text-gray-700 mb-1">Break decay / day</label>
  <input id="cat-decay" :value="catForm.breakDecayMultiplier"
    @input="catForm.breakDecayMultiplier = Number(($event.target as HTMLInputElement).value)" @blur="onDecayBlur"
    type="number" min="0" max="0.99" step="0.01"
    class="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
</div>
```

with:

```html
<NumberField
  id="cat-decay"
  label="Break decay / day"
  v-model="catForm.breakDecayMultiplier"
  :min="0"
  :max="0.99"
  :default="0.91"
  :step="0.01"
/>
```

- [ ] **Step 3: Remove now-unused blur handlers and import**

In `CategoryForm.vue`'s `<script setup>`:
- Delete the `onRestMultiplierBlur` and `onDecayBlur` functions entirely.
- Add `import NumberField from './NumberField.vue';`

- [ ] **Step 4: `ItemsSection.vue` — add-item difficulty**

Replace (lines ~30-39):

```html
<div>
  <label for="item-difficulty" class="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
  <input
    id="item-difficulty"
    v-model.number="itemForm.difficulty_multiplier"
    type="number" min="0.1" step="0.1"
    class="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
  />
</div>
```

with:

```html
<NumberField
  id="item-difficulty"
  label="Difficulty"
  v-model="itemForm.difficulty_multiplier"
  :min="0.1"
  :default="1.0"
  :step="0.1"
/>
```

- [ ] **Step 5: `ItemsSection.vue` — edit-item difficulty**

Replace (lines ~96-105):

```html
<div>
  <label for="edit-item-difficulty" class="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
  <input
    id="edit-item-difficulty"
    v-model.number="editForm.difficulty_multiplier"
    type="number" min="0.1" step="0.1"
    class="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
  />
</div>
```

with:

```html
<NumberField
  id="edit-item-difficulty"
  label="Difficulty"
  v-model="editForm.difficulty_multiplier"
  :min="0.1"
  :default="1.0"
  :step="0.1"
/>
```

Add `import NumberField from './NumberField.vue';` to `ItemsSection.vue`.

- [ ] **Step 6: Run e2e regression check**

Run: `cd src/frontend && npx playwright test tests/e2e/categories.spec.ts tests/e2e/items.spec.ts`
Expected: all pass. If any test types into `#cat-rest-mult`, `#cat-decay`, `#item-difficulty`, or `#edit-item-difficulty` and asserts blur-triggered clamping, it must still pass unmodified since `NumberField`'s blur behavior matches the removed handlers' semantics (empty/NaN → default, out-of-range → clamped).

- [ ] **Step 7: Commit**

```bash
git add src/frontend/src/components/CategoryForm.vue src/frontend/src/components/ItemsSection.vue
git commit -m "refactor(frontend): apply NumberField to CategoryForm and ItemsSection"
```

---

## Task 5: `DurationTrigger.vue`

**Files:**
- Create: `src/frontend/src/components/DurationTrigger.vue`

**Interfaces:**
- Produces: `DurationTrigger` component — props `id?: string`, `label?: string`, `displayValue: string`, `disabled?: boolean`, `clearable?: boolean`, `testid?: string`, `clearTestid?: string`; emits `click: []`, `clear: []`.

- [ ] **Step 1: Create the component**

```vue
<template>
  <div>
    <label v-if="label" :for="id" class="block text-sm font-medium text-gray-700 mb-1">{{ label }}</label>
    <div class="flex items-center gap-1">
      <button
        :id="id"
        type="button"
        :disabled="disabled"
        :data-testid="testid"
        class="flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-40"
        @click="$emit('click')"
      >
        <span>{{ displayValue }}</span><span class="text-gray-400">▾</span>
      </button>
      <button
        v-if="clearable"
        type="button"
        :data-testid="clearTestid"
        class="text-xs text-gray-400 underline"
        @click="$emit('clear')"
      >clear</button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  id?: string;
  label?: string;
  displayValue: string;
  disabled?: boolean;
  clearable?: boolean;
  testid?: string;
  clearTestid?: string;
}>();
defineEmits<{ click: []; clear: [] }>();
</script>
```

- [ ] **Step 2: Verify it builds**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/components/DurationTrigger.vue
git commit -m "feat(frontend): add DurationTrigger component"
```

---

## Task 6: Apply `DurationTrigger` to `CategoryForm.vue`

**Files:**
- Modify: `src/frontend/src/components/CategoryForm.vue`

**Interfaces:**
- Consumes: `DurationTrigger` from Task 5.

- [ ] **Step 1: Target wear trigger**

Replace (lines ~12-18):

```html
<div>
  <label class="block text-sm font-medium text-gray-700 mb-1">Target wear</label>
  <button type="button" class="flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
    @click="openDurationPicker('target')">
    <span>{{ shortDuration(catForm.initialWearTargetSeconds) }}</span><span class="text-gray-400">▾</span>
  </button>
</div>
```

with:

```html
<DurationTrigger
  label="Target wear"
  :displayValue="shortDuration(catForm.initialWearTargetSeconds)"
  @click="openDurationPicker('target')"
/>
```

- [ ] **Step 2: Maximum wear trigger (clearable)**

Replace (lines ~19-30):

```html
<div>
  <label class="block text-sm font-medium text-gray-700 mb-1">Maximum wear</label>
  <div class="flex items-center gap-1">
    <button type="button" class="flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
      @click="openDurationPicker('max')">
      <span>{{ catForm.initialWearMaxSeconds === null ? 'None' : shortDuration(catForm.initialWearMaxSeconds) }}</span>
      <span class="text-gray-400">▾</span>
    </button>
    <button v-if="catForm.initialWearMaxSeconds !== null" type="button" data-testid="clear-max"
      class="text-xs text-gray-400 underline" @click="catForm.initialWearMaxSeconds = null">clear</button>
  </div>
</div>
```

with:

```html
<DurationTrigger
  label="Maximum wear"
  :displayValue="catForm.initialWearMaxSeconds === null ? 'None' : shortDuration(catForm.initialWearMaxSeconds)"
  :clearable="catForm.initialWearMaxSeconds !== null"
  clearTestid="clear-max"
  @click="openDurationPicker('max')"
  @clear="catForm.initialWearMaxSeconds = null"
/>
```

- [ ] **Step 3: Minimum rest trigger (disabled)**

Replace (lines ~41-48):

```html
<div>
  <label class="block text-sm font-medium text-gray-700 mb-1">Minimum rest period</label>
  <button type="button" :disabled="catForm.initialWearMaxSeconds === null" data-testid="min-rest"
    class="flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-40"
    @click="openDurationPicker('minRest')">
    <span>{{ shortDuration(catForm.minimumRestSeconds) }}</span><span class="text-gray-400">▾</span>
  </button>
</div>
```

with:

```html
<DurationTrigger
  label="Minimum rest period"
  :displayValue="shortDuration(catForm.minimumRestSeconds)"
  :disabled="catForm.initialWearMaxSeconds === null"
  testid="min-rest"
  @click="openDurationPicker('minRest')"
/>
```

- [ ] **Step 4: Break grace time trigger**

Replace (lines ~49-55):

```html
<div>
  <label class="block text-sm font-medium text-gray-700 mb-1">Break grace time</label>
  <button type="button" class="flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
    @click="openDurationPicker('grace')">
    <span>{{ shortDuration(catForm.breakGraceSeconds) }}</span><span class="text-gray-400">▾</span>
  </button>
</div>
```

with:

```html
<DurationTrigger
  label="Break grace time"
  :displayValue="shortDuration(catForm.breakGraceSeconds)"
  @click="openDurationPicker('grace')"
/>
```

- [ ] **Step 5: Add import**

Add `import DurationTrigger from './DurationTrigger.vue';` to `CategoryForm.vue`'s `<script setup>`.

- [ ] **Step 6: Run e2e regression check**

Run: `cd src/frontend && npx playwright test tests/e2e/categories.spec.ts`
Expected: all pass, including any test asserting `[data-testid="clear-max"]` and `[data-testid="min-rest"]` presence/disabled-state/click behavior.

- [ ] **Step 7: Commit**

```bash
git add src/frontend/src/components/CategoryForm.vue
git commit -m "refactor(frontend): apply DurationTrigger to CategoryForm"
```

---

## Task 7: `FormCard.vue` and apply to all 3 call sites

**Files:**
- Create: `src/frontend/src/components/FormCard.vue`
- Modify: `src/frontend/src/components/CategoryForm.vue`
- Modify: `src/frontend/src/components/ItemsSection.vue`

**Interfaces:**
- Produces: `FormCard` component — no props, renders default slot inside the card wrapper.

- [ ] **Step 1: Create `FormCard.vue`**

```vue
<template>
  <div class="mx-4 mb-3 p-3 bg-white border border-gray-200 rounded-2xl space-y-2">
    <slot />
  </div>
</template>

<script setup lang="ts">
</script>
```

- [ ] **Step 2: `CategoryForm.vue` root wrapper**

`CategoryForm.vue`'s template root is:

```html
<div class="mx-4 mb-3 p-3 bg-white border border-gray-200 rounded-2xl space-y-2">
  ...
</div>
```

Replace the outer `<div>` tag with `<FormCard>` (and closing `</div>` with `</FormCard>`), keeping all inner content unchanged. Add `import FormCard from './FormCard.vue';`.

- [ ] **Step 3: `ItemsSection.vue` add-item card**

Replace:

```html
<div v-if="showItemForm && categories.length > 0" class="mx-4 mb-3 p-3 bg-white border border-gray-200 rounded-2xl space-y-2">
```

with:

```html
<FormCard v-if="showItemForm && categories.length > 0">
```

and its matching closing `</div>` with `</FormCard>`.

- [ ] **Step 4: `ItemsSection.vue` edit-item card**

Replace:

```html
<div v-if="editingItemId === item.id" class="mx-2 mb-2 p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
```

with:

```html
<FormCard v-if="editingItemId === item.id">
```

and its matching closing `</div>` with `</FormCard>`. Add `import FormCard from './FormCard.vue';` to `ItemsSection.vue`.

- [ ] **Step 5: Run full e2e regression check**

Run: `cd src/frontend && npx playwright test tests/e2e/categories.spec.ts tests/e2e/items.spec.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/components/FormCard.vue src/frontend/src/components/CategoryForm.vue src/frontend/src/components/ItemsSection.vue
git commit -m "refactor(frontend): add FormCard and unify add/edit card styling"
```

---

## Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `cd src/frontend && npm run lint`
Expected: no errors.

- [ ] **Step 3: Full unit test suite**

Run: `cd src/frontend && npx vitest run`
Expected: all pass, including the new `clampNumber.test.ts`.

- [ ] **Step 4: Full e2e suite**

Run: `cd src/frontend && npx playwright test`
Expected: all pass.

- [ ] **Step 5: Manual visual check**

Run: `cd src/frontend && npm run dev`, open the app, and visually confirm:
- Settings page title, "Items"/"Categories" section headers, sheet titles (icon/duration pickers), and category group labels now render at consistent, deliberate sizes.
- Category form's target/max/min-rest/grace duration buttons and rest-multiplier/decay number fields behave identically to before (including the "clear" link on max wear, and disabled state on min-rest until max is set).
- Add-item and edit-item cards now share the same white/rounded-2xl look.
