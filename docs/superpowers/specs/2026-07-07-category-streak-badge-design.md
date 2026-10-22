# Category Streak Badge — Design Spec

**Date:** 2026-07-07

## Overview

Show each category's current streak on its Home-tab row. "Streak" reuses
the backend's existing per-category tracking (`category_stats.streak_count`)
— consecutive sessions where each new session starts within the category's
`break_grace_time` of the previous one ending; it resets to 0 once a gap
exceeds grace. No new streak logic — this spec is purely exposing an
existing value and displaying it.

## Data flow

`GET /api/sessions/current` (`src/backend/src/controllers/sessions.ts`)
currently builds each category's entry without touching `category_stats`.
Add a `streak_count: number` field to each entry, read via
`statsStore` (an existing lookup already reads `category_stats` by
`category_id` in `src/backend/src/db/stores/stats-store.ts`; reuse that
rather than adding a new query).

Frontend: add `streak_count: number` to `CurrentEntry`
(`src/frontend/src/composables/useWear.ts`).

No new DB columns/migrations — `streak_count` already exists in
`category_stats` and is maintained by the existing session-end logic in
`stats-store.ts`.

## Display

- A small badge — monochrome icon (`ph:flame`, matching the existing
  `@iconify/vue` Phosphor icons already used elsewhere in `ActionPane.vue`,
  e.g. `ph:bed`, `ph:warning`) plus the count — sits in the row's title-line
  slot, next to the category name.
- Shown for **both** active-session and idle rows — it's a category-level
  stat, independent of whether something's currently being worn.
- **Hidden entirely when `streak_count` is 0** — no badge clutter on
  categories with no current streak.
- Styling: small, muted (not competing visually with the category name or
  any session-specific badges like the lap-counter's `Nx` badge, which is
  rendered inside `WearProgressBar.vue`, not the title line — no visual
  collision).

## Testing

- **Backend:** unit test on the `/api/sessions/current` handler (or the
  underlying store function, whichever the existing test suite targets)
  confirming `streak_count` is present and correct for a category with an
  active streak, and for one with `streak_count` reset to 0.
- **Frontend:** component-level verification via e2e (this codebase has no
  Vue unit-test framework — see prior specs) confirming the badge appears
  for a category with a streak and is absent for one without, on both an
  idle and an active row.

## Out of scope

- Any change to how streaks are calculated or reset — purely exposing the
  existing `category_stats.streak_count`.
- Best-streak display (`best_streak_count`/`best_streak_wear_seconds`) —
  those already surface elsewhere (stats page); this spec is Home-tab
  current-streak only.
