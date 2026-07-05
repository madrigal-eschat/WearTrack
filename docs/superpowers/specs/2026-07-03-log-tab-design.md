# Log tab: browsable session history

## Problem

There's no way to see past wear sessions as a list. Home shows only current/active
state; Stats shows leaderboards, not individual sessions. Users want a
filterable, scrollable log of every completed session, with a way to jump
straight to a given date without scrolling through everything.

## Design

### Data model

New migration adds:

```sql
CREATE TABLE session_day_index (
  day TEXT NOT NULL,          -- 'YYYY-MM-DD', derived from session.started_at
  category_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  UNIQUE(day, category_id, item_id)
);
```

Populated via `INSERT OR IGNORE` from `session-store.ts`'s `end()` and
`endWithInjury()`, using the day of `started_at`. This is a write-through
derived index — no batch/background job, just an extra insert alongside the
existing session-end writes. Subsequent completions on the same
(day, category, item) are no-ops.

This table exists purely to answer "which days/weeks/months/years have any
session data" cheaply, without scanning the full `sessions` table, for the
jump index described below.

### Backend API changes

`GET /api/sessions` (`src/backend/src/controllers/sessions.ts`,
`session-store.ts`):

- Add `category_id` query param (alongside existing `item_id`), combinable.
- Add cursor pagination: `before` (unix seconds, exclusive on `started_at`)
  and `limit` (default 100). No `before` means start from the most recent
  session. Results are always newest-first.
- Restrict to completed sessions (`ended_at IS NOT NULL`) — this endpoint is
  now the Log tab's data source. `useCalendar.ts` already filters
  `ended_at !== null` client-side, so its behavior is unchanged; leave its
  filter in place (redundant but harmless) rather than removing it.
- Enrich each row via JOIN with `items` and `categories` to include
  `item_name`, `item_color`, `category_id`, `category_name`, `category_icon`
  (additive fields; existing consumers unaffected).

New endpoint `GET /api/sessions/dates?category_id=&item_id=`:

- Returns distinct `day` strings from `session_day_index`, filtered by
  whichever of `category_id`/`item_id` are present (both, either, or
  neither — plain `SELECT DISTINCT day` when neither given).
- Used only to build the jump index below.

### Frontend: Log tab

- New route `/log` → `views/Log.vue`. New tabbar entry "Log" (heroicons
  `ClockIcon`, `24/solid`) appended to the tabbar after Stats.
- New composable `useSessionLog.ts`:
  - `sessions` (loaded list), `categoryFilter`, `itemFilter` (both
    `number | null`), `loadInitial()`, `loadMore()`, `jumpTo(dayEndCursor)`.
  - `loadMore()` requests `before` = `started_at` of the last-loaded session;
    appends results; stops paging when a page returns fewer than `limit`
    rows.
  - Changing either filter resets the list and reloads from the top.

**Filters:** two native `<select>` dropdowns (matching the existing pattern
in `ActionPane.vue`) — Category and Item. Picking a category narrows the
Item dropdown to `itemsForCategory(categoryId)`; either can be "All". If the
selected item no longer belongs to the newly-selected category, the item
filter resets to "All".

**List:** `k-list` of `k-list-item`s, infinite-scrolling via an
`IntersectionObserver` sentinel element at the bottom of the list that calls
`loadMore()` when it becomes visible. Each row:

- `#media`: category icon (same icon-render logic as `ActionPane.vue`).
- title: item name.
- subtitle: formatted start date/time.
- `#after`: worn duration (`ended_at - started_at`, via `formatDuration`),
  plus target and max (same label/value style as `ActionPane.vue`'s
  session-detail block), plus a warning icon when `ended_in_injury`.
- No rest-period display.

**Jump index:** a slim vertical strip pinned to the right edge of the list
(iOS-style section index). Built from `GET /api/sessions/dates` (refetched
whenever `categoryFilter`/`itemFilter` change) and bucketed client-side:

- Last 14 days → one entry per day.
- Weeks 3–8 back → one entry per week (Monday-labelled).
- Months 3–12 back → one entry per month.
- Older than 12 months → one entry per year.

Nearest-granularity wins — no date is covered by more than one tier. A
bucket's entry is only rendered if at least one of the returned `day`
strings falls inside it (empty buckets are hidden entirely).

Tapping an entry resets the current list and calls `loadInitial()` with
`before` set to the start of the day *after* that bucket's range ends, so
the first row shown is the latest session at-or-before that point — the
same cursor mechanism infinite scroll uses.

### Editing a session after the fact

Sessions' `started_at` is immutable; only the end time (equivalently,
duration — editing one derives the other) can be corrected.

**API:** `PATCH /api/sessions/:id`, body is either `{ ended_at }` or
`{ duration_seconds }` (the other is derived from the existing
`started_at`). Only server-side validation: `started_at < new ended_at`. No
overlap-with-next-session or shrink-only enforcement server-side — that
policy lives entirely in the UI (below). On success:

- Recompute `rest_seconds` using the same `riskLevelFor`/`computeRest` logic
  `session-store.ts`'s `end()` already uses for the new elapsed duration.
- If the session is not `ended_in_injury`, recompute that item's and
  category's stats from scratch: reset their `stats`/`category_stats` rows
  and replay every completed, non-injury session for that item/category in
  chronological order through the existing `recordItemSession`/
  `recordCategorySession` functions. This is simpler and more robust than
  patching deltas, since an older session's duration change can ripple
  through the category's streak chaining for every session after it.
- `started_at` is untouched, so `session_day_index` needs no update.

**UI policy (enforced only client-side, not persisted):** the Log
composable keeps in-memory state `lastEdited: { sessionId, originalEndedAt } | null`.

- Editing a session for the first time (or when it isn't the
  `lastEdited` one) only allows shrinking: new end must fall in
  `(started_at, current ended_at]`. Applying the edit records the pre-edit
  `ended_at` into `lastEdited` for that session.
- If the session being edited **is** the current `lastEdited` one, the
  allowed range widens to `(started_at, lastEdited.originalEndedAt]` — one
  extra chance to move the end anywhere back up to what it originally was,
  to fix a mis-edit.
- Editing a *different* session, or a page reload (this state is
  module-level, in-memory only — never persisted), replaces/clears that
  memory, permanently locking the previous session back to shrink-only from
  its now-current end.

**Deleting a session:** `DELETE /api/sessions/:id`. Deletes the row, then
recomputes that item's/category's stats the same way (replay from scratch,
excluding the deleted session). If no other session shares that
(day, category, item) combo, also deletes the matching `session_day_index`
row — the one case where the index needs cleanup, since deletion (unlike
editing) can remove a day's only session.

**UI:** each Log row gets a kebab (⋯) menu with **Edit** and **Delete**.
Edit opens a sheet with synced end-time/duration fields, clamped to
whichever range applies per the policy above. Delete asks for confirmation
before calling the API.

### Testing

- Backend: unit tests for `before`/`limit` pagination boundaries, combined
  `category_id`+`item_id` filtering, and `session_day_index` population on
  both `end()` and `endWithInjury()` (including the no-op-on-repeat-same-day
  case).
- Backend: unit tests for the dates endpoint across all four filter
  combinations.
- Backend: unit tests for `PATCH /api/sessions/:id` — rejects
  `ended_at <= started_at`; derives duration/end-time correctly from
  either input; recomputes `rest_seconds`; recomputes item/category stats
  correctly for an edit to a non-final session in a category's streak
  chain; skips stats recompute for `ended_in_injury` sessions.
- Backend: unit tests for `DELETE /api/sessions/:id` — recomputes stats
  correctly; removes the `session_day_index` row only when it was the last
  session for that (day, category, item); leaves it when a sibling session
  remains.
- Frontend: unit test the bucketing/dedup logic (given a list of day
  strings, produces the right tiered index with no overlap).
- Frontend: unit test the `lastEdited` shrink-only/full-range policy:
  first edit is shrink-only; immediate re-edit of the same session allows
  the full original range; editing a different session locks the first
  back to shrink-only.
- Frontend: component test that `loadMore()` fires on sentinel visibility
  and appends rather than replaces; that changing a filter resets the list;
  that jumping to a bucket entry reloads from the correct cursor; that the
  kebab menu's Delete requires confirmation before calling the API.
