# Icon Selector for Add Category — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text icon `TextField` in the Add Category form with a Phosphor icon picker bottom sheet, backed by build-time generated category data.

**Architecture:** A Vite plugin generates `src/generated/ph-categories.json` at build time from `@phosphor-icons/core`. A new `IconPickerSheet.vue` bottom sheet component consumes that JSON, with search and category pill shortcuts. `CategoriesSection.vue` swaps its icon text field for the new trigger + sheet pair.

**Tech Stack:** Vue 3 (Composition API), Konsta/Vue (`k-sheet`, `k-toolbar`, `k-button`), `@iconify/vue` (`<Icon>`), Vite plugin API, Vitest, Tailwind CSS v4

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/frontend/src/utils/phCategories.ts` | Types + pure functions (`buildPhCategories`, `filterIcons`) |
| Create | `src/frontend/src/utils/phCategories.test.ts` | Vitest unit tests for the above |
| Create | `src/frontend/vite-plugin-ph-categories.ts` | Vite plugin — generates `ph-categories.json` at build start |
| Modify | `src/frontend/vite.config.ts` | Register the plugin |
| Modify | `src/frontend/.gitignore` (create if absent) | Gitignore `src/generated/` |
| Create | `src/frontend/src/generated/ph-categories.json` | Auto-generated; never hand-edited |
| Create | `src/frontend/src/components/IconPickerTrigger.vue` | Trigger button showing current icon |
| Create | `src/frontend/src/components/IconPickerSheet.vue` | Bottom sheet with search + category grid |
| Modify | `src/frontend/src/components/CategoriesSection.vue` | Swap icon TextField for trigger + sheet |

---

## Task 1: Install dependencies

**Files:**
- Modify: `src/frontend/package.json` (via npm)

- [ ] **Step 1: Install vitest (currently missing despite being in scripts) and @phosphor-icons/core**

```bash
cd src/frontend
npm install --save-dev vitest @phosphor-icons/core
```

Expected output: both packages appear under `devDependencies` in `package.json`.

- [ ] **Step 2: Verify existing tests pass**

```bash
cd src/frontend
npm run test -- --run
```

Expected: all tests pass (colors.test.ts, formatDuration.test.ts).

- [ ] **Step 3: Commit**

```bash
git add src/frontend/package.json src/frontend/package-lock.json
git commit -m "chore: install vitest and @phosphor-icons/core"
```

---

## Task 2: Write + test phCategories utility

**Files:**
- Create: `src/frontend/src/utils/phCategories.ts`
- Create: `src/frontend/src/utils/phCategories.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/frontend/src/utils/phCategories.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildPhCategories, filterIcons } from './phCategories.js';
import type { PhCategories } from './phCategories.js';

// Minimal mock that mirrors the shape from @phosphor-icons/core
const mockIcons = [
  { name: 'arrow-up', categories: ['arrows'], tags: ['up', 'direction'] },
  { name: 'arrow-up-bold', categories: ['arrows'], tags: ['up', 'direction'] },
  { name: 'arrow-up-fill', categories: ['arrows'], tags: ['up', 'direction'] },
  { name: 'arrow-up-light', categories: ['arrows'], tags: ['up', 'direction'] },
  { name: 'arrow-up-thin', categories: ['arrows'], tags: ['up', 'direction'] },
  { name: 'arrow-up-duotone', categories: ['arrows'], tags: ['up', 'direction'] },
  { name: 'heart', categories: ['health & wellness', 'people'], tags: ['love', 'care'] },
  { name: 'sneaker', categories: ['objects'], tags: ['shoe', 'footwear'] },
];

describe('buildPhCategories', () => {
  it('excludes all weight variants', () => {
    const result = buildPhCategories(mockIcons);
    for (const entries of Object.values(result)) {
      for (const entry of entries) {
        expect(entry.id).not.toMatch(/-(bold|fill|light|thin|duotone)$/);
      }
    }
  });

  it('prefixes icon names with ph:', () => {
    const result = buildPhCategories(mockIcons);
    expect(result['arrows'][0].id).toBe('ph:arrow-up');
  });

  it('includes tags from the source icon', () => {
    const result = buildPhCategories(mockIcons);
    expect(result['arrows'][0].tags).toEqual(['up', 'direction']);
  });

  it('places an icon in all its categories', () => {
    const result = buildPhCategories(mockIcons);
    expect(result['health & wellness'].map((e) => e.id)).toContain('ph:heart');
    expect(result['people'].map((e) => e.id)).toContain('ph:heart');
  });

  it('returns only one arrow entry (bold/fill/etc excluded)', () => {
    const result = buildPhCategories(mockIcons);
    expect(result['arrows']).toHaveLength(1);
  });
});

describe('filterIcons', () => {
  const cats: PhCategories = {
    arrows: [{ id: 'ph:arrow-up', tags: ['direction', 'up'] }],
    'health & wellness': [{ id: 'ph:heart', tags: ['love', 'care'] }],
    people: [{ id: 'ph:heart', tags: ['love', 'care'] }],
    objects: [{ id: 'ph:sneaker', tags: ['shoe', 'footwear'] }],
  };

  it('returns empty array for empty query', () => {
    expect(filterIcons(cats, '')).toEqual([]);
    expect(filterIcons(cats, '   ')).toEqual([]);
  });

  it('matches by icon name (without ph: prefix)', () => {
    const result = filterIcons(cats, 'arrow');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ph:arrow-up');
  });

  it('matches by tag', () => {
    const result = filterIcons(cats, 'shoe');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ph:sneaker');
  });

  it('deduplicates icons that appear in multiple categories', () => {
    const result = filterIcons(cats, 'love');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ph:heart');
  });

  it('returns empty array when nothing matches', () => {
    expect(filterIcons(cats, 'zzzzz')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(filterIcons(cats, 'ARROW')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests — expect failures (functions not yet defined)**

```bash
cd src/frontend
npm run test -- --run src/utils/phCategories.test.ts
```

Expected: FAIL — "Cannot find module './phCategories.js'"

- [ ] **Step 3: Write the implementation**

Create `src/frontend/src/utils/phCategories.ts`:

```typescript
export type PhIconEntry = { id: string; tags: string[] };
export type PhCategories = Record<string, PhIconEntry[]>;

const WEIGHT_SUFFIXES = ['-bold', '-fill', '-light', '-thin', '-duotone'] as const;

/**
 * Pure transform: takes the raw icons array from @phosphor-icons/core and
 * returns a map of category name → icon entries.
 * Only regular-weight icons are included (no -bold, -fill, -light, -thin, -duotone).
 * An icon that belongs to multiple categories appears in each.
 */
export function buildPhCategories(
  icons: Array<{ name: string; categories: string[]; tags: string[] }>
): PhCategories {
  const result: PhCategories = {};
  for (const icon of icons) {
    if (WEIGHT_SUFFIXES.some((s) => icon.name.endsWith(s))) continue;
    for (const cat of icon.categories) {
      if (!result[cat]) result[cat] = [];
      result[cat].push({ id: `ph:${icon.name}`, tags: icon.tags });
    }
  }
  return result;
}

/**
 * Filter icons across all categories by query string.
 * Matches against the icon name (without 'ph:' prefix) and tags.
 * Returns a deduplicated flat array (an icon in multiple categories appears once).
 * Returns [] for an empty query.
 */
export function filterIcons(categories: PhCategories, query: string): PhIconEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const seen = new Set<string>();
  const results: PhIconEntry[] = [];
  for (const entries of Object.values(categories)) {
    for (const entry of entries) {
      if (seen.has(entry.id)) continue;
      const name = entry.id.replace('ph:', '');
      if (name.includes(q) || entry.tags.some((t) => t.includes(q))) {
        results.push(entry);
        seen.add(entry.id);
      }
    }
  }
  return results;
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
cd src/frontend
npm run test -- --run src/utils/phCategories.test.ts
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/utils/phCategories.ts src/frontend/src/utils/phCategories.test.ts
git commit -m "feat: phCategories utility — buildPhCategories and filterIcons"
```

---

## Task 3: Write Vite plugin and wire it up

**Files:**
- Create: `src/frontend/vite-plugin-ph-categories.ts`
- Modify: `src/frontend/vite.config.ts`
- Modify: `src/frontend/.gitignore` (or create it)

- [ ] **Step 1: Gitignore the generated directory**

Check whether `src/frontend/.gitignore` exists. If it does, append to it; if not, create it.

Add this line:
```
src/generated/
```

- [ ] **Step 2: Create the Vite plugin**

Create `src/frontend/vite-plugin-ph-categories.ts`:

```typescript
import type { Plugin } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { icons } from '@phosphor-icons/core';
import { buildPhCategories } from './src/utils/phCategories.js';

/**
 * Vite plugin: generates src/generated/ph-categories.json at build start.
 * Runs on both `vite dev` and `vite build`.
 */
export default function phCategoriesPlugin(): Plugin {
  return {
    name: 'ph-categories',
    buildStart() {
      const data = buildPhCategories(icons as Array<{ name: string; categories: string[]; tags: string[] }>);
      const outDir = join(process.cwd(), 'src', 'generated');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'ph-categories.json'), JSON.stringify(data));
    },
  };
}
```

- [ ] **Step 3: Register the plugin in vite.config.ts**

Open `src/frontend/vite.config.ts`. Current content:

```typescript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
```

Add the import and register the plugin:

```typescript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import phCategoriesPlugin from './vite-plugin-ph-categories.js';

export default defineConfig({
  plugins: [
    phCategoriesPlugin(),
    tailwindcss(),
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,gif}'],
      },
      manifest: {
        name: 'Weartrack',
        short_name: 'Weartrack',
        description: 'Track your wearable usage',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  base: './',
});
```

- [ ] **Step 4: Run the build to verify JSON is generated**

```bash
cd src/frontend
npm run build 2>&1 | tail -20
```

Expected: build completes without errors. Then verify:

```bash
ls -lh src/frontend/src/generated/ph-categories.json
```

Expected: file exists, size roughly 60–90 KB.

```bash
node -e "const d = require('./src/frontend/src/generated/ph-categories.json'); const cats = Object.keys(d); console.log('Categories:', cats.length, cats.slice(0,5)); const total = Object.values(d).reduce((n, arr) => n + arr.length, 0); console.log('Total entries (with dupes):', total); console.log('Sample:', JSON.stringify(d[cats[0]][0]))"
```

Expected output (approximately):
```
Categories: 18 [ 'arrows', 'brands', 'commerce', 'communications', 'design' ]
Total entries (with dupes): ~1800
Sample: {"id":"ph:arrow-up","tags":["direction","up"]}
```

- [ ] **Step 5: Commit**

```bash
git add src/frontend/vite-plugin-ph-categories.ts src/frontend/vite.config.ts src/frontend/.gitignore src/frontend/package.json src/frontend/package-lock.json
git commit -m "feat: Vite plugin generates ph-categories.json at build time"
```

---

## Task 4: Write IconPickerTrigger.vue

**Files:**
- Create: `src/frontend/src/components/IconPickerTrigger.vue`

This is a purely presentational component — a button that shows the currently selected icon (or a "Choose icon" placeholder), styled to match the existing `TextField`.

- [ ] **Step 1: Create the component**

Create `src/frontend/src/components/IconPickerTrigger.vue`:

```vue
<template>
  <div>
    <label class="block text-sm font-medium text-gray-700 mb-1">Icon</label>
    <button
      type="button"
      class="flex items-center gap-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-left"
      @click="$emit('click')"
    >
      <template v-if="modelValue">
        <Icon :icon="modelValue" class="text-xl shrink-0" />
        <span class="text-gray-700">{{ modelValue.replace('ph:', '') }}</span>
      </template>
      <template v-else>
        <Icon icon="ph:squares-four" class="text-xl shrink-0 text-gray-400" />
        <span class="text-gray-400">Choose icon…</span>
      </template>
    </button>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';

defineProps<{ modelValue: string }>();
defineEmits<{ click: [] }>();
</script>
```

- [ ] **Step 2: Confirm `ph:squares-four` exists in the icon set**

```bash
node -e "const d = require('./src/frontend/src/generated/ph-categories.json'); const all = Object.values(d).flat(); const found = all.find(e => e.id === 'ph:squares-four'); console.log(found ? 'found: ' + found.id : 'NOT FOUND - pick a different placeholder')"
```

If not found, pick another grid-like icon (e.g. `ph:grid-four` or `ph:dots-nine`) from the generated JSON and update the `icon="ph:..."` value in the template above.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/components/IconPickerTrigger.vue
git commit -m "feat: IconPickerTrigger component"
```

---

## Task 5: Write IconPickerSheet.vue

**Files:**
- Create: `src/frontend/src/components/IconPickerSheet.vue`

This is the main bottom sheet. It imports the generated JSON, provides a search input, category shortcut pills with `IntersectionObserver`-driven active state, and a scrollable icon grid.

- [ ] **Step 1: Create the component**

Create `src/frontend/src/components/IconPickerSheet.vue`:

```vue
<template>
  <k-sheet
    v-if="open"
    :opened="open"
    @backdropclick="close"
    class="pb-safe bg-white dark:bg-gray-900 flex flex-col"
    style="height: 85vh"
  >
    <!-- Header -->
    <k-toolbar>
      <div class="flex w-full items-center justify-between px-4">
        <span class="font-semibold">Choose Icon</span>
        <k-button clear @click="close">✕</k-button>
      </div>
    </k-toolbar>

    <!-- Search -->
    <div class="px-4 py-2 shrink-0">
      <input
        v-model="query"
        type="search"
        placeholder="Search icons…"
        class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>

    <!-- Category shortcut pills (hidden while searching) -->
    <div
      v-if="!query.trim()"
      class="flex gap-2 overflow-x-auto px-4 pb-2 shrink-0"
      style="scrollbar-width: none; -webkit-overflow-scrolling: touch"
    >
      <button
        v-for="cat in categoryNames"
        :key="cat"
        :ref="(el) => setPillRef(cat, el)"
        type="button"
        class="shrink-0 px-3 py-1 rounded-full text-xs border transition-colors whitespace-nowrap"
        :class="
          activeCategory === cat
            ? 'bg-blue-500 text-white border-blue-500'
            : 'bg-white text-gray-600 border-gray-300'
        "
        @click="scrollToCategory(cat)"
      >
        {{ cat }}
      </button>
    </div>

    <!-- Scrollable icon grid -->
    <div ref="gridEl" class="overflow-y-auto flex-1 px-4 pb-8">

      <!-- Search mode: flat deduplicated grid -->
      <template v-if="query.trim()">
        <p v-if="searchResults.length === 0" class="text-center py-8 text-gray-400 text-sm">
          No icons found
        </p>
        <div v-else class="grid gap-1" style="grid-template-columns: repeat(8, minmax(0, 1fr))">
          <button
            v-for="entry in searchResults"
            :key="entry.id"
            type="button"
            class="flex items-center justify-center w-10 h-10 rounded-lg"
            :class="entry.id === modelValue ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-gray-100'"
            :title="entry.id.replace('ph:', '')"
            @click="select(entry.id)"
          >
            <Icon :icon="entry.id" class="text-2xl" />
          </button>
        </div>
      </template>

      <!-- Categorised mode: sections with headings -->
      <template v-else>
        <div v-for="cat in categoryNames" :key="cat">
          <h3
            :ref="(el) => setHeadingRef(cat, el)"
            :data-category="cat"
            class="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-2"
          >
            {{ cat }}
          </h3>
          <div class="grid gap-1" style="grid-template-columns: repeat(8, minmax(0, 1fr))">
            <button
              v-for="entry in (categoriesData as PhCategories)[cat]"
              :key="entry.id"
              type="button"
              class="flex items-center justify-center w-10 h-10 rounded-lg"
              :class="entry.id === modelValue ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-gray-100'"
              :title="entry.id.replace('ph:', '')"
              @click="select(entry.id)"
            >
              <Icon :icon="entry.id" class="text-2xl" />
            </button>
          </div>
        </div>
      </template>

    </div>
  </k-sheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { Icon } from '@iconify/vue';
import { kSheet, kToolbar, kButton } from 'konsta/vue';
import type { PhCategories } from '../utils/phCategories.js';
import { filterIcons } from '../utils/phCategories.js';
import categoriesData from '../generated/ph-categories.json';

const props = defineProps<{ modelValue: string; open: boolean }>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:open': [value: boolean];
}>();

const query = ref('');
const activeCategory = ref('');
const gridEl = ref<HTMLElement | null>(null);

// Non-reactive maps — Vue doesn't need to track individual el references
const headingEls: Record<string, HTMLElement | null> = {};
const pillEls: Record<string, HTMLElement | null> = {};

let observer: IntersectionObserver | null = null;

const categoryNames = computed(() => Object.keys(categoriesData as PhCategories));

const searchResults = computed(() =>
  filterIcons(categoriesData as PhCategories, query.value)
);

function setHeadingRef(cat: string, el: unknown) {
  headingEls[cat] = el as HTMLElement | null;
}

function setPillRef(cat: string, el: unknown) {
  pillEls[cat] = el as HTMLElement | null;
}

function select(id: string) {
  emit('update:modelValue', id);
  emit('update:open', false);
}

function close() {
  emit('update:open', false);
}

function scrollToCategory(cat: string) {
  headingEls[cat]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setupObserver() {
  observer?.disconnect();
  if (!gridEl.value) return;
  observer = new IntersectionObserver(
    (entries) => {
      // Find the first heading that is intersecting (topmost visible)
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const cat = (entry.target as HTMLElement).dataset.category ?? '';
          activeCategory.value = cat;
          pillEls[cat]?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
          break;
        }
      }
    },
    {
      root: gridEl.value,
      threshold: 0.1,
    }
  );
  for (const el of Object.values(headingEls)) {
    if (el) observer.observe(el);
  }
}

watch(
  () => props.open,
  (val) => {
    if (!val) {
      query.value = '';
      activeCategory.value = '';
      observer?.disconnect();
      observer = null;
    } else {
      // Wait for DOM (k-sheet uses v-if so headings aren't mounted until open)
      nextTick(() => setupObserver());
    }
  }
);
</script>
```

- [ ] **Step 2: Verify the generated JSON resolves the TypeScript import**

The import `from '../generated/ph-categories.json'` requires TypeScript to resolve JSON modules. Check that `src/frontend/tsconfig.json` has `resolveJsonModule: true` (or that Vite handles it by default, which it does). If there's a `tsconfig.json`, open it and confirm. Vite resolves JSON imports natively, so no change is needed unless the TS server complains.

```bash
ls src/frontend/tsconfig.json 2>/dev/null && cat src/frontend/tsconfig.json || echo "No tsconfig found — Vite handles JSON imports natively, no action needed"
```

If `tsconfig.json` exists and lacks `"resolveJsonModule": true`, add it to `compilerOptions`.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/components/IconPickerSheet.vue
git commit -m "feat: IconPickerSheet — categorised Phosphor icon browser with search"
```

---

## Task 6: Wire up CategoriesSection.vue

**Files:**
- Modify: `src/frontend/src/components/CategoriesSection.vue`

Replace the icon `TextField` and its surrounding layout with `IconPickerTrigger` + `IconPickerSheet`.

- [ ] **Step 1: Update the template**

Current form block in `CategoriesSection.vue` (lines 10–20):

```vue
<div v-if="showCatForm" class="mx-4 mb-3 p-3 bg-white border border-gray-200 rounded-2xl space-y-2">
  <TextField id="cat-name" label="Name" v-model="catForm.name" />
  <div class="flex gap-2 items-end">
    <div class="flex-1 min-w-[10ch]">
      <TextField id="cat-icon" label="Icon" v-model="catForm.icon" placeholder="👟" />
    </div>
    <k-button @click="onAddCategory" :disabled="!catForm.name || !catForm.icon">
      Add
    </k-button>
  </div>
</div>
```

Replace with:

```vue
<div v-if="showCatForm" class="mx-4 mb-3 p-3 bg-white border border-gray-200 rounded-2xl space-y-2">
  <TextField id="cat-name" label="Name" v-model="catForm.name" />
  <div class="flex gap-2 items-end">
    <div class="flex-1">
      <IconPickerTrigger :modelValue="catForm.icon" @click="showIconPicker = true" />
    </div>
    <k-button @click="onAddCategory" :disabled="!catForm.name || !catForm.icon">
      Add
    </k-button>
  </div>
  <IconPickerSheet
    v-model="catForm.icon"
    :open="showIconPicker"
    @update:open="showIconPicker = $event"
  />
</div>
```

- [ ] **Step 2: Update the script block**

Current script imports in `CategoriesSection.vue`:

```typescript
import { ref, reactive, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { kList, kListItem, kButton, kBlock } from 'konsta/vue';
import { useCategories } from '../composables/useCategories.js';
import { useItems } from '../composables/useItems.js';
import { useToast } from '../composables/useToast.js';
import { DEFAULT_CATEGORY_FIELDS } from '../utils/categoryDefaults.js';
import TextField from './TextField.vue';
import FormSectionHeader from './FormSectionHeader.vue';
```

Replace with (adds `IconPickerTrigger`, `IconPickerSheet`; keeps everything else):

```typescript
import { ref, reactive, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { kList, kListItem, kButton, kBlock } from 'konsta/vue';
import { useCategories } from '../composables/useCategories.js';
import { useItems } from '../composables/useItems.js';
import { useToast } from '../composables/useToast.js';
import { DEFAULT_CATEGORY_FIELDS } from '../utils/categoryDefaults.js';
import TextField from './TextField.vue';
import FormSectionHeader from './FormSectionHeader.vue';
import IconPickerTrigger from './IconPickerTrigger.vue';
import IconPickerSheet from './IconPickerSheet.vue';
```

Add `showIconPicker` ref alongside the existing refs:

```typescript
const loading = ref(true);
const showCatForm = ref(false);
const showIconPicker = ref(false);
const catForm = reactive({ name: '', icon: '' });
```

Also reset `showIconPicker` when the form is reset after a successful add — in `onAddCategory`:

```typescript
async function onAddCategory() {
  if (!catForm.name || !catForm.icon) return;
  try {
    await createCategory({ name: catForm.name, icon: catForm.icon, ...DEFAULT_CATEGORY_FIELDS });
    catForm.name = '';
    catForm.icon = '';
    showCatForm.value = false;
    showIconPicker.value = false;
  } catch (e) {
    showError(String(e));
  }
}
```

- [ ] **Step 3: Run the dev server and manually verify**

```bash
cd src/frontend
npm run dev
```

Open the app. On the Home tab → Items section:
1. Tap "+ Add" next to Categories
2. Type a name
3. Tap the "Choose icon…" button — the bottom sheet should open
4. Scroll through categories; verify pills highlight as you scroll
5. Tap a pill — grid should smooth-scroll to that category
6. Type in the search box — flat grid appears, "No icons found" if no match
7. Tap an icon — sheet closes, trigger button shows selected icon + name
8. Tap Add — category appears in the list with the icon

- [ ] **Step 4: Run all tests to confirm nothing is broken**

```bash
cd src/frontend
npm run test -- --run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/CategoriesSection.vue
git commit -m "feat: replace icon text field with IconPickerSheet in Add Category form"
```

---

## Self-Review Notes

- **Spec coverage:** All spec requirements covered: Vite plugin (Task 3), `IconPickerTrigger` (Task 4), `IconPickerSheet` with search + category pills + IntersectionObserver (Task 5), `CategoriesSection.vue` wired up (Task 6), no backend changes needed.
- **Out of scope confirmed:** No emoji support, no icon weight selection, no edit-category flow.
- **Type consistency:** `PhIconEntry` and `PhCategories` defined once in `phCategories.ts` and imported everywhere. `buildPhCategories` signature consistent between utility and plugin. `filterIcons` signature consistent between utility, test, and sheet.
- **Generated file path** is `src/generated/ph-categories.json` throughout (plugin writes it, sheet imports it, gitignore excludes it).
