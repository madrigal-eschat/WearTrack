# Color Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an oklch-based color picker popover to the item create form, with preset swatches and hidden advanced sliders, storing colors as valid CSS oklch strings.

**Architecture:** A new `ColorPicker.vue` component exposes a v-model interface and opens a Konsta `Popover` with 12 preset swatches and collapsible hue/chroma sliders. Color math lives in `src/frontend/src/utils/colors.ts`. A new DB migration resets existing item colors to a valid oklch default.

**Tech Stack:** Vue 3 (Composition API), Konsta UI (kPopover), Tailwind CSS v4, better-sqlite3 migrations, Playwright (E2E), Vitest (unit)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/backend/src/db/migrations/002_oklch_colors.ts` | Reset existing item colors to oklch default |
| Modify | `src/backend/src/db/migrations/index.ts` | Register migration 002 |
| Create | `src/frontend/src/utils/colors.ts` | `MAX_LIGHTNESS`, `SWATCHES`, `randomSwatchColor`, `buildOklch` |
| Create | `src/frontend/src/utils/colors.test.ts` | Unit tests for color utilities |
| Modify | `src/frontend/tests/e2e/items.spec.ts` | Add 3 new color picker E2E tests |
| Create | `src/frontend/src/components/ColorPicker.vue` | Popover with swatches + advanced sliders |
| Modify | `src/frontend/src/views/Items.vue` | Use ColorPicker in form, randomSwatchColor for default |

---

## Task 1: DB Migration — reset item colors to oklch

**Files:**
- Create: `src/backend/src/db/migrations/002_oklch_colors.ts`
- Modify: `src/backend/src/db/migrations/index.ts`

- [ ] **Step 1: Create the migration file**

```typescript
// src/backend/src/db/migrations/002_oklch_colors.ts
import { dbExport } from '../index.js';

export default function runMigration002() {
  dbExport.exec(`UPDATE items SET color = 'oklch(0.55 0.15 240)';`);
}
```

- [ ] **Step 2: Register the migration in the runner**

Open `src/backend/src/db/migrations/index.ts`. Replace the imports and migrations array:

```typescript
import { dbExport } from '../index.js';
import runMigration001 from './001_initial.js';
import runMigration002 from './002_oklch_colors.js';

const migrations: Array<{ version: number; name: string; run: () => void }> = [
  { version: 1, name: '001_initial', run: runMigration001 },
  { version: 2, name: '002_oklch_colors', run: runMigration002 },
];
```

Leave the `runMigrations` function body unchanged.

- [ ] **Step 3: Verify the backend tests still pass**

```bash
cd src/backend && npm test -- --run
```

Expected: all tests pass (migration 002 only runs on a fresh DB that's already past version 1; test DBs start at `:memory:` and run all migrations from scratch, so the UPDATE will succeed on an empty table without error).

- [ ] **Step 4: Commit**

```bash
git add src/backend/src/db/migrations/002_oklch_colors.ts src/backend/src/db/migrations/index.ts
git commit -m "feat: migrate item colors to oklch format"
```

---

## Task 2: Color utilities

**Files:**
- Create: `src/frontend/src/utils/colors.ts`
- Create: `src/frontend/src/utils/colors.test.ts`

- [ ] **Step 1: Write the failing unit tests**

```typescript
// src/frontend/src/utils/colors.test.ts
import { describe, it, expect } from 'vitest';
import { SWATCHES, MAX_LIGHTNESS, randomSwatchColor, buildOklch } from './colors';

describe('SWATCHES', () => {
  it('has 12 entries', () => {
    expect(SWATCHES).toHaveLength(12);
  });

  it('all use MAX_LIGHTNESS', () => {
    for (const s of SWATCHES) {
      expect(s).toContain(`oklch(${MAX_LIGHTNESS} `);
    }
  });

  it('covers hues 0–330 in 30° steps', () => {
    const hues = SWATCHES.map((s) => {
      const m = s.match(/oklch\([\d.]+ [\d.]+ ([\d.]+)\)/);
      return m ? parseFloat(m[1]) : null;
    });
    expect(hues).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]);
  });
});

describe('randomSwatchColor', () => {
  it('returns a value from SWATCHES', () => {
    const color = randomSwatchColor();
    expect(SWATCHES).toContain(color);
  });
});

describe('buildOklch', () => {
  it('assembles a CSS oklch string with MAX_LIGHTNESS', () => {
    expect(buildOklch(0.15, 240)).toBe(`oklch(${MAX_LIGHTNESS} 0.15 240)`);
  });

  it('rounds chroma to 2 decimal places', () => {
    expect(buildOklch(0.2000001, 180)).toBe(`oklch(${MAX_LIGHTNESS} 0.2 180)`);
  });

  it('rounds hue to nearest integer', () => {
    expect(buildOklch(0.15, 180.7)).toBe(`oklch(${MAX_LIGHTNESS} 0.15 181)`);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd src/frontend && npm test -- --run src/utils/colors.test.ts
```

Expected: FAIL — `Cannot find module './colors'`

- [ ] **Step 3: Create the color utilities**

```typescript
// src/frontend/src/utils/colors.ts
export const MAX_LIGHTNESS = 0.55;

export const SWATCHES: readonly string[] = Array.from({ length: 12 }, (_, i) =>
  `oklch(${MAX_LIGHTNESS} 0.15 ${i * 30})`
);

export function randomSwatchColor(): string {
  return SWATCHES[Math.floor(Math.random() * SWATCHES.length)];
}

export function buildOklch(chroma: number, hue: number): string {
  const c = Math.round(chroma * 100) / 100;
  const h = Math.round(hue);
  return `oklch(${MAX_LIGHTNESS} ${c} ${h})`;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd src/frontend && npm test -- --run src/utils/colors.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/utils/colors.ts src/frontend/src/utils/colors.test.ts
git commit -m "feat: add oklch color utilities"
```

---

## Task 3: Write failing E2E tests

**Files:**
- Modify: `src/frontend/tests/e2e/items.spec.ts`

Add the following three tests inside the existing `test.describe('Item management', ...)` block, after the last existing test.

- [ ] **Step 1: Add the swatch selection test**

```typescript
  test('can select a color via swatch', async ({ page }) => {
    const name = `Item-${uid()}`;

    await page.getByRole('button', { name: '+ Add' }).nth(1).click();
    await page.getByLabel('Name').last().fill(name);

    // Open the color picker popover
    await page.locator('[data-testid="color-trigger"]').click();

    // Click the second swatch (hue 30°)
    await page.locator('[data-testid="color-swatch"]').nth(1).click();

    await page.getByRole('button', { name: 'Add Item' }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    // Color circle style should contain oklch
    const circle = page.locator('li').filter({ hasText: name }).locator('[data-testid="color-circle"]').first();
    const style = await circle.getAttribute('style');
    expect(style).toContain('oklch');
  });
```

- [ ] **Step 2: Add the random default color test**

```typescript
  test('new items get random default colors', async ({ page }) => {
    const names = Array.from({ length: 4 }, () => `Item-${uid()}`);

    for (const name of names) {
      await page.getByRole('button', { name: '+ Add' }).nth(1).click();
      await page.getByLabel('Name').last().fill(name);
      await page.getByRole('button', { name: 'Add Item' }).click();
      await expect(page.getByText(name).first()).toBeVisible();
    }

    const colors = await Promise.all(
      names.map((name) =>
        page
          .locator('li')
          .filter({ hasText: name })
          .locator('[data-testid="color-circle"]')
          .first()
          .getAttribute('style')
      )
    );

    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThan(1);
  });
```

- [ ] **Step 3: Add the advanced sliders test**

```typescript
  test('can set color via advanced hue and chroma sliders', async ({ page }) => {
    const name = `Item-${uid()}`;

    await page.getByRole('button', { name: '+ Add' }).nth(1).click();
    await page.getByLabel('Name').last().fill(name);

    // Open color picker
    await page.locator('[data-testid="color-trigger"]').click();

    // Expand advanced sliders
    await page.getByRole('button', { name: /advanced/i }).click();

    // Set hue to 180, chroma to 0.2
    await page.locator('[data-testid="hue-slider"]').fill('180');
    await page.locator('[data-testid="chroma-slider"]').fill('0.2');

    await page.getByRole('button', { name: 'Add Item' }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    const circle = page
      .locator('li')
      .filter({ hasText: name })
      .locator('[data-testid="color-circle"]')
      .first();
    const style = await circle.getAttribute('style');
    expect(style).toContain('oklch');
    expect(style).toContain('180');
    expect(style).toContain('0.2');
  });
```

- [ ] **Step 4: Run tests to confirm they fail**

```bash
cd src/frontend && npm run test:e2e -- --grep "color"
```

Expected: all 3 new tests FAIL (elements with `data-testid="color-trigger"` etc. don't exist yet).

- [ ] **Step 5: Commit the failing tests**

```bash
git add src/frontend/tests/e2e/items.spec.ts
git commit -m "test: add failing E2E tests for color picker"
```

---

## Task 4: Implement ColorPicker.vue

**Files:**
- Create: `src/frontend/src/components/ColorPicker.vue`

- [ ] **Step 1: Create the component**

```vue
<!-- src/frontend/src/components/ColorPicker.vue -->
<template>
  <div class="inline-flex items-center">
    <button
      ref="triggerRef"
      data-testid="color-trigger"
      class="w-6 h-6 rounded-full border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
      :style="{ background: modelValue }"
      @click="opened = true"
    />

    <k-popover :opened="opened" :target-el="triggerRef" @backdropclick="opened = false">
      <div class="p-3">
        <!-- Swatches row -->
        <div class="flex flex-wrap gap-2 mb-3">
          <button
            v-for="swatch in SWATCHES"
            :key="swatch"
            data-testid="color-swatch"
            class="w-7 h-7 rounded-full border-2 focus:outline-none"
            :class="swatch === modelValue ? 'border-gray-800' : 'border-transparent'"
            :style="{ background: swatch }"
            @click="select(swatch)"
          />
        </div>

        <!-- Advanced toggle -->
        <button
          class="text-xs text-blue-500 mb-2 block"
          @click="showAdvanced = !showAdvanced"
        >
          {{ showAdvanced ? 'Hide advanced' : 'Advanced' }}
        </button>

        <!-- Sliders -->
        <div v-if="showAdvanced" class="space-y-3 min-w-48">
          <div>
            <label class="text-xs text-gray-600 block mb-1">Hue: {{ hue }}</label>
            <input
              data-testid="hue-slider"
              type="range"
              min="0"
              max="360"
              step="1"
              class="w-full"
              :value="hue"
              @input="onHueInput"
            />
          </div>
          <div>
            <label class="text-xs text-gray-600 block mb-1">Chroma: {{ chroma }}</label>
            <input
              data-testid="chroma-slider"
              type="range"
              min="0"
              max="0.3"
              step="0.01"
              class="w-full"
              :value="chroma"
              @input="onChromaInput"
            />
          </div>
        </div>
      </div>
    </k-popover>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { kPopover } from 'konsta/vue';
import { SWATCHES, buildOklch } from '../utils/colors.js';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const opened = ref(false);
const showAdvanced = ref(false);
const triggerRef = ref<HTMLElement | null>(null);

const hue = ref(240);
const chroma = ref(0.15);

watch(
  () => props.modelValue,
  (val) => {
    const m = val.match(/oklch\([\d.]+ ([\d.]+) ([\d.]+)\)/);
    if (m) {
      chroma.value = parseFloat(m[1]);
      hue.value = parseFloat(m[2]);
    }
  },
  { immediate: true }
);

function select(color: string) {
  emit('update:modelValue', color);
  opened.value = false;
}

function onHueInput(e: Event) {
  hue.value = parseFloat((e.target as HTMLInputElement).value);
  emit('update:modelValue', buildOklch(chroma.value, hue.value));
}

function onChromaInput(e: Event) {
  chroma.value = parseFloat((e.target as HTMLInputElement).value);
  emit('update:modelValue', buildOklch(chroma.value, hue.value));
}
</script>
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/components/ColorPicker.vue
git commit -m "feat: add ColorPicker component with swatches and advanced sliders"
```

---

## Task 5: Wire ColorPicker into Items.vue

**Files:**
- Modify: `src/frontend/src/views/Items.vue`

- [ ] **Step 1: Update the script section**

At the top of the `<script setup>` block, add the new imports and remove the hardcoded color default:

```typescript
import ColorPicker from '../components/ColorPicker.vue';
import { randomSwatchColor } from '../utils/colors.js';
```

Change the `itemForm` initial value so `color` uses `randomSwatchColor()`:

```typescript
const itemForm = reactive<{ name: string; color: string; category_id: number | null }>({
  name: '',
  color: randomSwatchColor(),
  category_id: null,
});
```

In `onAddItem`, replace `itemForm.color = '#3b82f6'` with:

```typescript
itemForm.color = randomSwatchColor();
```

- [ ] **Step 2: Update the template — add data-testid to the color circle**

Find the item list media slot:
```html
<div class="w-3 h-3 rounded-full" :style="{ background: item.color }"></div>
```

Replace with:
```html
<div data-testid="color-circle" class="w-3 h-3 rounded-full" :style="{ background: item.color }"></div>
```

- [ ] **Step 3: Add ColorPicker to the item form**

Find the item name input `<div>` block in the add-item form. After it (before the category select), add:

```html
<div>
  <label class="block text-sm font-medium text-gray-700 mb-1">Color</label>
  <ColorPicker v-model="itemForm.color" />
</div>
```

- [ ] **Step 4: Run all three new E2E tests**

```bash
cd src/frontend && npm run test:e2e -- --grep "color"
```

Expected: all 3 pass.

- [ ] **Step 5: Run the full items E2E suite to check for regressions**

```bash
cd src/frontend && npm run test:e2e -- tests/e2e/items.spec.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/views/Items.vue
git commit -m "feat: integrate color picker into item form with random default"
```
