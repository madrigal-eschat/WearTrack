# Controller and Component Decomposition

## Background

PR 11 (rotation category type) drew several review comments about controller
and Vue component files growing too large and tangled:

- `categories.ts` / `sessions.ts`: inline field-by-field validation repeated
  on every POST/PATCH handler, validation logic tangled with error-reporting,
  and `sessions.ts`'s `/current` handler building two near-duplicate return
  objects instead of assembling one.
- `ActionPane.vue` / `CategoryForm.vue`: large multi-branch templates that
  mix several visually and logically distinct concerns in one file.

This spec generalizes those comments into an objective, threshold-driven
policy for when to split code up, and applies it to the codebase as it
stands today (not just the two files PR 11 touched).

## Goals

- Replace "this file feels too big" with a measurable trigger for both
  backend (cyclomatic complexity) and frontend (template SLOC).
- Fix the concretely-identified problems: validation tangled with
  error-reporting in Category/Session controllers, and near-duplicate
  templates/logic in the flagged Vue components.
- Land the policy as enforced lint rules so future growth is caught
  automatically, not just this one round.

## Non-goals

- Refactoring backend code outside `src/backend/src/controllers/**`
  (stores, `calculations.ts`) — different concern, not what PR 11's
  comments were about.
- Introducing Query objects for read endpoints in general — only
  `sessions.ts`'s `/current` handler, which was specifically flagged.
- Fixing the pre-existing bug in the session edit dialog (surfaced during
  investigation, unrelated to this refactor — tracked separately).
- Sweeping every possible frontend/backend file for "could be nicer" —
  scope is bounded by the thresholds below.

## PR A: Backend controller decomposition

### Threshold

Add ESLint's built-in `complexity` rule, **max 10**, scoped to
`src/backend/src/controllers/**/*.ts` only:

```js
{
  files: ['src/controllers/**/*.ts'],
  rules: { complexity: ['error', 10] },
}
```

This rule is the enforcement mechanism going forward — any future handler
that grows past 10 branches fails lint, not just the ones fixed in this PR.

Handlers currently over the threshold: `categories.ts` POST and PATCH,
`sessions.ts` `/current` and `POST /start`, `items.ts` PATCH. Everything
else in the controllers directory is under 10 and is left alone.

### Command objects (Category, Session domains)

For Category and Session write actions that are over the threshold, split
the controller into two pieces:

- **Controller**: request-level concerns only — parse/coerce params
  (`Number(c.req.param('id'))`, `c.req.json()`), instantiate the Command,
  run it, shape the response (`c.json(x, 201)`).
- **Command**: owns validation and the state change. Validates via a
  composed set of field-level validator functions (the "validate() fans
  out to a bunch of other validation functions" idea from review), then
  calls the store. Throws the existing `ValidationError`/`NotFoundError`/
  `ConflictError` types, caught by existing error middleware — no new
  error-handling mechanism.

New commands:
- `CreateCategoryCommand`, `UpdateCategoryCommand` — `src/backend/src/commands/categories.ts`
- `StartSessionCommand` — `src/backend/src/commands/sessions.ts` (the
  rotation-availability/consecutive-wear-lock gating logic is exactly the
  kind of business logic that belongs out of the controller)

`sessions.ts`'s other write handlers (`end`, `patch`, `delete`) stay
inline — they're under the complexity threshold, so splitting them would
be process for its own sake.

### Query object (sessions `/current`)

`GET /api/sessions/current` becomes `CurrentSessionsQuery` in
`src/backend/src/queries/sessions.ts`, following the same
controller/logic split as Commands (controller does response shaping,
Query assembles the per-category data). This also resolves the "building
up one object instead of two near-duplicate branches" comment — the Query
assembles a single result incrementally rather than branching into two
near-identical `return` shapes.

This is the only Query object introduced. It's justified because it was
specifically flagged and crosses the complexity threshold; it is not a
general pattern applied to other read endpoints.

### Narrower fix (items.ts PATCH)

`items.ts` PATCH crosses the complexity threshold too, but has no business
logic worth separating from validation (just field-type checks plus one FK
existence check). Extract a shared `validate()`-composition helper and a
`buildUpdates()` helper (both usable by other controllers later if they
grow past the threshold) without introducing a Command class for this
handler.

## PR B: Frontend component decomposition

### Threshold

Two-tier, SLOC-based, measured on the `<template>` block only:

- **≥200 template lines**: refactor required.
- **100–199 template lines**: worth considering — a judgment call, not
  lint-enforced.

Extract a new component when either applies:
- There's an obvious, easily-named cohesive group (e.g. risk bands →
  `<RiskBands>`), **or**
- There's a large, roughly-symmetric `v-if`/`v-else` pair (both branches
  substantial).

Enforcement: `vue/max-lines-per-block` (template block, max 200, error) in
`src/frontend/eslint.config.js`. The 100-line "worth considering" tier and
the two extraction heuristics above are documented in `CLAUDE.md` as
reviewer/author guidance — ESLint can't express "soft" thresholds for one
rule, so this tier stays a human judgment call.

### Current state (template line counts)

| File | Template lines | Action |
|---|---|---|
| `ActionPane.vue` | 162 | refactor (required) |
| `CategoryForm.vue` | 158 | refactor (required) |
| `ItemsSection.vue` | 121 | refactor (duplication found) |
| `Log.vue` | 121 | refactor (candidates found) |
| `IconPickerSheet.vue` | 105 | refactor (duplication found) |
| `DurationPickerSheet.vue` | 92 | below threshold, no action |
| everything else | <100 | below threshold, no action |

### Extractions

- **`ActionPane.vue`**: extract the list-item row, the action-buttons
  cluster, and any other pieces that concretely satisfy the naming/symmetry
  heuristic once in the code (exact boundaries decided during
  implementation, not fully prescribed here).
- **`CategoryForm.vue`**: `<RiskBands>` (named collection), and per-type
  sections `<DurationCategoryFields>` / `<RotationCategoryFields>` (the
  duration-only and rotation-only blocks are already close to symmetric
  siblings under one `v-if`/`v-else` chain).
- **`ItemsSection.vue`**: `<ItemForm>` — the add-item and edit-item field
  blocks (name/color/icon/category/difficulty) are near-duplicates; extract
  one component parameterised by mode (add/edit), used in both places.
- **`IconPickerSheet.vue`**: `<IconGrid>` — the search-mode and
  categorised-mode icon grids render near-identical button markup; extract
  one component that takes a flat list of icon entries.
- **`Log.vue`**: `<LogItem>` for the list-item row, and `<EditSessionDialog>`
  for the edit dialog. The edit dialog currently has a pre-existing bug
  (reported separately, not part of this refactor) — extract as-is,
  behavior unchanged, bug fixed in a follow-up.

### New shared component: `<DeleteButton>`

`Log.vue` already has a proper `k-dialog` delete-confirmation; `ItemsSection.vue`
and `CategoriesSection.vue` currently use the native `confirm()` browser
dialog instead. Extract `<DeleteButton>` (button + `k-dialog` confirmation,
styled like Log.vue's existing dialog) and use it in all three places —
this both deduplicates and upgrades Items/Categories off native `confirm()`.

## Testing

Both PRs are pure refactors — no behavior change intended (except the
Items/Categories delete-confirmation UI upgrade, which is a visible but
low-risk change). Existing backend/frontend test suites must stay green.
No new test cases required unless extraction reveals an actual untested
branch. The `EditSessionDialog` bug is explicitly out of scope — do not
fix it as a side effect of extraction; note it for separate follow-up.

## Sequencing

PR A (backend) and PR B (frontend) are independent; either can land first.
