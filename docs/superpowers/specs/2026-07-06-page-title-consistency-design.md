# Page title consistency: design

## Problem

Follow-up to the shared-form-components work. Of the app's 5 views, only
`Settings.vue` has an actual page title bar (hand-rolled: back button +
"Settings" text). `Home.vue`, `Stats.vue`, and `Log.vue` have no title at
all. `Items.vue` relies on its inner `CategoriesSection`/`ItemsSection`
headers ("Categories"/"Items", `SectionTitle variant="section"`) as its only
heading.

Separately, within the Items tab, the per-category group headings (e.g.
"T-Shirts") visually out-rank the "Categories"/"Items" section headers above
them, despite being smaller (12px vs 17px) — the group heading's solid
gray-500, bold, all-caps styling reads as more prominent than the section
heading's larger but 60%-opacity text. The all-caps styling is also
independently disliked.

Also: the settings-gear icon currently lives inside `ActionPane.vue` (next
to "Currently Wearing"), not at the page level — it should move to be part
of Home's title bar.

## Scope

1. New `PageHeader.vue` component, applied to all 5 views.
2. Move the settings-gear button from `ActionPane.vue` into Home's
   `PageHeader`.
3. `SectionTitle` variant adjustments: `section` gains full opacity, `group`
   drops uppercase and reduces weight.
4. Per-category heading indent in `ItemsSection.vue`.

Out of scope: any other view's internal layout, `IconPickerSheet.vue`'s
group headings (same `variant="group"`, but a different, unrelated context
— its padding is caller-owned and stays as-is).

## 1. `PageHeader.vue`

```ts
defineProps<{ title: string; showBack?: boolean }>();
```

```html
<div class="flex items-center gap-2 px-2 py-2">
  <button
    v-if="showBack"
    type="button"
    aria-label="Back"
    class="text-gray-500 p-2"
    @click="router.back()"
  >
    <ChevronLeftIcon class="w-6 h-6" />
  </button>
  <SectionTitle variant="page">{{ title }}</SectionTitle>
  <div class="ml-auto"><slot name="action" /></div>
</div>
```

`Settings.vue` currently navigates back via `router.push('/')` specifically
(not `router.back()`) — `PageHeader`'s back button preserves that exact
behavior for Settings by keeping the click handler a prop-less emit instead
of hardcoding navigation:

```ts
defineProps<{ title: string; showBack?: boolean }>();
defineEmits<{ back: [] }>();
```

```html
<button v-if="showBack" ... @click="$emit('back')">
```

Callers wire `@back="router.push('/')"` (Settings) or omit `showBack`
entirely (Home/Items/Stats/Log — no back button, they're tab roots).

Replaces:
- `Settings.vue`'s hand-rolled header (back button + `text-lg font-semibold`
  span, already migrated to `SectionTitle variant="page"` in the prior
  branch) — becomes `<PageHeader title="Settings" showBack @back="router.push('/')" />`.
- Adds a header to `Home.vue`: `<PageHeader title="Home"><template #action>...cog button...</template></PageHeader>`.
- Adds a header to `Items.vue`: `<PageHeader title="Items" />` (existing
  "Categories"/"Items" section headers stay unchanged below it, per your
  call — accepted redundancy over restructuring those sections).
- Adds a header to `Stats.vue`: `<PageHeader title="Stats" />`.
- Adds a header to `Log.vue`: `<PageHeader title="Log" />`.

## 2. Settings-gear relocation

`ActionPane.vue` currently renders (lines ~3-12):

```html
<div class="flex items-center justify-between">
  <k-block-title>Currently Wearing</k-block-title>
  <button type="button" class="mr-4 text-gray-500" aria-label="Settings" @click="router.push('/settings')">
    <Cog6ToothIcon class="w-6 h-6" />
  </button>
</div>
```

Becomes:

```html
<div class="flex items-center justify-between">
  <k-block-title>Currently Wearing</k-block-title>
</div>
```

(`router` import in `ActionPane.vue` is dropped if nothing else in that file
uses it — verify before removing the import.)

`Home.vue`'s new `PageHeader` gains the button in its `#action` slot:

```html
<PageHeader title="Home">
  <template #action>
    <button type="button" class="mr-2 text-gray-500" aria-label="Settings" @click="router.push('/settings')">
      <Cog6ToothIcon class="w-6 h-6" />
    </button>
  </template>
</PageHeader>
```

`Home.vue` needs `useRouter`/`Cog6ToothIcon` imports added (currently absent
from that file).

## 3. `SectionTitle` variant adjustments

| variant | before | after |
|---|---|---|
| `page` | `text-title-page font-semibold` | unchanged |
| `section` | `text-title-section font-semibold text-black/60 dark:text-white/60` | `text-title-section font-semibold text-black dark:text-white` |
| `sheet` | `text-title-sheet font-semibold` | unchanged |
| `group` | `text-title-group font-semibold text-gray-500 uppercase tracking-wide` | `text-title-group font-medium text-gray-500 tracking-wide` |

## 4. Per-category heading indent

`ItemsSection.vue`'s per-category heading wrapper:

```html
<div class="px-4 mt-4 mb-1">
  <SectionTitle variant="group">{{ cat.name }}</SectionTitle>
</div>
```

becomes:

```html
<div class="px-6 mt-4 mb-1">
  <SectionTitle variant="group">{{ cat.name }}</SectionTitle>
</div>
```

`IconPickerSheet.vue`'s two `variant="group"` usages (icon category
headings, an unrelated picker context) are untouched — their padding is
independently caller-owned.

## Testing

`PageHeader` is markup-only (no logic beyond a conditional back button and a
slot) — consistent with this repo's convention, not unit-tested with
`@vue/test-utils` (none exists here). Verify via `npx vue-tsc --noEmit` and
the existing Playwright e2e suite, which must keep passing:
- `tests/e2e/settings.spec.ts` likely asserts on the Settings back button —
  confirm its behavior (`router.push('/')` via the back button) is
  unchanged after migrating to `PageHeader`.
- No other e2e spec currently asserts on page titles/headers for
  Home/Items/Stats/Log (none exist today), so adding them shouldn't break
  anything, but a full suite run is required per this repo's verification
  convention.
