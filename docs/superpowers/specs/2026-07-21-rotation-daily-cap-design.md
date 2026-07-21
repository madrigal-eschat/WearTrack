# Rotation Categories — One Session Per Day — Design Spec

**Date:** 2026-07-21

## Overview

Rotation categories currently let you start a new session for any available
item at any time, as long as it satisfies the rotation/consecutive-wear-days
rules. This adds a second, independent constraint: **at most one session per
calendar day per rotation category**, regardless of which item. Once a
session has started today, the category shows a "resting" state — visually
identical to a duration category's rest period — with the rest ending at the
next midnight, and no way to override it early.

### Key semantic points

- This is a hard, backend-enforced rule (no override), unlike duration
  categories' overridable rest-period warning.
- Scope is the whole category, not per-item: wearing item A today blocks
  starting item B today too.
- "Today" is determined by the calendar day the session **started**
  (server-local timezone), not when it ended.
- This constraint is independent of, and composes with, the existing
  rotation-availability and consecutive-wear-days rules — all applicable
  rules must pass for a session to start.
- An open (not-yet-ended) session isn't affected by this — the existing
  active-session UI already takes over in that case.

### Out of scope

- Per-user/stored timezone. Midnight is computed from the server process's
  local timezone (`Date` in local mode), consistent with this being a
  self-hosted, single-user app.
- Any change to duration categories' rest/decay/injury behavior.
- Any change to the existing `session_day_index` table or its UTC-based day
  grouping (used for the unrelated Log-tab jump index) — this feature uses
  its own server-local day boundary, computed fresh, not that table.

---

## Backend

### `db/calculations.ts`

New pure function:

```ts
/** Unix timestamp of the next local midnight strictly after `now`. */
export function startOfNextLocalMidnight(now: number): number
```

Implemented via `Date` in local mode: construct a `Date` from `now`, zero out
hours/minutes/seconds/ms, then add one day.

### `db/stores/session-store.ts`

New method:

```ts
/** Most recent session (any item) in the category that started on/after `dayStart` (server-local midnight of "today"). */
findSessionStartedTodayInCategory(categoryId: number, dayStart: number): { started_at: number } | undefined
```

Queries `sessions` joined to `items`, filtering `started_at >= dayStart`,
ordered by `started_at DESC`, limit 1. Includes open sessions in the query
(their `started_at` still counts toward "already had a session today") but
the controller only needs this for the closed-session daily-cap check; the
open-session case is already handled separately by the existing
"category already has an open session" conflict check in `POST /start`.

### `controllers/sessions.ts` — `POST /api/sessions/start`

For `type === 'rotation'` categories, after the existing rotation-availability
check and before calling `sessionStore.start`: compute today's server-local
midnight-to-midnight window (`dayStart = startOfNextLocalMidnight(now) -
86400`), call `findSessionStartedTodayInCategory(categoryId, dayStart)`. If a
session is found, reject with a 400 `ValidationError` ("Category has already
had a session today").

### `controllers/sessions.ts` — `GET /api/sessions/current`

For `type === 'rotation'` categories where `findSessionStartedTodayInCategory`
finds a match: add `resting_until: number` to that category's entry, set to
`startOfNextLocalMidnight(now)`. Omit (or `null`) when no session started
today. This lets the frontend render the countdown without recomputing "is
this today" itself.

---

## Frontend

### `composables/useWear.ts`

`CurrentEntry` gains `resting_until: number | null`.

### `components/ActionPane.vue`

For a rotation category where `entry.resting_until !== null`: render the
existing "Rest" block (`WearProgressBar mode="rest"`, Remaining/Total row)
exactly as duration categories do. Display requirement: `remaining =
resting_until - now`, reaching zero exactly at `resting_until`; `total =
resting_until - <today's session start time>` (the fill fraction shrinks from
full at the moment the session started, to empty at midnight). The session
start time needed for `total` is already available on `entry.items[].
started_at` (today's most recent session, per the existing per-category last
session fields) — no new backend field needed for this half of the
computation.

This entirely replaces the item picker (dropdown/forced-label/Wear button) —
none of that renders while `resting_until !== null`. No rest-warning dialog,
no override button, no way to bypass.

This check takes priority over the consecutive-wear-days lock's forced-label
display: if today's cap is hit, show the rest bar regardless of lock state.

---

## Testing

- **Backend unit:** `startOfNextLocalMidnight` — a few timestamps across a
  day, including one already at exactly midnight.
- **Backend integration:** `POST /start` rejects a second same-item and a
  second different-item session started the same day; accepts a session
  started the next day; `GET /current` returns `resting_until` correctly set
  after a same-day session and `null`/absent otherwise; duration categories
  completely unaffected (no `resting_until` field, no new validation).
- **Frontend:** no dedicated test (matches this component's existing
  posture), verified via hand-trace during implementation, plus a manual
  check in the running dev server since no automated browser access exists in
  this environment.

---

## Migration / rollout

No schema change. Purely additive backend logic + one new optional response
field. No behavior change for `duration` categories.
