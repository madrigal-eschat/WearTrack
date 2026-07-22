# Frontend Component Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break up `CategoryForm.vue`, `ItemsSection.vue`, `IconPickerSheet.vue`, `Log.vue`, and `ActionPane.vue` into focused sub-components using the SLOC/heuristic policy from the design spec, generalize delete-confirmation into one shared `<DeleteButton>`, and enforce a template-size lint gate.

**Architecture:** Presentational sub-components take primitive/array props and emit events; parent components keep owning reactive form state (matching the codebase's existing `CategoryForm`/`TextField`/`NumberField` conventions — primitive `modelValue` + `update:modelValue`, never mutating object props). No new test-runner tooling is introduced — this codebase has no component-level unit tests today (only composable/util unit tests via Vitest, plus Playwright e2e), so verification for each task is: existing unit tests stay green, the relevant Playwright e2e spec(s) stay green, `npm run lint` and a manual smoke check in the browser.

**Tech Stack:** Vue 3 (`<script setup lang="ts">`), Konsta UI, Vitest, Playwright, ESLint (`eslint-plugin-vue`).

## Global Constraints

- Scope: `src/frontend/src/components/**`, `src/frontend/src/views/Log.vue`, `src/frontend/eslint.config.js`, `CLAUDE.md`, and the Playwright specs in `src/frontend/tests/e2e/**` that exercise delete flows.
- No behavior change, **except** the intentional upgrade of Items/Categories delete confirmation from the native `confirm()` dialog to a `k-dialog` (this is a visible UI change called for in the design spec).
- New/changed components follow existing prop conventions: primitive `modelValue` + `update:modelValue` (see `TextField.vue`, `NumberField.vue`); never pass a whole reactive object as a prop and mutate its fields from the child (that trips `vue/no-mutating-props`, which is enabled via `flat/essential`).
- No new test framework or dependency — do not add `@vue/test-utils`. Verification is via existing Vitest unit tests, existing/updated Playwright specs, `npm run lint`, and manual smoke checks.
- The Log.vue `EditSessionDialog` bug (mentioned in the design spec) is explicitly out of scope — extract the dialog as-is, do not fix it.

---

### Task 1: Add template-size lint gate and CLAUDE.md guidance

**Files:**
- Modify: `src/frontend/eslint.config.js`
- Modify: `CLAUDE.md`

**Interfaces:** None (config/docs only).

- [ ] **Step 1: Add the `vue/max-lines-per-block` rule**

In `src/frontend/eslint.config.js`, add a `rules` entry inside the existing rules block (the one that currently turns off `vue/max-attributes-per-line` etc.):

```js
  {
    rules: {
      'vue/max-attributes-per-line': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/max-lines-per-block': ['error', { template: 200, skipBlankLines: true }],
    },
  },
```

- [ ] **Step 2: Run lint to confirm it currently fails on the known offenders**

Run: `cd src/frontend && npm run lint`
Expected: no errors yet, since `ActionPane.vue` (162 lines) and `CategoryForm.vue` (158 lines) are both under 200 as measured today — the rule is a forward-looking guard, not a currently-failing check. Confirm this by temporarily setting the limit to `100` locally, observing errors on `ActionPane.vue`, `CategoryForm.vue`, `ItemsSection.vue`, `Log.vue`, and `IconPickerSheet.vue`, then reverting to `200`. This is a one-time sanity check, not a permanent test — do not commit the temporary `100` value.

- [ ] **Step 3: Add CLAUDE.md guidance**

Add this section to `/Users/telyn/Code/weartrack/CLAUDE.md` (after the existing "Frontend HTTP requests" section):

```markdown
## Vue component size

`vue/max-lines-per-block` fails the build at 200 template lines — that's a hard cap, not a target. Start considering extracting a sub-component once a `<template>` block passes **100** lines. Extract when either is true:

- There's an obvious, easily-named cohesive group (e.g. a set of risk-band rows → `<RiskBands>`).
- There's a large, near-symmetric `v-if`/`v-else` pair (both branches substantial).

This is a judgment call for the author/reviewer — ESLint only enforces the 200-line hard cap.
```

- [ ] **Step 4: Commit**

```bash
git add src/frontend/eslint.config.js CLAUDE.md
git commit -m "chore(lint): add template-size gate and component-size guidance"
```

---

### Task 2: Extract `<RiskBands>` from CategoryForm.vue

**Files:**
- Create: `src/frontend/src/components/RiskBands.vue`
- Modify: `src/frontend/src/components/CategoryForm.vue`

**Interfaces:**
- Consumes: `bandNamesForCount`, `bandColorsForCount` from `src/frontend/src/utils/riskLevels.js`; `shortDuration` from `src/frontend/src/utils/formatDuration.js`.
- Produces: `RiskBands` component — props `{ bandCount: number; crossoverPoints: number[] }`, emits `{ 'add-band': []; 'remove-band': []; 'edit-crossover': [index: number] }`.

- [ ] **Step 1: Create the component**

Create `src/frontend/src/components/RiskBands.vue`:

```vue
<template>
  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1">Risk bands</label>
    <p class="text-xs text-gray-400 mb-2">
      Bands are triggered by cumulative wear time. Tap a threshold (▾) to change where one band ends and the next begins.
    </p>
    <div class="space-y-1">
      <template v-for="(bandName, i) in bandNames" :key="i">
        <div
          class="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium"
          :class="bandColors[i]"
        >
          <span>{{ bandName }}</span>
          <div v-if="i === bandCount - 1" class="flex gap-1">
            <button
              type="button"
              class="w-7 h-7 rounded-full border border-gray-400 flex items-center justify-center text-gray-600 disabled:opacity-30"
              :disabled="bandCount <= 1"
              @click="$emit('remove-band')"
            >−</button>
            <button
              type="button"
              data-testid="add-band"
              class="w-7 h-7 rounded-full border border-gray-400 flex items-center justify-center text-gray-600 disabled:opacity-30"
              :disabled="bandCount >= 5"
              @click="$emit('add-band')"
            >+</button>
          </div>
        </div>
        <button
          v-if="i < bandCount - 1"
          type="button"
          class="flex items-center gap-1 px-3 text-sm text-gray-500"
          @click="$emit('edit-crossover', i)"
        >
          <span>{{ shortDuration(crossoverPoints[i]) }}</span>
          <span>▾</span>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { bandNamesForCount, bandColorsForCount } from '../utils/riskLevels.js';
import { shortDuration } from '../utils/formatDuration.js';

const props = defineProps<{ bandCount: number; crossoverPoints: number[] }>();
defineEmits<{ 'add-band': []; 'remove-band': []; 'edit-crossover': [index: number] }>();

const bandNames = computed(() => bandNamesForCount(props.bandCount));
const bandColors = computed(() => bandColorsForCount(props.bandCount));
</script>
```

- [ ] **Step 2: Wire it into CategoryForm.vue**

In `src/frontend/src/components/CategoryForm.vue`, replace the entire "Risk bands" `<div>` block (the one starting `<!-- Risk bands -->` and ending just before `</template>` that closes the `v-if="catForm.type === 'duration'"` block) with:

```vue
      <RiskBands
        :band-count="catForm.bandCount"
        :crossover-points="catForm.crossoverPoints"
        @add-band="addBand"
        @remove-band="removeBand"
        @edit-crossover="openDurationPicker"
      />
```

Add the import in the `<script setup>` block:

```ts
import RiskBands from './RiskBands.vue';
```

Remove the now-unused `bandNames` and `bandColors` computed properties from `CategoryForm.vue`'s script (they moved into `RiskBands.vue`) — but keep `bandNamesForCount`/`bandColorsForCount` imports removed only if nothing else in the file uses them (nothing else does). Keep `addBand`, `removeBand`, and `openDurationPicker` in `CategoryForm.vue` unchanged — they still own `catForm` directly.

- [ ] **Step 3: Manual smoke check**

Run: `cd src/frontend && npm run dev`, open the app, go to Settings → add a category with type "Duration", confirm the risk bands section renders, the `+`/`−` buttons add/remove bands, and clicking a crossover value opens the duration picker and updates the band boundary. Stop the dev server after checking.

- [ ] **Step 4: Run lint and unit tests**

Run: `cd src/frontend && npm run lint && npm run test:ci`
Expected: zero lint errors, all existing unit tests pass (no unit test targets `CategoryForm.vue` directly today, so none should be affected).

- [ ] **Step 5: Run the categories e2e spec**

Run: `cd src/frontend && npx playwright test tests/e2e/categories.spec.ts`
Expected: PASS (this spec exercises category creation/editing, including risk-band-bearing duration categories)

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/components/RiskBands.vue src/frontend/src/components/CategoryForm.vue
git commit -m "refactor(frontend): extract RiskBands from CategoryForm"
```

---

### Task 3: Extract `<DurationCategoryFields>` from CategoryForm.vue

**Files:**
- Create: `src/frontend/src/components/DurationCategoryFields.vue`
- Modify: `src/frontend/src/components/CategoryForm.vue`

**Note on scope:** The design spec named `<DurationCategoryFields>` / `<RotationCategoryFields>` as a symmetric pair. Looking at the actual template, the rotation-only content is a single `NumberField` (consecutive wear days) sitting inline in the same flex row as the always-shown "Target wear" trigger — too small and too layout-coupled to extract without changing the row's visual grouping. Only the **duration-only** content is a large, cleanly-separable block (the minimum-rest/grace/half-life row, the explanatory paragraph, and risk bands). This task extracts that block as `<DurationCategoryFields>` (which internally renders `<RiskBands>`); the rotation-only field stays inline in `CategoryForm.vue`.

**Interfaces:**
- Consumes: `RiskBands` (from Task 2); `DurationTrigger`, `NumberField` (existing components); `shortDuration` (`src/frontend/src/utils/formatDuration.js`).
- Produces: `DurationCategoryFields` component — props:
  ```ts
  {
    maxWearDisplay: string;
    hasMaxWear: boolean;
    minimumRestDisplay: string;
    breakGraceDisplay: string;
    restMultiplier: number;
    breakDecayHalfLifeDays: number;
    defaultHalfLifeDays: number;
    bandCount: number;
    crossoverPoints: number[];
  }
  ```
  emits:
  ```ts
  {
    'update:restMultiplier': [value: number];
    'update:breakDecayHalfLifeDays': [value: number];
    'open-duration-picker': [target: 'max' | 'minRest' | 'grace' | number];
    'clear-max': [];
    'add-band': [];
    'remove-band': [];
  }
  ```

- [ ] **Step 1: Create the component**

Create `src/frontend/src/components/DurationCategoryFields.vue`:

```vue
<template>
  <DurationTrigger
    label="Minimum rest period"
    :displayValue="minimumRestDisplay"
    :disabled="!hasMaxWear"
    testid="min-rest"
    @click="$emit('open-duration-picker', 'minRest')"
  />
  <div class="flex gap-4 flex-wrap items-end">
    <DurationTrigger
      label="Break grace time"
      :displayValue="breakGraceDisplay"
      @click="$emit('open-duration-picker', 'grace')"
    />
    <NumberField
      id="cat-decay"
      label="Break half-life (days)"
      :modelValue="breakDecayHalfLifeDays"
      @update:modelValue="$emit('update:breakDecayHalfLifeDays', $event)"
      :min="0.1"
      :default="defaultHalfLifeDays"
      :step="0.1"
    />
  </div>
  <p class="text-xs text-gray-400 -mt-1">
    <strong>Target</strong> is the goal duration; <strong>Maximum</strong> (optional) is the hard ceiling.
    Minimum rest only applies when a maximum is set.
  </p>
  <RiskBands
    :band-count="bandCount"
    :crossover-points="crossoverPoints"
    @add-band="$emit('add-band')"
    @remove-band="$emit('remove-band')"
    @edit-crossover="(i) => $emit('open-duration-picker', i)"
  />
</template>

<script setup lang="ts">
import DurationTrigger from './DurationTrigger.vue';
import NumberField from './NumberField.vue';
import RiskBands from './RiskBands.vue';

defineProps<{
  hasMaxWear: boolean;
  minimumRestDisplay: string;
  breakGraceDisplay: string;
  breakDecayHalfLifeDays: number;
  defaultHalfLifeDays: number;
  bandCount: number;
  crossoverPoints: number[];
}>();
defineEmits<{
  'update:breakDecayHalfLifeDays': [value: number];
  'open-duration-picker': [target: 'minRest' | 'grace' | number];
  'add-band': [];
  'remove-band': [];
}>();
</script>
```

Note: `restMultiplier`, `maxWearDisplay`, and `clear-max` from the interface above turned out to belong to Row 1 (the "Maximum wear"/"Rest multiplier" fields), which stay inline in `CategoryForm.vue` per the scope note — drop them from this component's actual props/emits. The props/emits list is what's shown in the code block above.

- [ ] **Step 2: Wire it into CategoryForm.vue**

In `src/frontend/src/components/CategoryForm.vue`, replace the entire block from `<div class="flex gap-4 flex-wrap items-end">` (the "Minimum rest period" row) through the closing `</template>` of `v-if="catForm.type === 'duration'"` (i.e. the minimum-rest row, the explanatory paragraph, and the risk-bands block — but leave the `<RiskBands>` usage removed since it now lives inside `DurationCategoryFields`) with:

```vue
      <DurationCategoryFields
        :has-max-wear="catForm.initialWearMaxSeconds !== null"
        :minimum-rest-display="shortDuration(catForm.minimumRestSeconds)"
        :break-grace-display="shortDuration(catForm.breakGraceSeconds)"
        :break-decay-half-life-days="catForm.breakDecayHalfLifeDays"
        @update:break-decay-half-life-days="catForm.breakDecayHalfLifeDays = $event"
        :default-half-life-days="DEFAULT_HALF_LIFE_DAYS"
        :band-count="catForm.bandCount"
        :crossover-points="catForm.crossoverPoints"
        @open-duration-picker="openDurationPicker"
        @add-band="addBand"
        @remove-band="removeBand"
      />
```

Add the import:

```ts
import DurationCategoryFields from './DurationCategoryFields.vue';
```

Remove the (now unused in this file) `RiskBands` import if `CategoryForm.vue` no longer references `<RiskBands>` directly after this change.

- [ ] **Step 3: Manual smoke check**

Run: `cd src/frontend && npm run dev`, create/edit a Duration category, confirm Minimum rest, Break grace time, Break half-life, the explanatory note, and risk bands all render and behave exactly as before (minimum rest stays disabled until a maximum is set, half-life field updates `catForm.breakDecayHalfLifeDays`). Stop the dev server after checking.

- [ ] **Step 4: Run lint, unit tests, and the categories e2e spec**

Run: `cd src/frontend && npm run lint && npm run test:ci && npx playwright test tests/e2e/categories.spec.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/DurationCategoryFields.vue src/frontend/src/components/CategoryForm.vue
git commit -m "refactor(frontend): extract DurationCategoryFields from CategoryForm"
```

---

### Task 4: Extract `<ItemForm>` from ItemsSection.vue

**Files:**
- Create: `src/frontend/src/components/ItemForm.vue`
- Modify: `src/frontend/src/components/ItemsSection.vue`

**Interfaces:**
- Consumes: `TextField`, `SelectField`, `ColorPicker`, `NumberField`, `FormCard` (existing components); `randomSwatchColor` (`src/frontend/src/utils/colors.js`).
- Produces: `ItemForm` component — props:
  ```ts
  {
    categories: { id: number; name: string; icon: string }[];
    initialValues?: { name?: string; color?: string; category_id?: string; difficulty_multiplier?: number };
    submitLabel: string;
    showCancel?: boolean;
    idPrefix: string;
    showPlaceholderOption?: boolean;
  }
  ```
  emits: `{ submit: [data: { name: string; color: string; category_id: number; difficulty_multiplier: number }]; cancel: [] }`

- [ ] **Step 1: Create the component**

Create `src/frontend/src/components/ItemForm.vue`:

```vue
<template>
  <FormCard>
    <TextField :id="`${idPrefix}-name`" label="Name" v-model="form.name" />
    <div class="flex gap-2 items-end">
      <ColorPicker v-model="form.color" />
      <template v-if="selectedCategory?.icon">
        <Icon
          v-if="selectedCategory.icon.includes(':')"
          :icon="selectedCategory.icon"
          class="w-6 h-6 self-center shrink-0"
          :style="{ color: form.color }"
        />
        <span v-else class="text-xl self-center shrink-0">{{ selectedCategory.icon }}</span>
      </template>
      <div class="flex-1 min-w-[10ch]">
        <SelectField
          :id="`${idPrefix}-category`"
          label=""
          :modelValue="form.category_id"
          @update:modelValue="form.category_id = $event"
        >
          <option v-if="showPlaceholderOption" value="" disabled>Select…</option>
          <option v-for="cat in categories" :key="cat.id" :value="String(cat.id)">{{ cat.name }}</option>
        </SelectField>
      </div>
    </div>
    <div class="flex gap-4 items-end">
      <NumberField
        :id="`${idPrefix}-difficulty`"
        label="Difficulty"
        v-model="form.difficulty_multiplier"
        :min="0.1"
        :default="1.0"
        :step="0.1"
      />
      <div class="flex gap-2 ml-auto">
        <k-button v-if="showCancel" small outline type="button" @click="$emit('cancel')">Cancel</k-button>
        <k-button :small="showCancel" type="button" @click="onSubmit" :disabled="!form.name || !form.category_id">
          {{ submitLabel }}
        </k-button>
      </div>
    </div>
  </FormCard>
</template>

<script setup lang="ts">
import { reactive, computed, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { kButton } from 'konsta/vue';
import TextField from './TextField.vue';
import SelectField from './SelectField.vue';
import ColorPicker from './ColorPicker.vue';
import NumberField from './NumberField.vue';
import FormCard from './FormCard.vue';
import { randomSwatchColor } from '../utils/colors.js';

interface ItemFormValue {
  name: string;
  color: string;
  category_id: string;
  difficulty_multiplier: number;
}

const props = defineProps<{
  categories: { id: number; name: string; icon: string }[];
  initialValues?: Partial<ItemFormValue>;
  submitLabel: string;
  showCancel?: boolean;
  idPrefix: string;
  showPlaceholderOption?: boolean;
}>();

const emit = defineEmits<{
  submit: [data: { name: string; color: string; category_id: number; difficulty_multiplier: number }];
  cancel: [];
}>();

const form = reactive<ItemFormValue>({
  name: '',
  color: randomSwatchColor(),
  category_id: '',
  difficulty_multiplier: 1.0,
  ...props.initialValues,
});

const selectedCategory = computed(() => props.categories.find((c) => String(c.id) === form.category_id) ?? null);

// Keep the selected category in sync when the list changes (e.g. a category was deleted).
watch(
  () => props.categories,
  (cats) => {
    const validIds = cats.map((c) => String(c.id));
    if (form.category_id && !validIds.includes(form.category_id)) {
      form.category_id = cats.length > 0 ? String(cats[cats.length - 1].id) : '';
    } else if (!form.category_id && cats.length > 0) {
      form.category_id = String(cats[cats.length - 1].id);
    }
  },
  { immediate: true, deep: true },
);

function onSubmit() {
  if (!form.name || !form.category_id) return;
  emit('submit', {
    name: form.name,
    color: form.color,
    category_id: Number(form.category_id),
    difficulty_multiplier: form.difficulty_multiplier,
  });
}
</script>
```

**Accepted behavior nuance:** `ItemForm`'s state is local and re-initializes on every mount. Previously, `ItemsSection.vue`'s `itemForm` reactive object was long-lived — a partially-filled add form that gets closed (without submitting) and reopened would have kept its half-entered values. With this refactor, closing the add form (`v-if="showItemForm"` going false) unmounts `ItemForm`, so reopening it starts fresh. This is a minor, accepted UX difference — flag it in the PR description, don't try to work around it.

- [ ] **Step 2: Wire it into ItemsSection.vue**

Replace the entire `<FormCard v-if="showItemForm && categories.length > 0">...</FormCard>` block in `ItemsSection.vue`'s template with:

```vue
    <ItemForm
      v-if="showItemForm && categories.length > 0"
      id-prefix="item"
      :categories="categories"
      submit-label="Add"
      show-placeholder-option
      @submit="onAddItem"
    />
```

Replace the nested `<FormCard v-if="editingItemId === item.id">...</FormCard>` block (inside the `v-for="item in itemsForCategory(cat.id)"` loop) with:

```vue
            <ItemForm
              v-if="editingItemId === item.id"
              :id-prefix="`edit-item-${item.id}`"
              :categories="categories"
              :initial-values="{ name: item.name, color: item.color, category_id: String(item.category_id), difficulty_multiplier: item.difficulty_multiplier }"
              submit-label="Save"
              show-cancel
              @submit="onSaveItem(item.id, $event)"
              @cancel="editingItemId = null"
            />
```

In the `<script setup>` block: add `import ItemForm from './ItemForm.vue';` and remove the now-unused `itemForm`/`editForm` reactive objects, `selectedCat`/`editSelectedCat` computeds, the `categories` watch, and `randomSwatchColor` import (all moved into `ItemForm.vue`). Replace `onToggleEdit`, `onAddItem`, and `onSaveItem` with:

```ts
function onToggleEdit(item: Item) {
  editingItemId.value = editingItemId.value === item.id ? null : item.id;
  if (editingItemId.value !== null) showItemForm.value = false;
}

async function onAddItem(data: { name: string; color: string; category_id: number; difficulty_multiplier: number }) {
  try {
    await createItem(data);
    showItemForm.value = false;
  } catch (e) {
    showError(String(e));
  }
}

async function onSaveItem(id: number, data: { name: string; color: string; category_id: number; difficulty_multiplier: number }) {
  try {
    await updateItem(id, data);
    editingItemId.value = null;
  } catch (e) {
    showError(String(e));
  }
}
```

`onDeleteItem` and its `confirm()` call are handled in Task 6 — leave it as-is for now.

- [ ] **Step 3: Manual smoke check**

Run: `cd src/frontend && npm run dev`, go to Items, add a new item (confirm the category dropdown has a "Select…" placeholder and the Add button is disabled until name+category are set), then edit an existing item (confirm no placeholder option, fields pre-filled, Cancel/Save both work).

- [ ] **Step 4: Run lint, unit tests, and the items e2e spec**

Run: `cd src/frontend && npm run lint && npm run test:ci && npx playwright test tests/e2e/items.spec.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/ItemForm.vue src/frontend/src/components/ItemsSection.vue
git commit -m "refactor(frontend): extract ItemForm from ItemsSection, deduplicating add/edit"
```

---

### Task 5: Extract `<IconGrid>` from IconPickerSheet.vue

**Files:**
- Create: `src/frontend/src/components/IconGrid.vue`
- Modify: `src/frontend/src/components/IconPickerSheet.vue`

**Interfaces:**
- Produces: `IconGrid` component — props `{ entries: { id: string }[]; selectedId: string }`, emits `{ select: [id: string] }`.

- [ ] **Step 1: Create the component**

Create `src/frontend/src/components/IconGrid.vue`:

```vue
<template>
  <div class="grid gap-1" style="grid-template-columns: repeat(8, minmax(0, 1fr))">
    <button
      v-for="entry in entries"
      :key="entry.id"
      type="button"
      class="flex items-center justify-center w-10 h-10 rounded-lg"
      :class="entry.id === selectedId ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-gray-100'"
      :title="entry.id.slice(3)"
      @click="$emit('select', entry.id)"
    >
      <Icon :icon="entry.id" class="text-2xl" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';

defineProps<{ entries: { id: string }[]; selectedId: string }>();
defineEmits<{ select: [id: string] }>();
</script>
```

- [ ] **Step 2: Wire it into IconPickerSheet.vue**

Replace the "Search mode" `<template v-if="query.trim()">` grid `<div>` and the "Categorised mode" `<template v-else>` grid `<div>` (inside the `<div ref="gridEl">` container) with:

```vue
      <template v-if="query.trim()">
        <p v-if="searchResults.length === 0" class="text-center py-8 text-gray-400 text-sm">
          No icons found
        </p>
        <IconGrid v-else :entries="searchResults" :selected-id="modelValue" @select="select" />
      </template>

      <template v-else>
        <div v-for="cat in categoryNames" :key="cat">
          <h3
            :ref="(el) => setHeadingRef(cat, el)"
            :data-category="cat"
            class="mt-4 mb-2"
          >
            <SectionTitle variant="group">{{ cat }}</SectionTitle>
          </h3>
          <IconGrid :entries="(categoriesData as PhCategories)[cat]" :selected-id="modelValue" @select="select" />
        </div>
      </template>
```

Add the import in `<script setup>`: `import IconGrid from './IconGrid.vue';`. The `Icon` import in `IconPickerSheet.vue` may now be unused — check the rest of the file (the header `✕` button doesn't use `Icon`) and remove the import if so.

- [ ] **Step 3: Manual smoke check**

Run: `cd src/frontend && npm run dev`, open the icon picker from a category form, confirm both the categorised scroll-with-pills view and the search-filtered view render icons identically to before, and that selecting an icon in either mode closes the sheet with the right icon applied.

- [ ] **Step 4: Run lint and unit tests**

Run: `cd src/frontend && npm run lint && npm run test:ci`
Expected: all pass (no unit or e2e test targets the icon picker directly today — this is smoke-check-only coverage, consistent with PR 11's own test plan which also called out manual smoke testing for picker UI).

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/IconGrid.vue src/frontend/src/components/IconPickerSheet.vue
git commit -m "refactor(frontend): extract IconGrid from IconPickerSheet"
```

---

### Task 6: Generalize `<DeleteButton>` and use it in Items/Categories/Log

**Files:**
- Create: `src/frontend/src/components/DeleteButton.vue`
- Modify: `src/frontend/src/components/ItemsSection.vue`
- Modify: `src/frontend/src/components/CategoriesSection.vue`
- Modify: `src/frontend/src/views/Log.vue`
- Modify: `src/frontend/tests/e2e/items.spec.ts`
- Modify: `src/frontend/tests/e2e/categories.spec.ts`

**Interfaces:**
- Produces: `DeleteButton` component — props `{ title: string; message: string }`, emits `{ confirm: [] }`, exposes `open(): void` via `defineExpose`. Renders a `#trigger` scoped slot (receiving `{ open }`) plus its own confirmation `k-dialog`.

- [ ] **Step 1: Create the component**

Create `src/frontend/src/components/DeleteButton.vue`:

```vue
<template>
  <slot name="trigger" :open="open" />
  <k-dialog :opened="confirmOpen" @backdropclick="confirmOpen = false">
    <template #title>{{ title }}</template>
    <template #content>{{ message }}</template>
    <template #buttons>
      <k-dialog-button data-testid="delete-cancel" @click="confirmOpen = false">Cancel</k-dialog-button>
      <k-dialog-button strong data-testid="delete-confirm" @click="onConfirm">Delete</k-dialog-button>
    </template>
  </k-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { kDialog, kDialogButton } from 'konsta/vue';

defineProps<{ title: string; message: string }>();
const emit = defineEmits<{ confirm: [] }>();

const confirmOpen = ref(false);

function open() {
  confirmOpen.value = true;
}

function onConfirm() {
  confirmOpen.value = false;
  emit('confirm');
}

defineExpose({ open });
</script>
```

- [ ] **Step 2: Wire it into ItemsSection.vue**

Replace `<k-button small outline type="button" @click="onDeleteItem(item.id)">Delete</k-button>` with:

```vue
                  <DeleteButton title="Delete item?" message="This cannot be undone." @confirm="deleteItem(item.id)">
                    <template #trigger="{ open }">
                      <k-button small outline type="button" @click="open">Delete</k-button>
                    </template>
                  </DeleteButton>
```

Add `import DeleteButton from './DeleteButton.vue';`. Remove the now-unused `onDeleteItem` function and its `confirm()` call — the template now calls `deleteItem(item.id)` (from `useItems()`) directly via `@confirm`. Since `deleteItem` can throw, wrap it: replace the `@confirm` handler with a small local wrapper instead of calling `deleteItem` inline:

```ts
async function onConfirmDeleteItem(id: number) {
  try {
    await deleteItem(id);
  } catch (e) {
    showError(String(e));
  }
}
```

and use `@confirm="onConfirmDeleteItem(item.id)"` in the template.

- [ ] **Step 3: Wire it into CategoriesSection.vue**

Replace `<k-button small outline type="button" @click="onDeleteCategory(cat.id)">Delete</k-button>` with:

```vue
              <DeleteButton title="Delete this category and all its items?" message="This cannot be undone." @confirm="onConfirmDeleteCategory(cat.id)">
                <template #trigger="{ open }">
                  <k-button small outline type="button" @click="open">Delete</k-button>
                </template>
              </DeleteButton>
```

Add `import DeleteButton from './DeleteButton.vue';`. Replace `onDeleteCategory` (which currently calls `confirm(...)`) with:

```ts
async function onConfirmDeleteCategory(id: number) {
  try {
    await deleteCategory(id);
  } catch (e) {
    showError(String(e));
    return;
  }
  await loadItems().catch(() => {});
}
```

- [ ] **Step 4: Wire it into Log.vue**

Replace the `<ActionsButton @click="confirmDelete()" class="text-red-600">Delete</ActionsButton>` line inside the Kebab action sheet with:

```vue
        <DeleteButton title="Delete session?" message="This cannot be undone." @confirm="performDelete">
          <template #trigger="{ open }">
            <ActionsButton class="text-red-600" @click="actionsOpen = false; open()">Delete</ActionsButton>
          </template>
        </DeleteButton>
```

Remove the entire "Delete confirmation" `<k-dialog :opened="deleteOpen" ...>` block further down in the template (its job is now done by `DeleteButton`). Add `import DeleteButton from '../components/DeleteButton.vue';`. In the script, remove the `deleteOpen` ref and `confirmDelete` function; keep `performDelete` as-is (it already reads `activeEntry.value` and calls `deleteSession`, and no longer needs to set `deleteOpen.value = false` since `DeleteButton` owns that state):

```ts
async function performDelete(): Promise<void> {
  if (activeEntry.value) await deleteSession(activeEntry.value);
}
```

- [ ] **Step 5: Update the Playwright specs that relied on native `confirm()`**

In `src/frontend/tests/e2e/items.spec.ts`, every place that does:

```ts
page.on('dialog', (d) => d.accept());
...
await row.getByRole('button', { name: 'Delete' }).click();
```

now needs an extra step to confirm in the new dialog, and the `page.on('dialog', ...)` registration is no longer needed for item/category deletes (native `confirm()` is gone). Replace each such sequence with:

```ts
await row.getByRole('button', { name: 'Delete' }).click();
await page.getByTestId('delete-confirm').click();
```

Remove the `page.on('dialog', (d) => d.accept())` lines that existed *only* to handle item/category delete confirmations. Check each occurrence individually — some `beforeEach`/`afterEach` blocks in these two files may register the dialog handler for a different reason (re-check the full file before deleting the line); if a handler is no longer needed anywhere in the file, remove it, otherwise leave it.

Apply the same change to `src/frontend/tests/e2e/categories.spec.ts`.

- [ ] **Step 6: Manual smoke check**

Run: `cd src/frontend && npm run dev`. Delete an item, delete a category, and delete a session from the Log — confirm each shows the new `k-dialog` confirmation (not a native browser `confirm()`), Cancel dismisses without deleting, and Delete actually deletes.

- [ ] **Step 7: Run lint, unit tests, and the affected e2e specs**

Run: `cd src/frontend && npm run lint && npm run test:ci && npx playwright test tests/e2e/items.spec.ts tests/e2e/categories.spec.ts`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/frontend/src/components/DeleteButton.vue src/frontend/src/components/ItemsSection.vue src/frontend/src/components/CategoriesSection.vue src/frontend/src/views/Log.vue src/frontend/tests/e2e/items.spec.ts src/frontend/tests/e2e/categories.spec.ts
git commit -m "refactor(frontend): generalize DeleteButton, upgrading Items/Categories off native confirm()"
```

---

### Task 7: Extract `<LogItem>` and `<EditSessionDialog>` from Log.vue

**Files:**
- Create: `src/frontend/src/components/LogItem.vue`
- Create: `src/frontend/src/components/EditSessionDialog.vue`
- Modify: `src/frontend/src/views/Log.vue`

**Interfaces:**
- Produces: `LogItem` — props `{ entry: SessionLogEntry }` (type imported from `../composables/useSessionLog.js`), emits `{ 'open-actions': [] }`.
- Produces: `EditSessionDialog` — props `{ open: boolean; durationMinutes: number; maxMinutes: number }`, emits `{ 'update:open': [value: boolean]; 'update:durationMinutes': [value: number]; save: [] }`.

- [ ] **Step 1: Create LogItem.vue**

Create `src/frontend/src/components/LogItem.vue`:

```vue
<template>
  <k-list-item
    :title="entry.item_name"
    :subtitle="formatStart(entry.started_at)"
  >
    <template #media>
      <Icon
        v-if="entry.category_icon?.includes(':')"
        :icon="entry.category_icon"
        class="text-2xl w-8 h-8"
        :style="{ color: entry.item_color }"
      />
      <span v-else class="text-2xl">{{ entry.category_icon }}</span>
    </template>
    <template #after>
      <div class="flex items-center gap-2">
        <div class="text-right tabular-nums leading-snug whitespace-nowrap">
          <div class="text-sm text-gray-600">
            <span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Worn</span>{{ wornDuration }}
          </div>
          <div class="text-xs text-gray-500">
            <span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Target</span>{{ formatDuration(entry.target_wear_seconds) }}
            <template v-if="entry.max_wear_seconds !== null">
              <span class="mx-1 text-gray-300">/</span>
              <span class="text-xs text-gray-400 uppercase tracking-wide mr-1">Max</span>{{ formatDuration(entry.max_wear_seconds) }}
            </template>
          </div>
        </div>
        <Icon v-if="entry.ended_in_injury" icon="ph:warning-circle" class="text-red-500 w-5 h-5" />
        <button type="button" aria-label="Session actions" class="text-gray-400 p-1" @click="$emit('open-actions')">
          <EllipsisHorizontalIcon class="w-5 h-5" />
        </button>
      </div>
    </template>
  </k-list-item>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { kListItem } from 'konsta/vue';
import { EllipsisHorizontalIcon } from '@heroicons/vue/24/solid';
import type { SessionLogEntry } from '../composables/useSessionLog.js';
import { formatDuration } from '../utils/formatDuration.js';

const props = defineProps<{ entry: SessionLogEntry }>();
defineEmits<{ 'open-actions': [] }>();

function formatStart(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const wornDuration = computed(() =>
  props.entry.ended_at === null ? '' : formatDuration(props.entry.ended_at - props.entry.started_at),
);
</script>
```

- [ ] **Step 2: Create EditSessionDialog.vue**

Create `src/frontend/src/components/EditSessionDialog.vue`. This extracts the dialog **as-is** — its underlying behavior (including the reported bug) is unchanged:

```vue
<template>
  <k-dialog :opened="open" @backdropclick="$emit('update:open', false)">
    <template #title>Edit session</template>
    <template #content>
      <div class="flex flex-col gap-2">
        <label class="text-sm text-gray-500">
          Duration (minutes)
          <input
            :value="durationMinutes"
            @input="$emit('update:durationMinutes', Number(($event.target as HTMLInputElement).value))"
            type="number"
            class="w-full border rounded px-2 py-1 mt-1"
            :min="1"
            :max="maxMinutes"
          />
        </label>
        <p class="text-xs text-gray-400">
          Allowed: {{ formatDuration(60) }} to {{ formatDuration(maxMinutes * 60) }}
        </p>
      </div>
    </template>
    <template #buttons>
      <k-dialog-button @click="$emit('update:open', false)">Cancel</k-dialog-button>
      <k-dialog-button strong @click="$emit('save')">Save</k-dialog-button>
    </template>
  </k-dialog>
</template>

<script setup lang="ts">
import { kDialog, kDialogButton } from 'konsta/vue';
import { formatDuration } from '../utils/formatDuration.js';

defineProps<{ open: boolean; durationMinutes: number; maxMinutes: number }>();
defineEmits<{ 'update:open': [value: boolean]; 'update:durationMinutes': [value: number]; save: [] }>();
</script>
```

Note: the original template wrapped its content in `v-if="editTarget"` — since `editOpen` is only ever set to `true` from `startEdit()` after confirming `editTarget.value` is non-null (see `Log.vue`'s existing `startEdit` function), and is set back to `false` before `editTarget` could become stale, this dialog only ever renders while `editTarget` is valid, so dropping the `v-if="editTarget"` guard (replaced by the parent only rendering `<EditSessionDialog>` while it's relevant) is safe. Keep `maxMinutes` computed as `Math.ceil((editRange.max - editRange.min) / 60)` in the parent, matching the original.

- [ ] **Step 3: Wire both into Log.vue**

Replace the `<k-list-item v-for="entry in sessions" ...>...</k-list-item>` block with:

```vue
          <LogItem
            v-for="entry in sessions"
            :key="entry.id"
            :entry="entry"
            @open-actions="openActions(entry)"
          />
```

Replace the entire `<!-- Edit dialog -->` `<k-dialog :opened="editOpen" ...>` block with:

```vue
    <EditSessionDialog
      v-if="editTarget"
      :open="editOpen"
      @update:open="editOpen = $event"
      :duration-minutes="editDurationMinutes"
      @update:duration-minutes="editDurationMinutes = $event"
      :max-minutes="Math.ceil((editRange.max - editRange.min) / 60)"
      @save="saveEdit"
    />
```

Add imports: `import LogItem from '../components/LogItem.vue';` and `import EditSessionDialog from '../components/EditSessionDialog.vue';`.

- [ ] **Step 4: Manual smoke check**

Run: `cd src/frontend && npm run dev`, open the Log view, confirm rows render identically, the kebab menu opens actions, "Edit" opens the edit dialog (verify against the pre-existing bug — do not attempt to fix it, just confirm it behaves the same as on `main` before this refactor), and delete (from Task 6) still works.

- [ ] **Step 5: Run lint and unit tests**

Run: `cd src/frontend && npm run lint && npm run test:ci`
Expected: all pass (no e2e spec exercises Log.vue today, per the design spec's investigation — this task is smoke-check-only for e2e coverage).

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/components/LogItem.vue src/frontend/src/components/EditSessionDialog.vue src/frontend/src/views/Log.vue
git commit -m "refactor(frontend): extract LogItem and EditSessionDialog from Log view"
```

---

### Task 8: Extract `<CurrentSessionActions>` from ActionPane.vue

**Files:**
- Create: `src/frontend/src/components/CurrentSessionActions.vue`
- Modify: `src/frontend/src/components/ActionPane.vue`

**Interfaces:**
- Produces: `CurrentSessionActions` — props:
  ```ts
  {
    entry: CurrentEntry;
    items: { id: number; name: string }[];
    selectedItemId: number | null;
    locked: boolean;
    forcedItemName: string;
    restRemaining: number;
  }
  ```
  emits:
  ```ts
  {
    'update:selectedItemId': [value: number | null];
    stop: [];
    'choose-something-else': [];
    wear: [];
  }
  ```
  (`itemRotationAvailable` stays a prop-passed function since `ActionPane.vue` already computes it per-entry from reactive state that's awkward to precompute per-item — pass it through as `:item-rotation-available="(id) => itemRotationAvailable(entry, id)"`.)

This is the button cluster PR 11 explicitly called out ("the buttons themselves should be a component"). It stays presentational — `ActionPane.vue` keeps owning `selectedItem`, `overrideLock`, `restWarning`, and all the helper functions; this component only renders and forwards events.

- [ ] **Step 1: Create the component**

Create `src/frontend/src/components/CurrentSessionActions.vue`:

```vue
<template>
  <div class="flex gap-2 items-center">
    <template v-if="entry.session !== null">
      <k-button small outline @click="$emit('stop')">Stop</k-button>
    </template>
    <template v-else>
      <div v-if="entry.category.type !== 'rotation' || restRemaining === 0" class="flex gap-2 items-center">
        <template v-if="locked">
          <span class="text-sm font-medium" data-testid="forced-item-label">{{ forcedItemName }}</span>
          <k-button small inline outline data-testid="wear-something-else" @click="$emit('choose-something-else')">
            Choose Something Else
          </k-button>
          <k-button small inline @click="$emit('wear')">Wear</k-button>
        </template>
        <template v-else>
          <select
            v-if="items.length > 0"
            :value="selectedItemId"
            @change="$emit('update:selectedItemId', Number(($event.target as HTMLSelectElement).value))"
            class="text-sm border rounded px-1 py-0.5"
          >
            <option
              v-for="item in items"
              :key="item.id"
              :value="item.id"
              :disabled="entry.category.type === 'rotation' && !itemRotationAvailable(item.id)"
            >{{ item.name }}</option>
          </select>
          <span v-else class="text-sm text-gray-400 italic">No items</span>
          <k-button
            small
            :disabled="!selectedItemId"
            :class="{ 'opacity-60': restRemaining > 0 }"
            @click="$emit('wear')"
          >Wear</k-button>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { kButton } from 'konsta/vue';
import type { CurrentEntry } from '../composables/useWear.js';

defineProps<{
  entry: CurrentEntry;
  items: { id: number; name: string }[];
  selectedItemId: number | null;
  locked: boolean;
  forcedItemName: string;
  restRemaining: number;
  itemRotationAvailable: (itemId: number) => boolean;
}>();
defineEmits<{
  'update:selectedItemId': [value: number | null];
  stop: [];
  'choose-something-else': [];
  wear: [];
}>();
</script>
```

Note: the original template decided, inline, whether clicking "Wear" should call `onWear` directly or `showRestWarning` first (`@click="restRemainingSeconds(entry) > 0 ? showRestWarning(entry) : onWear(entry)"` and similarly for the locked-label path). That decision needs the actual rest-remaining value and the dialog-opening function, both of which stay in `ActionPane.vue`. Keep that branching in the parent's `@wear` handler (Step 2) rather than duplicating it here — this component only emits a plain `wear` event.

- [ ] **Step 2: Wire it into ActionPane.vue**

Replace the entire `<template #after>` block (the one containing `<k-button ... @click="onStop(entry)">Stop</k-button>` down through its matching closing `</template>`) with:

```vue
        <template #after>
          <CurrentSessionActions
            :entry="entry"
            :items="itemsForCategory(entry.category.id)"
            :selected-item-id="selectedItem[entry.category.id] ?? null"
            @update:selected-item-id="selectedItem[entry.category.id] = $event"
            :locked="isLocked(entry)"
            :forced-item-name="forcedItemName(entry)"
            :rest-remaining="restRemainingSeconds(entry)"
            :item-rotation-available="(id) => itemRotationAvailable(entry, id)"
            @stop="onStop(entry)"
            @choose-something-else="chooseSomethingElse(entry)"
            @wear="onWearClick(entry)"
          />
        </template>
```

Add `import CurrentSessionActions from './CurrentSessionActions.vue';`. Add a new function next to the existing `onWearConfirmed`/`showRestWarning` functions that reproduces the original inline branching:

```ts
function onWearClick(entry: CurrentEntry) {
  if (isLocked(entry)) {
    if (restRemainingSeconds(entry, forcedItemId(entry)) > 0) showRestWarning(entry);
    else onWear(entry, forcedItemId(entry) ?? undefined);
    return;
  }
  if (restRemainingSeconds(entry) > 0) showRestWarning(entry);
  else onWear(entry);
}
```

- [ ] **Step 3: Manual smoke check**

Run: `cd src/frontend && npm run dev`, exercise every path this component covers: stop an active session; start a session on a duration category via the dropdown; on a rotation category — the locked "forced item" label + "Choose Something Else" + "Wear", and the unlocked dropdown path; and the rest-period confirmation dialog triggering from both the locked and unlocked "Wear" click.

- [ ] **Step 4: Run lint, unit tests, and the wear e2e spec**

Run: `cd src/frontend && npm run lint && npm run test:ci && npx playwright test tests/e2e/wear.spec.ts`
Expected: all pass — `wear.spec.ts` is the primary e2e coverage for start/stop/rotation flows.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/CurrentSessionActions.vue src/frontend/src/components/ActionPane.vue
git commit -m "refactor(frontend): extract CurrentSessionActions button cluster from ActionPane"
```

---

### Task 9: Full verification

**Files:** None (verification only).

- [ ] **Step 1: Run the full frontend unit test suite**

Run: `cd src/frontend && npm run test:ci`
Expected: all pass, count ≥ pre-refactor 142 (per PR 11's own numbers) — no unit tests were removed by this plan.

- [ ] **Step 2: Run lint across the whole frontend**

Run: `cd src/frontend && npm run lint`
Expected: zero errors.

- [ ] **Step 3: Run the full Playwright e2e suite**

Run: `cd src/frontend && npm run test:e2e`
Expected: all specs pass, including `categories.spec.ts`, `items.spec.ts`, and `wear.spec.ts`, which this plan touched directly.

- [ ] **Step 4: Confirm every template is now under the SLOC thresholds discussed in the design**

Run:

```bash
for f in src/frontend/src/components/ActionPane.vue src/frontend/src/components/CategoryForm.vue src/frontend/src/components/ItemsSection.vue src/frontend/src/components/IconPickerSheet.vue src/frontend/src/views/Log.vue; do
  awk '/^<script/{print NR-1; exit}' "$f"
  echo "  ^ $f"
done
```

Expected: every file at or below its pre-refactor count, with the five files this plan targeted noticeably smaller (each individual reduction depends on exactly how much moved into sub-components — there's no fixed target number, just "smaller than before, well clear of 200").

This task produces no commit — it's a checkpoint before handing off for review/PR.
