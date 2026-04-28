# Component Extraction & Separation of Concerns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract reusable lower-level components and move misplaced logic to the right layer, reducing duplication and separating UI presentation from domain/business concerns.

**Architecture:** New primitive components (`TextField`, `SelectField`, `FormSectionHeader`, `ColorCircle`, `SegmentedControl`) live in `src/components/`. Shared utilities (`formatDuration`, `categoryDefaults`) live in `src/utils/`. `Items.vue` is split into `CategoriesSection.vue` + `ItemsSection.vue`. A global `useToast` composable + `Toast.vue` replaces all `alert()` calls.

**Tech Stack:** Vue 3 (Composition API, `<script setup>`), TypeScript, Tailwind CSS v4, Konsta UI (for `k-*` components), Vitest (unit tests)

---

## File Map

**Create:**
- `src/frontend/src/utils/formatDuration.ts` — `formatDuration()` and `shortDuration()` utilities
- `src/frontend/src/utils/formatDuration.test.ts` — unit tests
- `src/frontend/src/utils/categoryDefaults.ts` — default values for new categories
- `src/frontend/src/composables/useToast.ts` — global error toast state
- `src/frontend/src/components/Toast.vue` — toast UI (renders in App.vue)
- `src/frontend/src/components/TextField.vue` — label + text input
- `src/frontend/src/components/SelectField.vue` — label + select with slot for options
- `src/frontend/src/components/FormSectionHeader.vue` — section title + Add/Cancel toggle
- `src/frontend/src/components/ColorCircle.vue` — small colored dot
- `src/frontend/src/components/SegmentedControl.vue` — pill button group selector
- `src/frontend/src/components/CategoriesSection.vue` — extracted from Items.vue
- `src/frontend/src/components/ItemsSection.vue` — extracted from Items.vue

**Modify:**
- `src/frontend/src/composables/useItems.ts` — add `itemsForCategory()` function
- `src/frontend/src/composables/useStats.ts` — add `badge()` strategy to each LEADERBOARD_TYPE; import `formatDuration`
- `src/frontend/src/composables/useWear.ts` — remove `formatDuration` (moved to utils)
- `src/frontend/src/components/ActionPane.vue` — use `itemsForCategory` from `useItems`; use `formatDuration` from utils; use `useToast`
- `src/frontend/src/components/CalendarPane.vue` — use `shortDuration` from utils
- `src/frontend/src/views/Items.vue` — replace body with `<CategoriesSection>` + `<ItemsSection>`
- `src/frontend/src/views/Stats.vue` — use `SegmentedControl`; remove `formatSeconds`; use `entryBadge` from composable
- `src/frontend/src/App.vue` — add `<Toast />` component

---

## Task 1: Centralise duration formatting

**Files:**
- Create: `src/frontend/src/utils/formatDuration.ts`
- Create: `src/frontend/src/utils/formatDuration.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/frontend/src/utils/formatDuration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatDuration, shortDuration } from './formatDuration';

describe('formatDuration', () => {
  it('returns "0s" for zero or negative', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-5)).toBe('0s');
  });

  it('returns seconds only when under a minute', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('returns minutes and seconds when under an hour', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('returns hours and minutes when at least an hour', () => {
    expect(formatDuration(3723)).toBe('1h 2m');
  });
});

describe('shortDuration', () => {
  it('returns minutes only when under an hour', () => {
    expect(shortDuration(125)).toBe('2m');
  });

  it('returns hours only when at least an hour', () => {
    expect(shortDuration(3723)).toBe('1h');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd src/frontend && npm test -- formatDuration
```

Expected: FAIL — `formatDuration` not found.

- [ ] **Step 3: Implement the utilities**

Create `src/frontend/src/utils/formatDuration.ts`:

```typescript
/** Full precision: "Xh Ym", "Ym Zs", or "Zs". */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Compact for calendar cells: "Xh" or "Ym". */
export function shortDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd src/frontend && npm test -- formatDuration
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
cd src/frontend && git add src/utils/formatDuration.ts src/utils/formatDuration.test.ts
git commit -m "feat: extract formatDuration and shortDuration to utils"
```

---

## Task 2: Use centralised formatting; remove duplicates

**Files:**
- Modify: `src/frontend/src/composables/useWear.ts` (remove `formatDuration`)
- Modify: `src/frontend/src/components/ActionPane.vue` (import from utils)
- Modify: `src/frontend/src/components/CalendarPane.vue` (import from utils)

`formatDuration` will be added to `useStats` in Task 5 (leaderboard strategy). `Stats.vue`'s `formatSeconds` is removed then too.

- [ ] **Step 1: Remove `formatDuration` from `useWear.ts`**

In `src/frontend/src/composables/useWear.ts`, delete lines 106–113 (the `formatDuration` function) and remove it from the return object on line 134.

The file's return should become:

```typescript
export function useWear() {
  onMounted(() => {
    fetchCurrent();
    pollTimer = setInterval(fetchCurrent, 30_000);
  });
  onUnmounted(() => {
    if (pollTimer !== null) clearInterval(pollTimer);
  });

  return {
    currentSessions,
    loading,
    error,
    fetchCurrent,
    startSession,
    endSession,
    reportInjury,
    currentWear,
  };
}
```

- [ ] **Step 2: Update `ActionPane.vue` to import `formatDuration` from utils**

At the top of `<script setup>` in `src/frontend/src/components/ActionPane.vue`, replace:

```typescript
const { currentSessions, startSession, endSession, currentWear, formatDuration, fetchCurrent } = useWear();
```

with:

```typescript
import { formatDuration } from '../utils/formatDuration.js';

const { currentSessions, startSession, endSession, currentWear, fetchCurrent } = useWear();
```

(Add the import line near the other imports at the top of the script block.)

- [ ] **Step 3: Update `CalendarPane.vue` to use `shortDuration` from utils**

In `src/frontend/src/components/CalendarPane.vue`:

1. Add import after the existing imports in the script block:

```typescript
import { shortDuration } from '../utils/formatDuration.js';
```

2. Delete the local `shortDuration` function (lines 41–46):

```typescript
// DELETE THIS:
function shortDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/composables/useWear.ts src/frontend/src/components/ActionPane.vue src/frontend/src/components/CalendarPane.vue
git commit -m "refactor: use shared formatDuration/shortDuration from utils"
```

---

## Task 3: Extract category defaults

**Files:**
- Create: `src/frontend/src/utils/categoryDefaults.ts`

- [ ] **Step 1: Create the defaults file**

Create `src/frontend/src/utils/categoryDefaults.ts`:

```typescript
import type { Category } from '../composables/useWear.js';

export type CategoryDefaults = Omit<Category, 'id' | 'name' | 'icon'>;

export const DEFAULT_CATEGORY_FIELDS: CategoryDefaults = {
  initial_wear_duration_seconds: 900,
  rest_multiplier: 2,
  rest_constant_seconds: 86400,
  risk_levels: [
    { lower: null, upper: 3600, text: 'Low', severity: 1 },
    { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
    { lower: 7200, upper: null, text: 'High', severity: 3 },
  ],
  break_decay_multiplier: 0.75,
  break_starts_after_seconds: 604800,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/utils/categoryDefaults.ts
git commit -m "feat: extract default category field values to utils"
```

---

## Task 4: Add `itemsForCategory` to `useItems`

**Files:**
- Modify: `src/frontend/src/composables/useItems.ts`

- [ ] **Step 1: Add `itemsForCategory` to useItems**

In `src/frontend/src/composables/useItems.ts`, add the function before `export function useItems()`:

```typescript
function itemsForCategory(categoryId: number): Item[] {
  return items.value.filter((i) => i.category_id === categoryId);
}
```

Then add it to the return object of `useItems()`:

```typescript
export function useItems() {
  return {
    items,
    loadItems,
    loadItemStats,
    loadHistory,
    createItem,
    updateItem,
    deleteItem,
    itemsForCategory,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/composables/useItems.ts
git commit -m "feat: add itemsForCategory to useItems composable"
```

---

## Task 5: Leaderboard type strategy pattern

Moves badge-formatting knowledge out of `Stats.vue` into each leaderboard type definition. `Stats.vue` no longer branches on type.

**Files:**
- Modify: `src/frontend/src/composables/useStats.ts`
- Modify: `src/frontend/src/views/Stats.vue`

- [ ] **Step 1: Read `useStats.ts`**

```bash
cat src/frontend/src/composables/useStats.ts
```

Note the shape of `LEADERBOARD_TYPES` and the `LeaderboardEntry` type.

- [ ] **Step 2: Update `useStats.ts`**

Add the `formatDuration` import and attach a `badge` function to each type. Replace the existing `LEADERBOARD_TYPES` constant with:

```typescript
import { formatDuration } from '../utils/formatDuration.js';

export const LEADERBOARD_TYPES = [
  {
    value: 'longest-wear',
    label: 'Longest Single Session',
    badge: (entry: Record<string, unknown>) =>
      formatDuration((entry.max_single_session_wear_seconds ?? 0) as number),
  },
  {
    value: 'most-total-wear',
    label: 'Most Total Wear',
    badge: (entry: Record<string, unknown>) =>
      formatDuration((entry.total_wear_seconds ?? 0) as number),
  },
  {
    value: 'most-sessions',
    label: 'Most Sessions',
    badge: (entry: Record<string, unknown>) => `${entry.session_count ?? 0} sessions`,
  },
  {
    value: 'best-streak',
    label: 'Best Streak',
    badge: (entry: Record<string, unknown>) =>
      formatDuration((entry.best_streak_wear_seconds ?? 0) as number),
  },
] as const;

export type LeaderboardTypeValue = typeof LEADERBOARD_TYPES[number]['value'];
```

(Keep the rest of `useStats.ts` unchanged — `leaderboard`, `activeType`, `loading`, `loadLeaderboard`.)

- [ ] **Step 3: Update `Stats.vue`**

Replace the entire `<script setup>` block with:

```typescript
import { onMounted, computed } from 'vue';
import { kPage, kNavbar, kList, kListItem, kBadge, kBlock } from 'konsta/vue';
import { useStats } from '../composables/useStats.js';

const { leaderboard, activeType, loading, loadLeaderboard, LEADERBOARD_TYPES } = useStats();

onMounted(() => loadLeaderboard('longest-wear'));

const activeTypeObj = computed(() =>
  LEADERBOARD_TYPES.find((t) => t.value === activeType.value)
);

function entryName(entry: Record<string, unknown>): string {
  return (entry.name ?? entry.category_name ?? '—') as string;
}

function entrySubtitle(entry: Record<string, unknown>): string {
  if (entry.category_name) return `Category: ${entry.category_name}`;
  if (entry.category) return String(entry.category);
  return '';
}

function entryBadge(entry: Record<string, unknown>): string {
  return activeTypeObj.value?.badge(entry) ?? '';
}
```

Also remove the local `formatSeconds` function (it no longer exists in the script block).

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/composables/useStats.ts src/frontend/src/views/Stats.vue
git commit -m "refactor: move leaderboard badge logic into type strategy in useStats"
```

---

## Task 6: Global toast for errors

Replaces all `alert(String(e))` calls with a dismissible in-app error toast.

**Files:**
- Create: `src/frontend/src/composables/useToast.ts`
- Create: `src/frontend/src/components/Toast.vue`
- Modify: `src/frontend/src/App.vue`

- [ ] **Step 1: Create `useToast.ts`**

Create `src/frontend/src/composables/useToast.ts`:

```typescript
import { ref } from 'vue';

const message = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

export function useToast() {
  function showError(msg: string) {
    message.value = msg;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { message.value = null; }, 4000);
  }

  function dismiss() {
    message.value = null;
    if (timer) clearTimeout(timer);
  }

  return { message, showError, dismiss };
}
```

- [ ] **Step 2: Create `Toast.vue`**

Create `src/frontend/src/components/Toast.vue`:

```vue
<template>
  <Transition name="toast">
    <div
      v-if="message"
      class="fixed top-4 left-4 right-4 z-50 bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg flex justify-between items-center"
    >
      <span class="text-sm">{{ message }}</span>
      <button class="ml-3 opacity-75 hover:opacity-100 text-white" @click="dismiss">✕</button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useToast } from '../composables/useToast.js';
const { message, dismiss } = useToast();
</script>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
```

- [ ] **Step 3: Add `<Toast />` to `App.vue`**

In `src/frontend/src/App.vue`:

1. Add the import to the script block:

```typescript
import Toast from './components/Toast.vue';
```

2. Add `<Toast />` as the first child inside `<k-app>`:

```html
<k-app theme="ios" class="h-full">
  <Toast />
  <router-view />
  ...
```

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/composables/useToast.ts src/frontend/src/components/Toast.vue src/frontend/src/App.vue
git commit -m "feat: add useToast composable and Toast component"
```

---

## Task 7: Primitive form components

**Files:**
- Create: `src/frontend/src/components/TextField.vue`
- Create: `src/frontend/src/components/SelectField.vue`
- Create: `src/frontend/src/components/FormSectionHeader.vue`
- Create: `src/frontend/src/components/ColorCircle.vue`
- Create: `src/frontend/src/components/SegmentedControl.vue`

- [ ] **Step 1: Create `TextField.vue`**

```vue
<template>
  <div>
    <label v-if="label" :for="id" class="block text-sm font-medium text-gray-700 mb-1">{{ label }}</label>
    <input
      :id="id"
      :value="modelValue"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      type="text"
      :placeholder="placeholder"
      class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{ id?: string; label?: string; modelValue: string; placeholder?: string }>();
defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
```

- [ ] **Step 2: Create `SelectField.vue`**

Options are provided via the default slot. The component emits a string value; callers that need a number convert at the call site.

```vue
<template>
  <div>
    <label v-if="label" :for="id" class="block text-sm font-medium text-gray-700 mb-1">{{ label }}</label>
    <select
      :id="id"
      :value="modelValue"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
      class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <slot />
    </select>
  </div>
</template>

<script setup lang="ts">
defineProps<{ id?: string; label?: string; modelValue: string }>();
defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
```

- [ ] **Step 3: Create `FormSectionHeader.vue`**

```vue
<template>
  <div class="flex justify-between items-center px-4 mt-6 mb-2">
    <span class="font-semibold text-[17px] text-black/60 dark:text-white/60">{{ title }}</span>
    <button v-if="showToggle" class="text-blue-500 text-sm font-normal" @click="$emit('toggle')">
      {{ isOpen ? 'Cancel' : '+ Add' }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; isOpen: boolean; showToggle?: boolean }>();
defineEmits<{ toggle: [] }>();
</script>
```

- [ ] **Step 4: Create `ColorCircle.vue`**

```vue
<template>
  <div class="w-3 h-3 rounded-full" :style="{ background: color }" />
</template>

<script setup lang="ts">
defineProps<{ color: string }>();
</script>
```

- [ ] **Step 5: Create `SegmentedControl.vue`**

```vue
<template>
  <div class="flex gap-2 overflow-x-auto px-4 py-3 no-scrollbar">
    <button
      v-for="option in options"
      :key="option.value"
      class="flex-shrink-0 px-3 py-1 rounded-full text-sm border transition-colors"
      :class="modelValue === option.value
        ? 'bg-blue-500 text-white border-blue-500'
        : 'bg-white text-gray-700 border-gray-300'"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  options: ReadonlyArray<{ value: string; label: string }>;
  modelValue: string;
}>();
defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<style scoped>
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
```

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/components/TextField.vue src/frontend/src/components/SelectField.vue src/frontend/src/components/FormSectionHeader.vue src/frontend/src/components/ColorCircle.vue src/frontend/src/components/SegmentedControl.vue
git commit -m "feat: add TextField, SelectField, FormSectionHeader, ColorCircle, SegmentedControl components"
```

---

## Task 8: Update `Stats.vue` to use `SegmentedControl`

**Files:**
- Modify: `src/frontend/src/views/Stats.vue`

- [ ] **Step 1: Import and use `SegmentedControl` in `Stats.vue`**

In the `<script setup>` block, add the import:

```typescript
import SegmentedControl from '../components/SegmentedControl.vue';
```

Replace the leaderboard type selector section in the template (lines 6–18 of the original):

```html
<!-- BEFORE -->
<div class="flex gap-2 overflow-x-auto px-4 py-3 no-scrollbar">
  <button
    v-for="t in LEADERBOARD_TYPES"
    :key="t.value"
    class="flex-shrink-0 px-3 py-1 rounded-full text-sm border transition-colors"
    :class="activeType === t.value
      ? 'bg-blue-500 text-white border-blue-500'
      : 'bg-white text-gray-700 border-gray-300'"
    @click="loadLeaderboard(t.value)"
  >
    {{ t.label }}
  </button>
</div>

<!-- AFTER -->
<SegmentedControl
  :options="LEADERBOARD_TYPES"
  :modelValue="activeType"
  @update:modelValue="loadLeaderboard"
/>
```

Also delete the `<style scoped>` block from `Stats.vue` — the `no-scrollbar` styles now live in `SegmentedControl.vue`.

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/views/Stats.vue
git commit -m "refactor: use SegmentedControl in Stats.vue"
```

---

## Task 9: Extract `CategoriesSection.vue`

**Files:**
- Create: `src/frontend/src/components/CategoriesSection.vue`

This component owns the full categories UI: section header, add-form, list, and empty state. It loads its own data on mount.

- [ ] **Step 1: Create `CategoriesSection.vue`**

```vue
<template>
  <div>
    <FormSectionHeader
      title="Categories"
      :isOpen="showCatForm"
      :showToggle="true"
      @toggle="showCatForm = !showCatForm"
    />

    <div v-if="showCatForm" class="px-4 pb-2 space-y-3">
      <TextField id="cat-name" label="Name" v-model="catForm.name" />
      <TextField id="cat-icon" label="Icon (emoji or symbol)" v-model="catForm.icon" placeholder="👟" />
      <k-button @click="onAddCategory" :disabled="!catForm.name || !catForm.icon">
        Add Category
      </k-button>
    </div>

    <div v-if="loading" class="text-center py-4 text-gray-400">Loading…</div>
    <template v-else>
      <k-list v-if="categories.length > 0" inset>
        <k-list-item
          v-for="cat in categories"
          :key="cat.id"
          :title="cat.name"
          :subtitle="cat.icon"
        >
          <template #after>
            <k-button small outline @click="onDeleteCategory(cat.id)">Delete</k-button>
          </template>
        </k-list-item>
      </k-list>
      <k-block v-else>
        <p class="text-center text-gray-400 text-sm">No categories yet. Use "+ Add" above to create one.</p>
      </k-block>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { kList, kListItem, kButton, kBlock } from 'konsta/vue';
import { useCategories } from '../composables/useCategories.js';
import { useItems } from '../composables/useItems.js';
import { useToast } from '../composables/useToast.js';
import { DEFAULT_CATEGORY_FIELDS } from '../utils/categoryDefaults.js';
import TextField from './TextField.vue';
import FormSectionHeader from './FormSectionHeader.vue';

const { categories, loadCategories, createCategory, deleteCategory } = useCategories();
const { loadItems } = useItems();
const { showError } = useToast();

const loading = ref(true);
const showCatForm = ref(false);
const catForm = reactive({ name: '', icon: '' });

onMounted(async () => {
  await loadCategories();
  loading.value = false;
});

async function onAddCategory() {
  if (!catForm.name || !catForm.icon) return;
  try {
    await createCategory({ name: catForm.name, icon: catForm.icon, ...DEFAULT_CATEGORY_FIELDS });
    catForm.name = '';
    catForm.icon = '';
    showCatForm.value = false;
  } catch (e) {
    showError(String(e));
  }
}

async function onDeleteCategory(id: number) {
  if (!confirm('Delete this category and all its items?')) return;
  try {
    await deleteCategory(id);
    await loadItems();
  } catch (e) {
    showError(String(e));
  }
}
</script>
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/components/CategoriesSection.vue
git commit -m "feat: extract CategoriesSection component from Items.vue"
```

---

## Task 10: Extract `ItemsSection.vue`

**Files:**
- Create: `src/frontend/src/components/ItemsSection.vue`

This component owns: the items section header, add-item form (with `SelectField` for category and `ColorPicker` for color), and the grouped items list with `ColorCircle`. `category_id` is stored as a string in form state and converted to a number on submit.

- [ ] **Step 1: Create `ItemsSection.vue`**

```vue
<template>
  <div>
    <FormSectionHeader
      title="Items"
      :isOpen="showItemForm"
      :showToggle="categories.length > 0"
      @toggle="showItemForm = !showItemForm"
    />

    <div v-if="showItemForm && categories.length > 0" class="px-4 pb-2 space-y-3">
      <TextField id="item-name" label="Name" v-model="itemForm.name" />
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Color</label>
        <ColorPicker v-model="itemForm.color" />
      </div>
      <SelectField
        id="item-category"
        label="Category"
        :modelValue="itemForm.category_id"
        @update:modelValue="itemForm.category_id = $event"
      >
        <option value="" disabled>Select…</option>
        <option v-for="cat in categories" :key="cat.id" :value="String(cat.id)">{{ cat.name }}</option>
      </SelectField>
      <k-button
        @click="onAddItem"
        :disabled="!itemForm.name || !itemForm.category_id"
      >
        Add Item
      </k-button>
    </div>

    <template v-if="!loading">
      <div v-for="cat in categories" :key="cat.id">
        <div class="px-4 mt-4 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {{ cat.name }}
        </div>
        <k-list inset>
          <k-list-item
            v-for="item in itemsForCategory(cat.id)"
            :key="item.id"
            :title="item.name"
          >
            <template #media>
              <ColorCircle :color="item.color" />
            </template>
            <template #after>
              <k-button small outline @click="onDeleteItem(item.id)">Delete</k-button>
            </template>
          </k-list-item>
          <k-list-item
            v-if="itemsForCategory(cat.id).length === 0"
            title="No items in this category"
            class="text-gray-400"
          />
        </k-list>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue';
import { kList, kListItem, kButton } from 'konsta/vue';
import { useItems } from '../composables/useItems.js';
import { useCategories } from '../composables/useCategories.js';
import { useToast } from '../composables/useToast.js';
import { randomSwatchColor } from '../utils/colors.js';
import TextField from './TextField.vue';
import SelectField from './SelectField.vue';
import ColorPicker from './ColorPicker.vue';
import ColorCircle from './ColorCircle.vue';
import FormSectionHeader from './FormSectionHeader.vue';

const { items, loadItems, createItem, deleteItem, itemsForCategory } = useItems();
const { categories } = useCategories();
const { showError } = useToast();

const loading = ref(true);
const showItemForm = ref(false);

const itemForm = reactive({ name: '', color: randomSwatchColor(), category_id: '' });

onMounted(async () => {
  await loadItems();
  loading.value = false;
});

// Keep default category selection current when categories change.
// deep: true is needed because createCategory pushes to the array rather than replacing it.
watch(categories, (cats) => {
  if (cats.length > 0 && !itemForm.category_id) {
    itemForm.category_id = String(cats[cats.length - 1].id);
  }
}, { immediate: true, deep: true });

async function onAddItem() {
  if (!itemForm.name || !itemForm.color || !itemForm.category_id) return;
  try {
    await createItem({
      name: itemForm.name,
      color: itemForm.color,
      category_id: Number(itemForm.category_id),
    });
    itemForm.name = '';
    itemForm.color = randomSwatchColor();
    showItemForm.value = false;
  } catch (e) {
    showError(String(e));
  }
}

async function onDeleteItem(id: number) {
  if (!confirm('Delete this item?')) return;
  try {
    await deleteItem(id);
  } catch (e) {
    showError(String(e));
  }
}
</script>
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/components/ItemsSection.vue
git commit -m "feat: extract ItemsSection component from Items.vue"
```

---

## Task 11: Simplify `Items.vue` + update `ActionPane.vue`

**Files:**
- Modify: `src/frontend/src/views/Items.vue`
- Modify: `src/frontend/src/components/ActionPane.vue`

- [ ] **Step 1: Replace `Items.vue` body**

Replace the entire content of `src/frontend/src/views/Items.vue` with:

```vue
<template>
  <k-page style="padding-bottom: 56px">
    <k-navbar title="Items" />
    <CategoriesSection />
    <ItemsSection />
  </k-page>
</template>

<script setup lang="ts">
import { kPage, kNavbar } from 'konsta/vue';
import CategoriesSection from '../components/CategoriesSection.vue';
import ItemsSection from '../components/ItemsSection.vue';
</script>
```

- [ ] **Step 2: Update `ActionPane.vue` to use `itemsForCategory` from `useItems` and `useToast`**

In `src/frontend/src/components/ActionPane.vue`, update the `<script setup>` block:

1. Add the new imports:

```typescript
import { useToast } from '../composables/useToast.js';
```

2. Change the `useItems` destructure to include `itemsForCategory`:

```typescript
const { items, loadItems, itemsForCategory } = useItems();
```

3. Replace the local `itemsForCategory` function (lines 78–80) with nothing — it's now from the composable.

4. Replace the `alert(String(e))` calls in `onWear` and `onStop` with `showError(String(e))`:

```typescript
const { showError } = useToast();

async function onWear(entry: CurrentEntry) {
  const itemId = selectedItem[entry.category.id];
  if (!itemId) return;
  try {
    await startSession(itemId);
  } catch (e) {
    showError(String(e));
  }
}

async function onStop(entry: CurrentEntry) {
  if (!entry.session) return;
  try {
    await endSession(entry.session.id);
  } catch (e) {
    showError(String(e));
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/views/Items.vue src/frontend/src/components/ActionPane.vue
git commit -m "refactor: slim down Items.vue; wire itemsForCategory and useToast into ActionPane"
```

---

## Task 12: Verify everything compiles and runs

- [ ] **Step 1: Run the TypeScript build**

```bash
cd src/frontend && npm run build
```

Expected: exits 0, no type errors.

- [ ] **Step 2: Run the unit tests**

```bash
cd src/frontend && npm test
```

Expected: all tests pass (formatDuration suite + colors suite).

- [ ] **Step 3: Start the dev server and manually verify**

```bash
cd src/frontend && npm run dev
```

Open the app and check:
- Home tab: ActionPane shows categories with item picker, wear/stop buttons work, errors show as toast not alert
- Items tab: Categories section shows list, "+ Add" form with TextField inputs works, Items section shows grouped items with ColorCircle
- Stats tab: SegmentedControl switches leaderboard types, badges show correctly

- [ ] **Step 4: Final commit if any fixups were needed**

```bash
git add -p
git commit -m "fix: post-extraction fixups"
```
