# Design: Push Notifications

Date: 2026-06-25

## Overview

Web Push notifications for key wear-cycle events: rest period end, idle-period milestones, decay warning, session target met, and overtime warnings. Single-user, all-or-nothing (no per-category toggles). End-to-end encrypted via the Web Push spec (RFC 8291).

---

## Architecture

Five components:

1. **VAPID keys** — generated once, stored in environment variables. The public key is served to the frontend; the private key signs outbound push requests.
2. **Push subscription** — on permission grant the browser generates a `PushSubscription` (endpoint URL + encryption keys). The frontend POSTs it to the backend, which stores it in `push_subscriptions`. A row present = notifications enabled; empty table = disabled.
3. **Scheduler** — a `setInterval` on the backend ticks every 30s. Each tick derives which notifications are due from live state, checks `sent_notifications` for already-delivered ones, and sends any outstanding via Web Push.
4. **`sent_notifications` table** — deduplication log keyed by `(session_id, type)`. Implicit cancellation: idle-period notifications are keyed off the previous session's ID, so once a new session starts, those notifications simply stop being "due" — no explicit cancel step needed.
5. **Service worker push handler** — a custom SW (vite-plugin-pwa `injectManifest` strategy) listens for the `push` event and calls `showNotification`. The OS-level push infrastructure wakes the SW even when the app is closed.

---

## Notification Types & Timing

Shorthands:
- `rest_end = previous.ended_at + previous.rest_seconds`
- `decay_start = rest_end + category.break_grace_time`
- `halfway = (rest_end + decay_start) / 2`

### Idle-period notifications (keyed off previous session ID)

Only evaluated when no active session exists for the category.

| Type | Fire at | Suppressed if |
|---|---|---|
| `rest_end` | `rest_end` | — |
| `halfway` | `halfway` | — |
| `decay_soon` | `decay_start − 3600` | `fire_at < rest_end + 3600` OR `\|fire_at − halfway\| < 1800` |

The `decay_soon` suppression covers:
- "before rest ends" and "within first hour of idle" are both captured by `fire_at < rest_end + 3600`
- "30 mins either side of halfway" is captured by `|fire_at − halfway| < 1800`

### Active-session notifications (keyed off current session ID)

Only evaluated when an active session exists for the category.

| Type | Fire at | Suppressed if |
|---|---|---|
| `target_met` | `started_at + target_wear_seconds` | — |
| `overtime_warning_30` | `started_at + max_wear_seconds − 1800` | `max` is null OR `fire_at ≤ started_at + 300` |
| `overtime_warning_5` | `started_at + max_wear_seconds − 300` | `max` is null OR `fire_at ≤ started_at + 300` |
| `overtime` | `started_at + max_wear_seconds` | `max` is null |

### Notification text

| Type | Title | Body |
|---|---|---|
| `rest_end` | [Category] wearable | Rest period is over |
| `halfway` | Wear [category] soon | Your idle time is halfway up |
| `decay_soon` | Wear [category] now! | Durations start decaying in 1 hour |
| `target_met` | [Category] target reached! | You can stop when ready |
| `overtime_warning_30` | [Category]: 30 minutes left | End your session before overtime |
| `overtime_warning_5` | Stop wearing [category] | 5 minutes until overtime |
| `overtime` | Stop wearing [category] now! | Your session is in overtime |

---

## Database Schema

New migration with two tables.

```sql
CREATE TABLE push_subscriptions (
  id                INTEGER PRIMARY KEY,
  subscription_json TEXT NOT NULL,
  created_at        INTEGER NOT NULL
);

CREATE TABLE sent_notifications (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL,
  type       TEXT NOT NULL,
  sent_at    INTEGER NOT NULL,
  UNIQUE (session_id, type)
);
```

`push_subscriptions` holds at most one row (single-user). Re-subscribing replaces the existing row.

`sent_notifications` grows at ~7 rows per session. Rows for sessions that ended more than 7 days ago can be pruned, but there is no urgency.

---

## Backend

### File structure

```
src/backend/src/notifications/
  scheduler.ts   — setInterval tick logic + due-notification computation
  sender.ts      — wraps web-push library
  store.ts       — DB access for push_subscriptions and sent_notifications
```

### Scheduler (`scheduler.ts`)

`setInterval(tick, 30_000)` registered at server startup; `tick()` also called immediately on startup.

Each tick:
1. Check `push_subscriptions` — return early if empty.
2. Query live state: all categories + last ended session per category + open sessions per category (reuses existing store methods).
3. For each category, compute due notification types (see timing tables above).
4. Batch-query `sent_notifications` for the relevant session IDs; filter out already-sent types.
5. For each unsent due notification: insert a `sent_notifications` row first (prevents double-send on crash), then call `sender.send()` with payload `{ title, body, tag: \`category-${category.id}\` }`.
6. Log send failures; do not throw (a missed notification is preferable to crashing the scheduler).

### API endpoints

New controller at `src/backend/src/controllers/notifications.ts`:

- `GET /api/notifications/vapid-public-key` → `{ publicKey: string }`
- `POST /api/notifications/subscribe` — upsert the push subscription
- `DELETE /api/notifications/subscribe` — delete the subscription (disables notifications)

### VAPID configuration

Environment variables:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` — a `mailto:` address

The `web-push` library is initialised once at server startup with these values. Keys generated via `npx web-push generate-vapid-keys` and stored in `.env`. If any VAPID variable is absent, the scheduler does not start and `GET /api/notifications/vapid-public-key` returns `{ publicKey: null }`; the rest of the app is unaffected.

---

## Frontend

### Service worker

Switch `vite.config.ts` from the default Workbox strategy to `strategies: 'injectManifest'` with a custom SW at `src/frontend/src/sw.ts`. Workbox still injects the precache manifest; offline caching is unchanged.

Push handler in `sw.ts`:

```ts
self.addEventListener('push', (event) => {
  const { title, body, tag } = event.data.json();
  event.waitUntil(self.registration.showNotification(title, { body, tag }));
});
```

The `tag` field is `category-${category.id}`. Notifications sharing a tag replace each other rather than stacking, so e.g. the 30-minute overtime warning is replaced by the 5-minute warning when it arrives. Notifications for different categories have different tags and stack independently.

### `useNotifications.ts` composable

```
isSupported    — 'Notification' in window && 'PushManager' in window
isConfigured   — true when GET /api/notifications/vapid-public-key returns a non-null publicKey
permission     — reactive Notification.permission
isSubscribed   — true when pushManager.getSubscription() returns a non-null subscription
enable()       — request permission → pushManager.subscribe() → POST to backend (upsert)
disable()      — pushManager.unsubscribe() → DELETE from backend
```

`isSubscribed` is determined from the browser's push manager, not the server, so no `GET /api/notifications/subscribe` endpoint is needed. `enable()` is idempotent — it upserts on the server even if the browser already has a subscription (handles the case where the server lost the subscription).

The VAPID public key is fetched from `GET /api/notifications/vapid-public-key` on composable mount and cached for use by `enable()`.

### Settings UI

A single toggle ("Push notifications") in the existing settings area, bound to `isSubscribed`, calling `enable()`/`disable()`.

- If `!isSupported`: toggle hidden, note shown ("Push notifications are not supported in this browser").
- If `!isConfigured`: toggle hidden, warning shown ("Push notifications are not configured on the server").

---

## Out of scope

- Per-category notification toggles.
- Notification actions (e.g. tapping to open a specific category).
- Notification grouping or badge counts.
- Pruning `sent_notifications` automatically (can be a future maintenance task).
