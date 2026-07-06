# Shared form components: design

## Problem

Markup analysis of `src/frontend/src` found repeated structural patterns hand-rolled
per-file instead of pulled through a shared component, causing visible drift:

- Text-style number inputs duplicated verbatim in `CategoryForm.vue` (lines 36, 61)
  and `ItemsSection.vue` (lines 37, 103) instead of using a `NumberField`.
- The duration-picker trigger button (label + button + caret, opens
  `DurationPickerSheet`) duplicated 4x in `CategoryForm.vue` (lines 14, 22, 44, 51).
- "Section title" role rendered with 5 different font sizes across
  `FormSectionHeader.vue`, `Settings.vue`, `DurationPickerSheet.vue`,
  `IconPickerSheet.vue`, and `ItemsSection.vue` — no shared component, no tokens.
- Card/form wrapper styled 3 different ways for the same "form card" concept in
  `CategoryForm.vue`, and both branches of `ItemsSection.vue` (add card vs edit card).
- No design tokens exist anywhere (Tailwind v4, CSS-first — only `@import
  "tailwindcss"` in `style.css`, no `@theme` block). Every value above is a raw
  utility class picked ad hoc per file.

Existing small components (`TextField`, `SelectField`, `IconPickerTrigger`,
`FormSectionHeader`) already share a consistent label pattern and prove the model
works — they're just under-applied.

## Scope

Build four components in one pass, and apply them everywhere the corresponding
pattern currently appears by hand:

1. Tailwind `@theme` tokens for the 4 title font sizes
2. `SectionTitle.vue`
3. `NumberField.vue`
4. `DurationTrigger.vue`
5. `FormCard.vue`

Call sites to update: `CategoryForm.vue`, `ItemsSection.vue`,
`FormSectionHeader.vue`, `DurationPickerSheet.vue`, `IconPickerSheet.vue`,
`Settings.vue`.

Out of scope: the stat-label pattern in `ActionPane.vue`/`Log.vue` (already
internally consistent, different semantic role from a section title despite
superficially similar classes). No changes to `TextField`/`SelectField`/
`IconPickerTrigger` beyond what's needed to keep them visually matching the new
components.

## 1. Design tokens

Tailwind v4 config is CSS-first (`@theme` block), not a `tailwind.config.js`.
Add to `src/frontend/src/style.css`:

```css
@theme {
  --font-size-title-page: 1.125rem;     /* Settings.vue page header */
  --font-size-title-section: 1.0625rem; /* 17px — "Items"/"Categories" section header */
  --font-size-title-sheet: 0.875rem;    /* sheet toolbar titles */
  --font-size-title-group: 0.75rem;     /* category group headings */
}
```

This generates `text-title-page`, `text-title-section`, `text-title-sheet`,
`text-title-group` utilities. Font weight/color/tracking per role stay as fixed
classes in `SectionTitle.vue` (not tokenized — only size varies meaningfully
across current usage).

## 2. `SectionTitle.vue`

```ts
defineProps<{ variant: 'page' | 'section' | 'sheet' | 'group' }>();
```

Renders a `<span>` (not a block wrapper — callers keep their own layout/toggle
button around it) with fixed classes per variant:

| variant | classes |
|---|---|
| `page` | `text-title-page font-semibold` |
| `section` | `text-title-section font-semibold text-black/60 dark:text-white/60` |
| `sheet` | `text-title-sheet font-semibold` |
| `group` | `text-title-group font-semibold text-gray-500 uppercase tracking-wide` |

Replaces the title `<span>`/`<h3>` in: `Settings.vue:7`, `FormSectionHeader.vue:3`
(keeps its own wrapper div + toggle button, just delegates the title text render),
`DurationPickerSheet.vue:16`, `IconPickerSheet.vue:16`, `ItemsSection.vue:54`,
`IconPickerSheet.vue:82`.

`ItemsSection.vue:54` currently uses `text-gray-500`; `IconPickerSheet.vue:82` uses
the same string plus `mt-4 mb-2`. Both become `variant="group"`; the `gray-500`
shade wins as canonical (matches majority usage). Margin stays with the caller
(layout, not title styling).

## 3. `NumberField.vue`

```ts
defineProps<{
  id?: string;
  label?: string;
  modelValue: number;
  min?: number;
  max?: number;
  default: number;
  step?: number;
}>();
defineEmits<{ 'update:modelValue': [value: number] }>();
```

Same label markup as `TextField`. Input uses `w-20` width (current fixed width for
all 4 existing usages), `type="number"`, `:step="step ?? 1"`. On `@blur`: if the
input is empty or `NaN`, emit `default`; otherwise clamp to `[min, max]` (either
bound optional) and emit the clamped value.

Replaces:
- `CategoryForm.vue:33-36` (rest multiplier: `min=0`, no max, `default=2`,
  `step=0.1`) — removes `onRestMultiplierBlur`.
- `CategoryForm.vue:58-61` (break decay: `min=0`, `max=0.99`, `default=0.91`,
  `step=0.01`) — removes `onDecayBlur`.
- `ItemsSection.vue:33-38` and `:99-104` (difficulty multiplier: `min=0.1`,
  `default=1.0`, `step=0.1`) — currently has no blur validation at all; gains it
  for free from the shared component.

## 4. `DurationTrigger.vue`

```ts
defineProps<{
  id?: string;
  label?: string;
  modelValue: number; // seconds
  disabled?: boolean;
  clearable?: boolean;
}>();
defineEmits<{ click: []; clear: [] }>();
```

Mirrors `IconPickerTrigger`'s shape (label + button, parent owns the picker sheet's
open state and modelValue update — this component only signals `click` to open it,
same as `IconPickerTrigger` signals `click` to open `IconPickerSheet`).

`CategoryForm` already owns the `null` → `"None"` display mapping for max-wear
today, so this component takes a pre-formatted display string rather than raw
seconds:

```ts
defineProps<{
  id?: string;
  label?: string;
  displayValue: string;
  disabled?: boolean;
  clearable?: boolean;
  testid?: string;      // forwarded to the trigger button's data-testid
  clearTestid?: string; // forwarded to the clear button's data-testid
}>();
defineEmits<{ click: []; clear: [] }>();
```

Button renders `{{ displayValue }} ▾`. When `clearable`, also renders a `clear`
text button next to the trigger, emitting `clear`. `inheritAttrs: false` (or
equivalent) since the component has two focusable root-level elements — plain
`id`/`data-testid` can't auto-passthrough to one of two siblings, hence the
explicit `testid`/`clearTestid` props.

Replaces `CategoryForm.vue:12-17` (target), `:19-30` (max —
`clearable`, `clearTestid="clear-max"`), `:41-48` (minRest — `disabled` when no
max set, `testid="min-rest"`), `:49-55` (grace).

## 5. `FormCard.vue`

```ts
// no props — single style, slot only
```

```html
<div class="mx-4 mb-3 p-3 bg-white border border-gray-200 rounded-2xl space-y-2">
  <slot />
</div>
```

Replaces `CategoryForm.vue:2`, `ItemsSection.vue:10` (add card), and
`ItemsSection.vue:77` (edit card — currently `mx-2 mb-2 p-3 bg-gray-50
border-gray-200 rounded-xl`; unified to the primary style per decision, dropping
the visual distinction between add-form and inline-edit-form).

## Testing

No existing unit tests cover `TextField`/`SelectField`/`IconPickerTrigger` (pure
markup, no logic) — same expectation for `SectionTitle`, `DurationTrigger`,
`FormCard`. `NumberField` introduces new clamp/default behavior (previously
bespoke per-field blur handlers, now shared) — add a unit test covering: empty →
default, NaN → default, below min → clamped to min, above max → clamped to max,
in-range passthrough.

Existing e2e/unit tests for `CategoryForm` and `ItemsSection` (category form
tests, items e2e) must continue to pass unmodified in behavior — only markup
structure changes, not field names, ids, or emitted events, so `data-testid`
attributes carry over unchanged onto the new components' root elements where
tests depend on them (`data-testid="clear-max"`, `data-testid="min-rest"`,
`data-testid="add-band"`, `data-testid="category-form-submit"`,
`data-testid="category-form-cancel"`).