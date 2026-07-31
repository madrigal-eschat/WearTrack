# Design: Periodic maintenance reminders while wearing

Date: 2026-07-31

## Overview

Some categories require maintenance while an item is actively worn (e.g.
changing wrist straps, anti-chafing tape). Each category can have a set of
reminder schedules — a duration (`remind_each_seconds`) and free text — shown
behind a "Manage Reminders" button under a "N reminders scheduled" label on
the category row. Reminders fire as push notifications while a session is
active, and are robust to the backend process restarting mid-session.

---

## Scheduling math

Given a schedule's `remind_each_seconds`, a session's `target_wear_seconds`
and `max_wear_seconds` (nullable), and `elapsedSeconds` since the session
started, the number of reminders that should have fired by now is:

```ts
function computeReminderDueCount(
  remindEachSeconds: number,
  targetWearSeconds: number,
  maxWearSeconds: number | null,
  elapsedSeconds: number,
): number {
  if (maxWearSeconds !== null) {
    const n = Math.ceil(maxWearSeconds / remindEachSeconds)
    const interval = maxWearSeconds / n
    return Math.min(n, Math.floor(elapsedSeconds / interval))
  }
  const n = Math.max(1, Math.ceil(targetWearSeconds / remindEachSeconds))
  const firstFire = targetWearSeconds / n
  if (elapsedSeconds < firstFire) {
    return 0
  }
  return 1 + Math.floor((elapsedSeconds - firstFire) / remindEachSeconds)
}
```

- **Session has a max duration**: reminders are spaced evenly so the last one
  lands exactly at `max_wear_seconds` — `n = ceil(max / remind_each)` reminders,
  spaced `max / n` seconds apart.
- **No max duration**: the first reminder fires at
  `target / ceil(target / remind_each)`, then every `remind_each_seconds`
  after, indefinitely for as long as the session stays open.

Rotation categories always have `max_wear_seconds = null`, so they use the
second branch automatically — no special-casing by category type.

This is a pure function (added to `src/backend/src/db/calculations.ts`), unit
tested directly with no DB/time dependency.

---

## Database schema

New migration `012_reminder_schedules.ts`:

```sql
CREATE TABLE reminder_schedules (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id         INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  remind_each_seconds INTEGER NOT NULL,
  text                TEXT NOT NULL
);

CREATE TABLE reminder_state (
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  schedule_id INTEGER NOT NULL REFERENCES reminder_schedules(id) ON DELETE CASCADE,
  fired_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, schedule_id)
);
```

`reminder_state.fired_count` is the only persisted scheduling state. It is
recomputed against `computeReminderDueCount()` on every poller tick rather
than storing an absolute "next fire time" — this is what makes the feature
robust to the server restarting: after a restart, the poller sees the current
elapsed time, recomputes the due count from scratch, and fires the single
outstanding reminder if `dueCount > fired_count`. Multiple missed occurrences
during downtime collapse into one notification (matching the issue's "at that
time, or as soon as possible after" — not a backlog of every missed
reminder).

Deleting a category or ending/deleting a session cascades the relevant rows.

`remind_each_seconds` must be `>= 60` (the poller ticks every 30s; anything
finer isn't reliably observable).

---

## Backend

### Store

`src/backend/src/db/stores/reminder-schedule-store.ts` — `findAllForCategory`,
`find`, `create`, `update`, `delete`, following the shape of
`item-store.ts`.

### Poller (`src/backend/src/events/poller.ts`)

Inside the existing `if (session)` block (session is active), after the
target/overtime checks:

```ts
const schedules = reminderScheduleStore.findAllForCategory(category.id)
for (const schedule of schedules) {
  const state = reminderStateStore.get(session.id, schedule.id)
  const fired = state?.fired_count ?? 0
  const elapsed = now - session.started_at
  const due = computeReminderDueCount(
    schedule.remind_each_seconds,
    session.target_wear_seconds,
    session.max_wear_seconds,
    elapsed,
  )
  if (due > fired) {
    if (shouldEmit) {
      eventBus.emit('reminder_due', {
        category_id: category.id,
        category_name: category.name,
        timestamp: now,
        session_id: session.id,
        schedule_id: schedule.id,
        text: schedule.text,
      })
    }
    reminderStateStore.upsert(session.id, schedule.id, due)
  }
}
```

`shouldEmit` reuses the poller's existing first-run guard (no backfire of
reminders for a session that was already in progress before the poller ever
saw it — same principle as `rest_start`/`decay_start`).

When `row.last_session_id` changes to a new session (existing logic already
detects this), no explicit reminder-state reset is needed since state is
keyed by `session_id`, not carried over.

### Event bus (`src/backend/src/events/bus.ts`)

New event type:

```ts
export interface ReminderDueEvent extends CategoryContext {
  session_id: number;
  schedule_id: number;
  text: string;
}
```

Added to `EventPayloads` as `reminder_due`.

### Notifications (`src/backend/src/notifications/runner.ts`)

New case in `copyFor()`:

```ts
case 'reminder_due': {
  const p = payload as EventPayloads['reminder_due']
  return { title: `Maintenance for ${categoryName}`, body: p.text }
}
```

`reminder_due` added to `NOTIFICATION_EVENTS`. Tag: `category-${category_id}`
(same as other notifications for that category — consistent with the
existing "replace, don't stack" behaviour).

### API — `src/backend/src/controllers/reminder-schedules.ts`

Flat resource, mirroring `items.ts`:

- `GET /api/reminder-schedules?category_id=X` → list for a category
- `POST /api/reminder-schedules` `{ category_id, remind_each_seconds, text }`
  → validates `category_id` exists, `remind_each_seconds >= 60`, `text`
  non-empty
- `PATCH /api/reminder-schedules/:id` `{ remind_each_seconds?, text? }`
- `DELETE /api/reminder-schedules/:id`

Registered in `src/backend/src/server.ts` alongside the other routers.

---

## Frontend

### `useReminderSchedules.ts` composable

Mirrors `useCategories.ts`: `schedules` (per-category cache keyed by
category id), `loadSchedules(categoryId)`, `createSchedule`,
`updateSchedule`, `deleteSchedule`.

### `ReminderSchedulesSheet.vue`

A `k-sheet` modal (same shape as `IconPickerSheet.vue`), opened per-category:

- Header: "Reminders — {category name}", close button.
- List of existing schedules: text + formatted interval (`shortDuration`),
  each with a delete button.
- "+ Add reminder" reveals a `DurationTrigger` (opens the existing
  `DurationPickerSheet` to pick `remind_each_seconds`) and a `TextField` for
  the reminder text, plus Save/Cancel.
- If `useNotifications().isSubscribed` is `false` when the first schedule is
  about to be saved for the account, show an inline banner: "Enable
  notifications to receive maintenance reminders" with an Enable button
  calling the existing `enable()`. Saving proceeds regardless of whether they
  enable — the schedule is stored either way, notifications just won't be
  delivered until enabled.

### `CategoriesSection.vue`

In each category row (`k-list-item`, always visible — not gated behind
Edit), add:

- A label: "{n} reminders scheduled" (fetched via
  `loadSchedules(cat.id)` on mount, alongside categories load).
- A "Manage Reminders" button (small, outline, same style as
  Edit/Delete) opening `ReminderSchedulesSheet.vue` for that category.

---

## Out of scope

- Editing an existing schedule's interval (delete + recreate instead).
- Snoozing or pausing an individual schedule without deleting it.
- Reminders while idle/resting — the issue is explicit: "while wearing" only.
- Per-schedule notification opt-out (all-or-nothing, same as existing push
  notifications).
