# Category Form Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `initial_wear_duration_seconds`, `rest_multiplier`, and `risk_levels` inputs to the Add Category form, including an iOS-style drum-roll duration picker component.

**Architecture:** Two new pure-utility functions (`bandNamesForCount`, `buildRiskLevels`) live in `utils/riskLevels.ts`; a reusable `DurationPickerSheet.vue` handles all hours/minutes picking; `CategoriesSection.vue` grows three new form fields that use both. No backend changes needed — the API already accepts all fields.

**Tech Stack:** Vue 3 (Composition API, `reactive`), Tailwind CSS v4, Konsta UI (`kSheet`, `kToolbar`), Vitest (unit), Playwright (e2e)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/frontend/src/utils/riskLevels.ts` | `BAND_NAMES`, `bandNamesForCount`, `buildRiskLevels` |
| Create | `src/frontend/src/utils/riskLevels.test.ts` | Unit tests for the above |
| Create | `src/frontend/src/components/DurationPickerSheet.vue` | iOS drum-roll picker sheet |
| Modify | `src/frontend/src/components/CategoriesSection.vue` | Three new form fields + wiring |
| Modify | `src/frontend/tests/e2e/categories.spec.ts` | New e2e tests |

---

## Task 1: Risk level utility functions

**Files:**
- Create: `src/frontend/src/utils/riskLevels.ts`
- Create: `src/frontend/src/utils/riskLevels.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/frontend/src/utils/riskLevels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bandNamesForCount, buildRiskLevels } from './riskLevels';

describe('bandNamesForCount', () => {
  it('returns ["Medium"] for 1 band', () => {
    expect(bandNamesForCount(1)).toEqual(['Medium']);
  });
  it('returns ["Low","High"] for 2 bands', () => {
    expect(bandNamesForCount(2)).toEqual(['Low', 'High']);
  });
  it('returns ["Low","Medium","High"] for 3 bands', () => {
    expect(bandNamesForCount(3)).toEqual(['Low', 'Medium', 'High']);
  });
  it('returns ["Lower","Low","High","Higher"] for 4 bands', () => {
    expect(bandNamesForCount(4)).toEqual(['Lower', 'Low', 'High', 'Higher']);
  });
  it('returns ["Lowest","Low","Medium","High","Highest"] for 5 bands', () => {
    expect(bandNamesForCount(5)).toEqual(['Lowest', 'Low', 'Medium', 'High', 'Highest']);
  });
});

describe('buildRiskLevels', () => {
  it('builds 1 band with null lower and upper', () => {
    expect(buildRiskLevels(1, [])).toEqual([
      { lower: null, upper: null, text: 'Medium', severity: 1 },
    ]);
  });
  it('builds 2 bands with one crossover', () => {
    expect(buildRiskLevels(2, [3600])).toEqual([
      { lower: null, upper: 3600, text: 'Low', severity: 1 },
      { lower: 3600, upper: null, text: 'High', severity: 2 },
    ]);
  });
  it('builds 3 bands with two crossovers', () => {
    expect(buildRiskLevels(3, [3600, 7200])).toEqual([
      { lower: null, upper: 3600, text: 'Low', severity: 1 },
      { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
      { lower: 7200, upper: null, text: 'High', severity: 3 },
    ]);
  });
  it('builds 5 bands with correct names and severity', () => {
    const result = buildRiskLevels(5, [3600, 7200, 10800, 14400]);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ lower: null, upper: 3600, text: 'Lowest', severity: 1 });
    expect(result[2]).toEqual({ lower: 7200, upper: 10800, text: 'Medium', severity: 3 });
    expect(result[4]).toEqual({ lower: 14400, upper: null, text: 'Highest', severity: 5 });
  });
  it('sets lower null on first band and upper null on last band', () => {
    const result = buildRiskLevels(4, [1800, 3600, 7200]);
    expect(result[0].lower).toBeNull();
    expect(result[3].upper).toBeNull();
    expect(result[1].lower).toBe(1800);
    expect(result[2].upper).toBe(7200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd src/frontend && npx vitest run src/utils/riskLevels.test.ts
```

Expected: FAIL with `Cannot find module './riskLevels'`

- [ ] **Step 3: Implement the utility functions**

Create `src/frontend/src/utils/riskLevels.ts`:

```ts
export interface RiskLevel {
  lower: number | null;
  upper: number | null;
  text: string;
  severity: number;
}

const BAND_NAMES: string[][] = [
  ['Medium'],
  ['Low', 'High'],
  ['Low', 'Medium', 'High'],
  ['Lower', 'Low', 'High', 'Higher'],
  ['Lowest', 'Low', 'Medium', 'High', 'Highest'],
];

/** The Tailwind bg class for each band position, keyed by band count (index = count - 1). */
export const BAND_COLORS: string[][] = [
  ['bg-yellow-200'],
  ['bg-green-200', 'bg-red-200'],
  ['bg-green-200', 'bg-yellow-200', 'bg-red-200'],
  ['bg-green-200', 'bg-lime-200', 'bg-orange-200', 'bg-red-200'],
  ['bg-green-200', 'bg-lime-200', 'bg-yellow-200', 'bg-orange-200', 'bg-red-200'],
];

/** Returns the fixed ordered name array for a given band count (1–5). */
export function bandNamesForCount(count: number): string[] {
  return BAND_NAMES[count - 1];
}

/** Converts bandCount + crossoverPoints into the risk_levels API array. */
export function buildRiskLevels(bandCount: number, crossoverPoints: number[]): RiskLevel[] {
  return Array.from({ length: bandCount }, (_, i) => ({
    lower: i === 0 ? null : crossoverPoints[i - 1],
    upper: i === bandCount - 1 ? null : crossoverPoints[i],
    text: BAND_NAMES[bandCount - 1][i],
    severity: i + 1,
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd src/frontend && npx vitest run src/utils/riskLevels.test.ts
```

Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/utils/riskLevels.ts src/frontend/src/utils/riskLevels.test.ts
git commit -m "feat: add bandNamesForCount and buildRiskLevels utilities"
```

---

## Task 2: DurationPickerSheet component

**Files:**
- Create: `src/frontend/src/components/DurationPickerSheet.vue`

The picker shows two infinite-scroll drum columns (hours 0–23, minutes 0–59) in a `kSheet`. Each column's item list is tripled so the user can scroll in either direction without hitting a wall. After the scroll settles (debounce 150ms), a wrap handler silently repositions the scroll to the middle third if it has drifted into the top or bottom third.

Layout: container height 220px shows 5 items (44px each). Two spacer divs (88px each) inside each column allow the first and last items to be centred. With `scroll-snap-type: y mandatory` and `scroll-snap-align: center`, `scrollTop = i * 44` centres item `i`.

- [ ] **Step 1: Create the component**

Create `src/frontend/src/components/DurationPickerSheet.vue`:

```vue
<template>
  <k-sheet
    v-if="open"
    :opened="open"
    @backdropclick="$emit('update:open', false)"
    class="pb-safe bg-white dark:bg-gray-900"
  >
    <k-toolbar innerClass="!h-10 !w-full">
      <div class="relative flex w-full items-center justify-center">
        <button
          type="button"
          class="absolute left-4 text-sm text-blue-500"
          @click="$emit('update:open', false)"
        >Cancel</button>
        <span class="font-semibold text-sm">Duration</span>
        <button
          type="button"
          class="absolute right-4 text-sm font-semibold text-blue-500"
          @click="onDone"
        >Done</button>
      </div>
    </k-toolbar>

    <div class="relative flex h-[220px] items-stretch justify-center overflow-hidden">
      <!-- Selection highlight bar sits at the vertical centre -->
      <div
        class="pointer-events-none absolute inset-x-0 h-[44px] border-y border-gray-200 bg-gray-100"
        style="top: calc(50% - 22px)"
      />

      <!-- Hours column -->
      <div
        ref="hoursEl"
        data-testid="hours-col"
        class="w-32 overflow-y-scroll overscroll-none"
        style="scroll-snap-type: y mandatory; scrollbar-width: none; -webkit-overflow-scrolling: touch;"
        @scroll="onScroll('hours')"
      >
        <div class="h-[88px] shrink-0" />
        <div
          v-for="item in tripledHours"
          :key="item.key"
          class="flex h-[44px] select-none items-center justify-center text-xl"
          style="scroll-snap-align: center;"
        >{{ item.value }}h</div>
        <div class="h-[88px] shrink-0" />
      </div>

      <!-- Minutes column -->
      <div
        ref="minutesEl"
        data-testid="minutes-col"
        class="w-32 overflow-y-scroll overscroll-none"
        style="scroll-snap-type: y mandatory; scrollbar-width: none; -webkit-overflow-scrolling: touch;"
        @scroll="onScroll('minutes')"
      >
        <div class="h-[88px] shrink-0" />
        <div
          v-for="item in tripledMinutes"
          :key="item.key"
          class="flex h-[44px] select-none items-center justify-center text-xl"
          style="scroll-snap-align: center;"
        >{{ String(item.value).padStart(2, '0') }}m</div>
        <div class="h-[88px] shrink-0" />
      </div>
    </div>
  </k-sheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { kSheet, kToolbar } from 'konsta/vue';

const ITEM_H = 44;
const HOUR_COUNT = 24;
const MIN_COUNT = 60;

const props = defineProps<{ modelValue: number; open: boolean }>();
const emit = defineEmits<{
  'update:modelValue': [value: number];
  'update:open': [value: boolean];
}>();

const hoursEl = ref<HTMLElement | null>(null);
const minutesEl = ref<HTMLElement | null>(null);
const curHours = ref(0);
const curMinutes = ref(0);
const scrollTimers: Record<string, ReturnType<typeof setTimeout>> = {};

const tripledHours = computed(() =>
  Array.from({ length: HOUR_COUNT * 3 }, (_, i) => ({ key: i, value: i % HOUR_COUNT }))
);
const tripledMinutes = computed(() =>
  Array.from({ length: MIN_COUNT * 3 }, (_, i) => ({ key: i, value: i % MIN_COUNT }))
);

function initScroll() {
  const h = Math.floor(props.modelValue / 3600) % HOUR_COUNT;
  const m = Math.floor((props.modelValue % 3600) / 60) % MIN_COUNT;
  curHours.value = h;
  curMinutes.value = m;
  nextTick(() => {
    if (hoursEl.value) hoursEl.value.scrollTop = (HOUR_COUNT + h) * ITEM_H;
    if (minutesEl.value) minutesEl.value.scrollTop = (MIN_COUNT + m) * ITEM_H;
  });
}

function doWrap(col: 'hours' | 'minutes') {
  const el = col === 'hours' ? hoursEl.value : minutesEl.value;
  const count = col === 'hours' ? HOUR_COUNT : MIN_COUNT;
  if (!el) return;
  const index = Math.round(el.scrollTop / ITEM_H);
  const value = ((index % count) + count) % count;
  if (col === 'hours') curHours.value = value;
  else curMinutes.value = value;
  if (index < count || index >= count * 2) {
    el.scrollTop = (count + value) * ITEM_H;
  }
}

function onScroll(col: 'hours' | 'minutes') {
  clearTimeout(scrollTimers[col]);
  scrollTimers[col] = setTimeout(() => doWrap(col), 150);
}

function onDone() {
  // Read scroll positions directly in case the debounce hasn't fired yet
  if (hoursEl.value) {
    const idx = Math.round(hoursEl.value.scrollTop / ITEM_H);
    curHours.value = ((idx % HOUR_COUNT) + HOUR_COUNT) % HOUR_COUNT;
  }
  if (minutesEl.value) {
    const idx = Math.round(minutesEl.value.scrollTop / ITEM_H);
    curMinutes.value = ((idx % MIN_COUNT) + MIN_COUNT) % MIN_COUNT;
  }
  emit('update:modelValue', curHours.value * 3600 + curMinutes.value * 60);
  emit('update:open', false);
}

watch(
  () => props.open,
  (val) => { if (val) initScroll(); },
);
</script>
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/components/DurationPickerSheet.vue
git commit -m "feat: add DurationPickerSheet drum-roll component"
```

---

## Task 3: Update CategoriesSection

**Files:**
- Modify: `src/frontend/src/components/CategoriesSection.vue`

This task wires `DurationPickerSheet` and the risk-bands editor into the existing form. A single `DurationPickerSheet` instance handles both initial wear and crossover point editing; `durationPickerTarget` tracks which field is being edited.

- [ ] **Step 1: Replace CategoriesSection.vue with the updated version**

Write `src/frontend/src/components/CategoriesSection.vue`:

```vue
<template>
  <div>
    <FormSectionHeader
      title="Categories"
      :isOpen="showCatForm"
      :showToggle="true"
      @toggle="showCatForm = !showCatForm"
    />

    <div v-if="showCatForm" class="mx-4 mb-3 p-3 bg-white border border-gray-200 rounded-2xl space-y-2">
      <!-- Name -->
      <TextField id="cat-name" label="Name" v-model="catForm.name" />

      <!-- Icon + submit row -->
      <div class="flex gap-2 items-end">
        <div class="flex-1">
          <IconPickerTrigger label="Icon" :modelValue="catForm.icon" @click="showIconPicker = true" />
        </div>
        <k-button @click="onAddCategory" :disabled="!catForm.name || !catForm.icon">
          Add
        </k-button>
      </div>

      <!-- Initial wear -->
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Initial wear</label>
        <button
          type="button"
          class="flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          @click="openDurationPicker('initialWear')"
        >
          <span>{{ shortDuration(catForm.initialWearSeconds) }}</span>
          <span class="text-gray-400">▾</span>
        </button>
      </div>

      <!-- Rest multiplier -->
      <div>
        <label for="cat-rest-mult" class="block text-sm font-medium text-gray-700 mb-1">Rest multiplier</label>
        <input
          id="cat-rest-mult"
          :value="catForm.restMultiplier"
          @input="catForm.restMultiplier = Number(($event.target as HTMLInputElement).value)"
          @blur="onRestMultiplierBlur"
          type="number"
          min="0"
          step="0.1"
          class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <!-- Risk bands -->
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Risk bands</label>
        <div class="space-y-1">
          <template v-for="(bandName, i) in bandNames" :key="i">
            <!-- Band row -->
            <div
              class="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium"
              :class="bandColors[i]"
            >
              <span>{{ bandName }}</span>
              <!-- +/- controls sit on the last band row -->
              <div v-if="i === catForm.bandCount - 1" class="flex gap-1">
                <button
                  type="button"
                  class="w-7 h-7 rounded-full border border-gray-400 flex items-center justify-center text-gray-600 disabled:opacity-30"
                  :disabled="catForm.bandCount <= 1"
                  @click="removeBand"
                >−</button>
                <button
                  type="button"
                  class="w-7 h-7 rounded-full border border-gray-400 flex items-center justify-center text-gray-600 disabled:opacity-30"
                  :disabled="catForm.bandCount >= 5"
                  @click="addBand"
                >+</button>
              </div>
            </div>
            <!-- Crossover point (between bands) -->
            <button
              v-if="i < catForm.bandCount - 1"
              type="button"
              class="flex items-center gap-1 px-3 text-sm text-gray-500"
              @click="openDurationPicker(i)"
            >
              <span>{{ shortDuration(catForm.crossoverPoints[i]) }}</span>
              <span>▾</span>
            </button>
          </template>
        </div>
      </div>

      <IconPickerSheet
        v-model="catForm.icon"
        :open="showIconPicker"
        @update:open="showIconPicker = $event"
      />
    </div>

    <!-- Duration picker (shared for initial wear + crossover points) -->
    <DurationPickerSheet
      :modelValue="durationPickerValue"
      :open="showDurationPicker"
      @update:modelValue="onDurationPicked"
      @update:open="showDurationPicker = $event"
    />

    <div v-if="loading" class="text-center py-4 text-gray-400">Loading…</div>
    <template v-else>
      <k-list v-if="categories.length > 0" inset class="!my-2">
        <k-list-item
          v-for="cat in categories"
          :key="cat.id"
          :title="cat.name"
        >
          <template #media>
            <Icon v-if="cat.icon?.includes(':')" :icon="cat.icon" class="text-2xl w-8 h-8" />
            <span v-else class="text-2xl">{{ cat.icon }}</span>
          </template>
          <template #after>
            <k-button small outline type="button" @click="onDeleteCategory(cat.id)">Delete</k-button>
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
import { ref, reactive, computed, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { kList, kListItem, kButton, kBlock } from 'konsta/vue';
import { useCategories } from '../composables/useCategories.js';
import { useItems } from '../composables/useItems.js';
import { useToast } from '../composables/useToast.js';
import { DEFAULT_CATEGORY_FIELDS } from '../utils/categoryDefaults.js';
import { bandNamesForCount, buildRiskLevels, BAND_COLORS } from '../utils/riskLevels.js';
import { shortDuration } from '../utils/formatDuration.js';
import TextField from './TextField.vue';
import FormSectionHeader from './FormSectionHeader.vue';
import IconPickerTrigger from './IconPickerTrigger.vue';
import IconPickerSheet from './IconPickerSheet.vue';
import DurationPickerSheet from './DurationPickerSheet.vue';

const { categories, loadCategories, createCategory, deleteCategory } = useCategories();
const { loadItems } = useItems();
const { showError } = useToast();

const loading = ref(true);
const showCatForm = ref(false);
const showIconPicker = ref(false);
const showDurationPicker = ref(false);
const durationPickerTarget = ref<'initialWear' | number>('initialWear');
const durationPickerValue = ref(0);

const catForm = reactive({
  name: '',
  icon: '',
  initialWearSeconds: 900,
  restMultiplier: 2,
  bandCount: 3,
  crossoverPoints: [3600, 7200] as number[],
});

const bandNames = computed(() => bandNamesForCount(catForm.bandCount));
const bandColors = computed(() => BAND_COLORS[catForm.bandCount - 1]);

onMounted(async () => {
  try {
    await loadCategories();
  } finally {
    loading.value = false;
  }
});

function openDurationPicker(target: 'initialWear' | number) {
  durationPickerTarget.value = target;
  durationPickerValue.value =
    target === 'initialWear' ? catForm.initialWearSeconds : catForm.crossoverPoints[target as number];
  showDurationPicker.value = true;
}

function onDurationPicked(seconds: number) {
  const target = durationPickerTarget.value;
  if (target === 'initialWear') {
    catForm.initialWearSeconds = seconds;
    return;
  }
  const idx = target as number;
  const prev = idx > 0 ? catForm.crossoverPoints[idx - 1] : 0;
  const next =
    idx < catForm.crossoverPoints.length - 1 ? catForm.crossoverPoints[idx + 1] : Infinity;
  catForm.crossoverPoints[idx] = Math.max(prev + 60, Math.min(next - 60, seconds));
}

function onRestMultiplierBlur(e: Event) {
  const val = Number((e.target as HTMLInputElement).value);
  if (isNaN(val) || (e.target as HTMLInputElement).value === '') {
    catForm.restMultiplier = 2;
  } else {
    catForm.restMultiplier = Math.max(0, val);
  }
}

function addBand() {
  if (catForm.bandCount >= 5) return;
  const last = catForm.crossoverPoints[catForm.crossoverPoints.length - 1] ?? 0;
  catForm.crossoverPoints.push(last + 3600);
  catForm.bandCount++;
}

function removeBand() {
  if (catForm.bandCount <= 1) return;
  catForm.crossoverPoints.pop();
  catForm.bandCount--;
}

function resetForm() {
  catForm.name = '';
  catForm.icon = '';
  catForm.initialWearSeconds = 900;
  catForm.restMultiplier = 2;
  catForm.bandCount = 3;
  catForm.crossoverPoints = [3600, 7200];
}

async function onAddCategory() {
  if (!catForm.name || !catForm.icon) return;
  try {
    await createCategory({
      name: catForm.name,
      icon: catForm.icon,
      initial_wear_duration_seconds: catForm.initialWearSeconds,
      rest_multiplier: catForm.restMultiplier,
      rest_constant_seconds: DEFAULT_CATEGORY_FIELDS.rest_constant_seconds,
      risk_levels: buildRiskLevels(catForm.bandCount, catForm.crossoverPoints),
      break_decay_multiplier: DEFAULT_CATEGORY_FIELDS.break_decay_multiplier,
      break_starts_after_seconds: DEFAULT_CATEGORY_FIELDS.break_starts_after_seconds,
    });
    resetForm();
    showCatForm.value = false;
    showIconPicker.value = false;
  } catch (e) {
    showError(String(e));
  }
}

async function onDeleteCategory(id: number) {
  if (!confirm('Delete this category and all its items?')) return;
  try {
    await deleteCategory(id);
  } catch (e) {
    showError(String(e));
    return;
  }
  await loadItems().catch(() => {});
}
</script>
```

- [ ] **Step 2: Verify the app builds without errors**

```bash
cd src/frontend && npx vite build 2>&1 | tail -20
```

Expected: `✓ built in` with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/components/CategoriesSection.vue
git commit -m "feat: add initial wear, rest multiplier, and risk bands to category form"
```

---

## Task 4: End-to-end tests

**Files:**
- Modify: `src/frontend/tests/e2e/categories.spec.ts`

Two new tests:
1. **Wrap-around:** opens the duration picker, scrolls a column past the end, confirms it snaps back into the middle third.
2. **Custom values:** creates a category with 1h initial wear (set via the picker), rest multiplier 1.5, and 4 bands; verifies the saved values match via the API.

The e2e tests require the app (frontend + backend) to be running at `http://localhost:3000`. Run them with `cd src/frontend && npx playwright test tests/e2e/categories.spec.ts`.

- [ ] **Step 1: Add the two new tests to categories.spec.ts**

Append inside the existing `test.describe('Category management', ...)` block, after the last existing test:

```ts
  test('duration picker hours column wraps when scrolled past the end', async ({ page }) => {
    await page.goto('/items');
    await page.getByRole('button', { name: '+ Add', exact: false }).first().click();

    // Open the duration picker via the Initial wear button
    await page.getByRole('button', { name: /▾/ }).first().click();
    await page.waitForSelector('[data-testid="hours-col"]');

    // Scroll the hours column to the very bottom of the tripled list
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="hours-col"]') as HTMLElement;
      el.scrollTop = el.scrollHeight;
    });

    // Wait for the debounce (150ms) + snap (allow 300ms total)
    await page.waitForTimeout(300);

    const scrollTop = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="hours-col"]') as HTMLElement;
      return el.scrollTop;
    });

    // After wrap the position must be in the middle third: [24*44, 2*24*44)
    expect(scrollTop).toBeGreaterThanOrEqual(24 * 44);
    expect(scrollTop).toBeLessThan(2 * 24 * 44);

    // Dismiss the picker without saving
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('can create a category with custom initial wear, rest multiplier, and band count', async ({ page }) => {
    const name = `Cat-${uid()}`;
    createdName = name;

    await page.goto('/items');
    await page.getByRole('button', { name: '+ Add', exact: false }).first().click();
    await page.getByLabel('Name').first().fill(name);

    // Open icon picker and select any icon via aria-label
    await page.getByRole('button', { name: /choose icon/i }).click();
    await page.waitForSelector('.overflow-y-auto'); // icon grid
    await page.locator('.overflow-y-auto button').first().click(); // pick first icon

    // Set initial wear to 1h 30m via the picker
    await page.getByRole('button', { name: /▾/ }).first().click();
    await page.waitForSelector('[data-testid="hours-col"]');
    // Scroll hours to 1 (middle copy index = 24 + 1 = 25, scrollTop = 25 * 44)
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="hours-col"]') as HTMLElement;
      el.scrollTop = 25 * 44;
    });
    // Scroll minutes to 30 (middle copy index = 60 + 30 = 90, scrollTop = 90 * 44)
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="minutes-col"]') as HTMLElement;
      el.scrollTop = 90 * 44;
    });
    await page.waitForTimeout(200); // let scroll settle
    await page.getByRole('button', { name: 'Done' }).click();

    // Set rest multiplier to 1.5
    await page.getByLabel(/rest multiplier/i).fill('1.5');

    // Add a 4th band
    await page.getByRole('button', { name: '+' }).click();

    // Submit
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByText(name).first().waitFor();

    // Verify via API
    const res = await page.request.get('/api/categories');
    const cats: Array<{
      name: string;
      initial_wear_duration_seconds: number;
      rest_multiplier: number;
      risk_levels: unknown[];
    }> = await res.json();
    const saved = cats.find((c) => c.name === name);

    expect(saved).toBeDefined();
    expect(saved!.initial_wear_duration_seconds).toBe(1 * 3600 + 30 * 60); // 5400
    expect(saved!.rest_multiplier).toBe(1.5);
    expect(saved!.risk_levels).toHaveLength(4);
  });
```

- [ ] **Step 2: Run the new e2e tests** (requires app running at localhost:3000)

```bash
cd src/frontend && npx playwright test tests/e2e/categories.spec.ts --reporter=line
```

Expected: All tests in the file pass (including the 5 pre-existing ones).

- [ ] **Step 3: Commit**

```bash
git add src/frontend/tests/e2e/categories.spec.ts
git commit -m "test: add e2e tests for duration picker wrap-around and custom category fields"
```
