# Page Title Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every view a consistent page-title bar (`PageHeader`), move the settings-gear button into Home's header, and fix the visual hierarchy/styling of `SectionTitle`'s `section`/`group` variants.

**Architecture:** One new `PageHeader.vue` component (title + optional back button + optional trailing action slot), applied to all 5 views. `SectionTitle.vue`'s existing variant-to-class map gets 2 entries edited. One padding tweak in `ItemsSection.vue`.

**Tech Stack:** Vue 3 `<script setup lang="ts">`, Tailwind CSS v4, Vitest (unit — none needed here, no new logic), Playwright (e2e, existing specs must keep passing, especially `tests/e2e/settings.spec.ts`).

## Global Constraints

- No `@vue/test-utils` in this repo — markup-only components (which is everything in this plan) are not unit-tested. Verify via `npx vue-tsc --noEmit` and the existing Playwright suite.
- `tests/e2e/settings.spec.ts` locates the settings button via `page.getByRole('button', { name: /^settings$/i })` — an accessible-name (aria-label) match, not a DOM-location match. As long as `aria-label="Settings"` is preserved on the button, relocating it from `ActionPane.vue` to `Home.vue`'s `PageHeader` does not break this test.
- `Settings.vue`'s back button currently does `router.push('/')` on click (not `router.back()`) — `PageHeader`'s back button must preserve this exact navigation via an emitted event, not a hardcoded route.
- `SectionTitle.vue`'s variant map lives at `src/frontend/src/components/SectionTitle.vue:10-15` — only the `section` and `group` entries change; `page` and `sheet` are untouched.

---

## File Structure

- Create: `src/frontend/src/components/PageHeader.vue`
- Modify: `src/frontend/src/components/SectionTitle.vue` — `section`/`group` variant classes.
- Modify: `src/frontend/src/views/Settings.vue` — migrate header to `PageHeader`.
- Modify: `src/frontend/src/views/Home.vue` — add `PageHeader` with settings-gear action slot.
- Modify: `src/frontend/src/components/ActionPane.vue` — remove settings-gear button and now-unused `router` import/call.
- Modify: `src/frontend/src/views/Items.vue` — add `PageHeader`.
- Modify: `src/frontend/src/views/Stats.vue` — add `PageHeader`.
- Modify: `src/frontend/src/views/Log.vue` — add `PageHeader`.
- Modify: `src/frontend/src/components/ItemsSection.vue` — per-category heading indent.

---

## Task 1: `SectionTitle` variant fixes

**Files:**
- Modify: `src/frontend/src/components/SectionTitle.vue`

**Interfaces:**
- No signature change — `variant` prop and rendered `<span>` structure are unchanged. Only the class strings for `section` and `group` change.

- [ ] **Step 1: Edit the variant class map**

In `src/frontend/src/components/SectionTitle.vue`, replace:

```ts
const classes = computed(() => ({
  page: 'text-title-page font-semibold',
  section: 'text-title-section font-semibold text-black/60 dark:text-white/60',
  sheet: 'text-title-sheet font-semibold',
  group: 'text-title-group font-semibold text-gray-500 uppercase tracking-wide',
}[props.variant]));
```

with:

```ts
const classes = computed(() => ({
  page: 'text-title-page font-semibold',
  section: 'text-title-section font-semibold text-black dark:text-white',
  sheet: 'text-title-sheet font-semibold',
  group: 'text-title-group font-medium text-gray-500 tracking-wide',
}[props.variant]));
```

- [ ] **Step 2: Verify it builds**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/components/SectionTitle.vue
git commit -m "style(frontend): strengthen section titles, soften group titles"
```

---

## Task 2: `PageHeader.vue`

**Files:**
- Create: `src/frontend/src/components/PageHeader.vue`

**Interfaces:**
- Produces: `PageHeader` component — props `title: string`, `showBack?: boolean`; emits `back: []`; named slot `#action` for trailing right-aligned content.
- Consumes: `SectionTitle` (variant `"page"`), already present at `src/frontend/src/components/SectionTitle.vue`.

- [ ] **Step 1: Create the component**

```vue
<template>
  <div class="flex items-center gap-2 px-2 py-2">
    <button
      v-if="showBack"
      type="button"
      aria-label="Back"
      class="text-gray-500 p-2"
      @click="$emit('back')"
    >
      <ChevronLeftIcon class="w-6 h-6" />
    </button>
    <SectionTitle variant="page">{{ title }}</SectionTitle>
    <div class="ml-auto"><slot name="action" /></div>
  </div>
</template>

<script setup lang="ts">
import { ChevronLeftIcon } from '@heroicons/vue/24/solid';
import SectionTitle from './SectionTitle.vue';

defineProps<{ title: string; showBack?: boolean }>();
defineEmits<{ back: [] }>();
</script>
```

- [ ] **Step 2: Verify it builds**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/components/PageHeader.vue
git commit -m "feat(frontend): add PageHeader component"
```

---

## Task 3: Migrate `Settings.vue` to `PageHeader`

**Files:**
- Modify: `src/frontend/src/views/Settings.vue`

**Interfaces:**
- Consumes: `PageHeader` from Task 2 (`title`, `showBack`, `@back`).

- [ ] **Step 1: Replace the hand-rolled header**

Replace (lines 3-8):

```html
<div class="flex items-center gap-2 px-2 py-2">
  <button type="button" aria-label="Back" class="text-gray-500 p-2" @click="router.push('/')">
    <ChevronLeftIcon class="w-6 h-6" />
  </button>
  <SectionTitle variant="page">Settings</SectionTitle>
</div>
```

with:

```html
<PageHeader title="Settings" showBack @back="router.push('/')" />
```

- [ ] **Step 2: Update imports**

In `Settings.vue`'s `<script setup>`, replace:

```ts
import { ChevronLeftIcon } from '@heroicons/vue/24/solid';
```
```ts
import SectionTitle from '../components/SectionTitle.vue';
```

with a single import:

```ts
import PageHeader from '../components/PageHeader.vue';
```

(Remove the `ChevronLeftIcon` and `SectionTitle` imports entirely — `PageHeader` owns both now. Keep the `useRouter`/`router` import and usage — `Settings.vue` still needs `router` for the `@back` handler.)

- [ ] **Step 3: Verify it builds**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 4: Run settings e2e spec**

Run: `cd src/frontend && npx playwright test tests/e2e/settings.spec.ts`
Expected: all pass (this spec's `openSettings` helper matches `getByRole('button', { name: /^settings$/i })`, unaffected by this task — this task only touches the back button, not the settings-entry button. There is no existing test asserting the back button's behavior, confirmed by grep — this task doesn't need to add one, per repo convention of not unit/e2e-testing pure markup).

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/views/Settings.vue
git commit -m "refactor(frontend): migrate Settings header to PageHeader"
```

---

## Task 4: Home page header + settings-gear relocation

**Files:**
- Modify: `src/frontend/src/views/Home.vue`
- Modify: `src/frontend/src/components/ActionPane.vue`

**Interfaces:**
- Consumes: `PageHeader` from Task 2 (`title`, `#action` slot — no `showBack`, Home is a tab root).

- [ ] **Step 1: Remove the settings-gear button from `ActionPane.vue`**

Replace (lines 3-13):

```html
<div class="flex items-center justify-between">
  <k-block-title>Currently Wearing</k-block-title>
  <button
    type="button"
    class="mr-4 text-gray-500"
    aria-label="Settings"
    @click="router.push('/settings')"
  >
    <Cog6ToothIcon class="w-6 h-6" />
  </button>
</div>
```

with:

```html
<div class="flex items-center justify-between">
  <k-block-title>Currently Wearing</k-block-title>
</div>
```

- [ ] **Step 2: Remove now-unused imports/code from `ActionPane.vue`**

In `ActionPane.vue`'s `<script setup>`:
- Remove `import { useRouter } from 'vue-router';`
- Remove `import { Cog6ToothIcon } from '@heroicons/vue/24/solid';`
- Remove `const router = useRouter();`

(Confirmed via grep that `router.push('/settings')` on the old line 9 was the only use of `router` in this file — safe to remove entirely.)

- [ ] **Step 3: Add `PageHeader` to `Home.vue`**

Replace (lines 1-13):

```vue
<template>
  <k-page class="flex flex-col pt-4" style="padding-bottom: 56px">
    <!-- Two-pane layout: actions (top) + calendar (bottom) -->
    <div class="flex flex-col flex-1 overflow-hidden">
      <div class="flex-1 overflow-y-auto min-h-0">
        <action-pane />
      </div>
      <div class="border-t" style="height: 200px; flex-shrink: 0">
        <calendar-pane />
      </div>
    </div>
  </k-page>
</template>

<script setup lang="ts">
import { kPage } from 'konsta/vue';
import ActionPane from '../components/ActionPane.vue';
import CalendarPane from '../components/CalendarPane.vue';
</script>
```

with:

```vue
<template>
  <k-page class="flex flex-col" style="padding-bottom: 56px">
    <PageHeader title="Home">
      <template #action>
        <button type="button" class="mr-2 text-gray-500" aria-label="Settings" @click="router.push('/settings')">
          <Cog6ToothIcon class="w-6 h-6" />
        </button>
      </template>
    </PageHeader>
    <!-- Two-pane layout: actions (top) + calendar (bottom) -->
    <div class="flex flex-col flex-1 overflow-hidden">
      <div class="flex-1 overflow-y-auto min-h-0">
        <action-pane />
      </div>
      <div class="border-t" style="height: 200px; flex-shrink: 0">
        <calendar-pane />
      </div>
    </div>
  </k-page>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { kPage } from 'konsta/vue';
import { Cog6ToothIcon } from '@heroicons/vue/24/solid';
import PageHeader from '../components/PageHeader.vue';
import ActionPane from '../components/ActionPane.vue';
import CalendarPane from '../components/CalendarPane.vue';

const router = useRouter();
</script>
```

(Note: `pt-4` moved from the `k-page` class to being handled by `PageHeader`'s own `py-2` — dropped from `k-page`'s class list since the header now provides top spacing.)

- [ ] **Step 4: Verify it builds**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 5: Run settings + navigation e2e specs**

Run: `cd src/frontend && npx playwright test tests/e2e/settings.spec.ts tests/e2e/navigation.spec.ts`
Expected: all pass. The settings button keeps its exact `aria-label="Settings"`, so `getByRole('button', { name: /^settings$/i })` still matches it in its new location inside `PageHeader`'s `#action` slot.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/views/Home.vue src/frontend/src/components/ActionPane.vue
git commit -m "refactor(frontend): add Home page header, move settings button into it"
```

---

## Task 5: Page headers for Items, Stats, Log

**Files:**
- Modify: `src/frontend/src/views/Items.vue`
- Modify: `src/frontend/src/views/Stats.vue`
- Modify: `src/frontend/src/views/Log.vue`

**Interfaces:**
- Consumes: `PageHeader` from Task 2 (`title` only — no `showBack`, no `#action` needed on any of these three).

- [ ] **Step 1: `Items.vue`**

Replace:

```vue
<template>
  <k-page class="pt-4" style="padding-bottom: 56px">
    <CategoriesSection />
    <ItemsSection />
  </k-page>
</template>

<script setup lang="ts">
import { kPage } from 'konsta/vue';
import CategoriesSection from '../components/CategoriesSection.vue';
import ItemsSection from '../components/ItemsSection.vue';
</script>
```

with:

```vue
<template>
  <k-page style="padding-bottom: 56px">
    <PageHeader title="Items" />
    <CategoriesSection />
    <ItemsSection />
  </k-page>
</template>

<script setup lang="ts">
import { kPage } from 'konsta/vue';
import PageHeader from '../components/PageHeader.vue';
import CategoriesSection from '../components/CategoriesSection.vue';
import ItemsSection from '../components/ItemsSection.vue';
</script>
```

(`pt-4` dropped from `k-page`'s class — `PageHeader`'s own `py-2` now provides top spacing, matching the pattern in Task 4.)

- [ ] **Step 2: `Stats.vue`**

Replace (lines 1-9):

```vue
<template>
  <k-page class="pt-4" style="padding-bottom: 56px">

    <SegmentedControl
      :options="LEADERBOARD_TYPES"
      :modelValue="activeType"
      @update:modelValue="loadLeaderboard"
    />
```

with:

```vue
<template>
  <k-page style="padding-bottom: 56px">
    <PageHeader title="Stats" />

    <SegmentedControl
      :options="LEADERBOARD_TYPES"
      :modelValue="activeType"
      @update:modelValue="loadLeaderboard"
    />
```

Add the import in `Stats.vue`'s `<script setup>`:

```ts
import PageHeader from '../components/PageHeader.vue';
```

(add alongside the existing `import { kPage, ... } from 'konsta/vue';` line, keep both.)

- [ ] **Step 3: `Log.vue`**

Replace (line 3):

```vue
<template>
  <k-page class="flex flex-col" style="padding-bottom: 56px">
    <k-block class="flex gap-2 pb-2">
```

with:

```vue
<template>
  <k-page class="flex flex-col" style="padding-bottom: 56px">
    <PageHeader title="Log" />
    <k-block class="flex gap-2 pb-2">
```

Add the import in `Log.vue`'s `<script setup>`:

```ts
import PageHeader from '../components/PageHeader.vue';
```

(add alongside the existing `import { kPage, ... } from 'konsta/vue';` line.)

- [ ] **Step 4: Verify it builds**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 5: Run full e2e suite**

Run: `cd src/frontend && npx playwright test`
Expected: all pass. No existing spec asserts on the absence of a title on Items/Stats/Log (confirmed: none of these views had any heading before, so no existing locator conflicts with the new `PageHeader` text), but a full run catches any incidental layout/selector regression from the `pt-4` → header-provided spacing change.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/views/Items.vue src/frontend/src/views/Stats.vue src/frontend/src/views/Log.vue
git commit -m "feat(frontend): add page headers to Items, Stats, and Log"
```

---

## Task 6: Per-category heading indent

**Files:**
- Modify: `src/frontend/src/components/ItemsSection.vue`

**Interfaces:**
- No new interfaces — pure class-string change on an existing `<div>`.

- [ ] **Step 1: Bump the wrapper's padding**

Replace (line 53):

```html
<div class="px-4 mt-4 mb-1">
```

with:

```html
<div class="px-6 mt-4 mb-1">
```

(This is the per-category heading wrapper inside `ItemsSection.vue`'s `v-for="cat in categories"` loop — the one wrapping `<SectionTitle variant="group">{{ cat.name }}</SectionTitle>`. Do not confuse this with `IconPickerSheet.vue`'s two `variant="group"` usages, which are unrelated and out of scope for this task.)

- [ ] **Step 2: Verify it builds**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 3: Run items e2e spec**

Run: `cd src/frontend && npx playwright test tests/e2e/items.spec.ts`
Expected: all pass (padding-only change, no structural/testid change).

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/components/ItemsSection.vue
git commit -m "style(frontend): indent per-category headings under Items"
```

---

## Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check**

Run: `cd src/frontend && npx vue-tsc --noEmit`
Expected: no new errors (baseline pre-existing errors in `sw.ts`/`useNotifications.ts` are unrelated and expected to remain).

- [ ] **Step 2: Lint**

Run: `cd src/frontend && npm run lint`
Expected: no errors.

- [ ] **Step 3: Full unit test suite**

Run: `cd src/frontend && npx vitest run`
Expected: all pass (no new unit tests in this plan — pure markup/styling changes).

- [ ] **Step 4: Full e2e suite**

Run: `cd src/frontend && npx playwright test`
Expected: all pass.

- [ ] **Step 5: Manual visual check**

Run: `cd src/frontend && npm run dev` (or `npm run dev` from repo root for the full app), open the app, and visually confirm:
- Home, Items, Stats, Log, and Settings each show a title bar at the top ("Home", "Items", "Stats", "Log", "Settings" respectively).
- Settings' back button still navigates to Home.
- Home's title bar has the settings-gear button on the right; clicking it navigates to Settings; it's no longer present next to "Currently Wearing".
- On the Items tab: "Categories" and "Items" section headers read as clearly more prominent (full-opacity black) than the per-category names below them (medium-weight gray, no longer all-caps, slightly indented relative to the section headers).
