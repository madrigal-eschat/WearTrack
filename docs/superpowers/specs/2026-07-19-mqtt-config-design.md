# MQTT Config & Event Publishing — Design

## Summary

Add MQTT broker configuration to the Settings panel (host, port, optional
username/password, topic prefix, Home Assistant discovery toggle), and, when
configured, publish JSON messages to the broker on session start/end, rest
start/end, and decay start/finish — each carrying the stats relevant to that
event (target, max, difficulty modifier, category/item names, and for
completed sessions actual duration and rest length, plus risk level, decay
state/percentage, and IDs for correlation).

## Context

- No MQTT/messaging library exists in the repo today. No event bus/observer
  pattern exists in the backend — session/rest/decay transitions are plain
  synchronous function calls (see `src/backend/src/db/stores/session-store.ts`,
  `src/backend/src/db/calculations.ts`).
- The closest existing analogue is the push-notification subsystem
  (`src/backend/src/notifications/`): env-configured, `isConfigured` gate,
  poll-based scheduler (`scheduler.ts` + `runner.ts`, 30s tick) that re-derives
  "what's due" from DB state on every tick rather than subscribing to events.
- Session start/end are discrete DB writes (`session-store.ts:164`,
  `session-store.ts:187`) — natural synchronous hook points.
- Rest and decay have **no discrete event** today; `computeDecay()`
  (`calculations.ts:170-192`) derives `decay_state` (`none` / `decaying` /
  `fully_decayed`) live from `previous.ended_at + rest_seconds + break_grace_time`
  on every read. Detecting "rest just started" / "decay just finished" requires
  a poller that diffs this derived state over time.
- Settings today has no editable config of this shape — the only existing
  field is a push-notification on/off toggle (`src/frontend/src/views/Settings.vue`),
  and there is no localStorage or client-side settings store; everything is
  server-backed via composables (`useNotifications.ts` pattern).
- Form pattern to follow for real fields (not just toggles): `CategoryForm.vue`
  + `src/frontend/src/utils/categoryForm.ts` (form state/validation extracted
  into a plain `.ts` util with a matching `.test.ts`).

## Architecture

Two things share one source of truth for transitions instead of each
re-deriving it independently:

### `src/backend/src/events/` — shared internal event bus (new)

- **`bus.ts`** — a small typed wrapper around Node's `EventEmitter` with
  typed payloads for twelve event names: `session_start`, `session_end`,
  `rest_start`, `rest_end`, `decay_start`, `decay_finish`, `halfway_reached`,
  `decay_soon`, `target_met`, `overtime_warning_30`, `overtime_warning_5`,
  `overtime`. This is the one place in the backend where transitions become
  discrete events; both `mqtt/` and `notifications/` subscribe to it rather
  than each deriving state independently. `notifications/` is a pure
  subscriber now — it runs no polling of its own at all.
- **`poller.ts`** — a single 30s tick (unchanged cadence from today's
  notification scheduler) that, per category, recomputes:
  - rest/decay state (reusing `computeDecay`-style logic, extracted into a
    shared function) → `rest_start`/`rest_end`/`decay_start`/`decay_finish`.
  - the two lead-time thresholds anchored to the *previous session's end*
    (`halfway_reached`: past the midpoint of the current rest period;
    `decay_soon`: within the configured lead time of decay actually
    starting) → `halfway_reached`/`decay_soon`.
  - if the category has an open session, the four lead-time thresholds
    anchored to that *session's start* (`elapsed >= target_wear_seconds`;
    `elapsed >= max_wear_seconds - 1800/-300/-0`, mirroring the exact
    `fire_at` formulas and `overtime_warning_*` suppression conditions from
    today's `scheduler.ts:34-57`) → `target_met`/`overtime_warning_30`/
    `overtime_warning_5`/`overtime`.

  All of the above are diffed against last-known state, emitting the
  corresponding bus event exactly once per transition/threshold-crossing.
  Started from `server.ts` unconditionally (cheap to run even with no
  subscribers configured). Last-known state is **DB-backed, not in-memory**
  (see `event_poller_state` table below) — an in-memory map would forget
  everything on restart and misread an already-decaying category (or a
  threshold already crossed and already notified) as fresh, re-firing an
  event for something that already happened before the restart. A category
  with no row yet is initialized to its current computed state without
  firing any event (avoids backfiring historic transitions on first run).
  `halfway_notified`/`decay_soon_notified` reset to `0` in the same write
  that flips `resting` from `0` to `1` (a new rest cycle starting).
  `target_met_notified`/`overtime_warning_30_notified`/
  `overtime_warning_5_notified`/`overtime_notified` reset to `0` whenever
  the category's open session id differs from the stored `last_session_id`
  (a new session started) — no event fires for the reset itself, only the
  id bookkeeping update, matching the same "baseline, don't backfire" rule.
- `session-store.ts` `start()` and `end()` emit `session_start` /
  `session_end` on the same bus synchronously, right after the DB write —
  one emission point per transition, regardless of who's listening.

### `src/backend/src/mqtt/` — MQTT-specific consumer

- **`config-store.ts`** — new `mqtt_config` DB table (single row): `id`,
  `enabled`, `host`, `port`, `username`, `password`, `topic_prefix`,
  `ha_discovery_enabled`. CRUD used by the Settings API.
- **`client.ts`** — persistent MQTT client using the `mqtt` npm package.
  `initMqtt()` runs at server boot (called from `server.ts`, alongside the
  events poller), reads `mqtt_config` from the DB, and connects immediately
  if `enabled=true` and a host is set — so a stored config survives a server
  restart with no user action needed. Also connects/reconnects whenever
  config is saved with `enabled=true` and a host is set (picking up
  host/port/auth changes without a restart); disconnects on disable or
  config clear; reconnects automatically on drop (library's built-in
  reconnect). Exposes `publish(topic, payload, opts)` and a `getStatus()`
  (`connected` / `disconnected` / `error`) for the Settings UI to poll.
  Plain `mqtt://` only (no TLS) for v1.
- **`events.ts`** — pure functions building JSON payloads per event type
  from the bus event payload (category, item, session, decay state). No DB
  or network access — easy to unit test.
- **`subscriber.ts`** — registers listeners for the six MQTT-published bus
  events (`session_start`/`session_end`/`rest_start`/`rest_end`/
  `decay_start`/`decay_finish` — `halfway_reached`/`decay_soon` are
  notification-only, no MQTT message defined for them) at startup (gated on
  `isConfigured`/`enabled`), builds each payload via `events.ts`, and
  publishes via `client.ts` (QoS 0, not retained).
- **`discovery.ts`** — when `ha_discovery_enabled`, publishes a **retained**
  Home Assistant MQTT discovery config topic per category
  (`homeassistant/sensor/weartrack_<category_id>/config`), describing a
  sensor entity whose state/attributes come from the latest published event
  payload for that category. Republished on category create/update/delete and
  on MQTT config save (so HA re-discovers after a broker change).

### `src/backend/src/notifications/` — existing module, fully refactored

`scheduler.ts` (the `computeDueNotifications` function and its `Candidate`
types), `store.ts`'s `tryMarkSent`/`getSentForSessions`/`getSchedulerState`,
`types.ts`'s `CategorySchedulerState`/`DueNotification`, and the
`sent_notifications` table are **all removed** — every notification type
`scheduler.ts` used to compute (`rest_end`, `halfway` → `halfway_reached`,
`decay_soon`, `target_met`, `overtime_warning_30`, `overtime_warning_5`,
`overtime`) is now an `events/poller.ts`-detected edge on the shared bus.
`decay_start`/`decay_finish` were never notification types and stay
MQTT-only — nothing in `notifications/` subscribes to them.

- `runner.ts` becomes a pure bus subscriber: at startup, if `isConfigured`
  (VAPID env vars set), it registers a listener for each of the seven
  notification-relevant bus events and calls `sender.send()` with that
  event's title/body (same copy `scheduler.ts` used to produce) when it
  fires. No polling, no timer, no dedup logic of its own — `event_poller_state`
  is the single dedup mechanism for the whole backend.
- `store.ts` keeps `getSubscription`/`upsertSubscription`/`deleteSubscription`
  (still needed by `controllers/notifications.ts`) and drops everything
  scheduler-related.
- `NotificationType` (in `types.ts`) is removed — event names are now the
  bus's own event name type, defined once in `events/bus.ts`.

This is new plumbing (no event bus existed before), but it's now a single
shared one for every transition/threshold in the backend, with one DB-backed
dedup table and no independent polling loops left anywhere.

## Data model

```sql
CREATE TABLE mqtt_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  host TEXT,
  port INTEGER NOT NULL DEFAULT 1883,
  username TEXT,
  password TEXT,
  topic_prefix TEXT NOT NULL DEFAULT 'weartrack',
  ha_discovery_enabled INTEGER NOT NULL DEFAULT 0
);
```

Single row (`id = 1`), upserted by the Settings API — same "one config
object" shape as the frontend form.

```sql
CREATE TABLE event_poller_state (
  category_id INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  decay_state TEXT NOT NULL DEFAULT 'none', -- 'none' | 'decaying' | 'fully_decayed'
  resting INTEGER NOT NULL DEFAULT 0,       -- 0/1, is rest currently active
  halfway_notified INTEGER NOT NULL DEFAULT 0,     -- 0/1, halfway_reached fired this rest cycle
  decay_soon_notified INTEGER NOT NULL DEFAULT 0,  -- 0/1, decay_soon fired this rest cycle
  last_session_id INTEGER,                         -- most recent open-session id seen, for reset detection
  target_met_notified INTEGER NOT NULL DEFAULT 0,          -- 0/1, fired for last_session_id
  overtime_warning_30_notified INTEGER NOT NULL DEFAULT 0, -- 0/1, fired for last_session_id
  overtime_warning_5_notified INTEGER NOT NULL DEFAULT 0,  -- 0/1, fired for last_session_id
  overtime_notified INTEGER NOT NULL DEFAULT 0             -- 0/1, fired for last_session_id
);
```

One row per category, written by `events/poller.ts` after each tick.
Durable across restarts by design — see `poller.ts` above. The four
session-anchored `*_notified` columns are reset to `0` (without firing an
event) whenever the category's currently-open session id differs from
`last_session_id`, which is then updated to match.

## Settings panel UI

New "MQTT" section in `Settings.vue`, following the toggle+form pattern:

- `useMqtt.ts` composable: fetches current config (`GET /api/mqtt/config`),
  saves (`PUT /api/mqtt/config`), exposes reactive connection status.
- Fields: enable toggle, Host (text), Port (number, default `1883`),
  Username (text, optional), Password (password field, optional — blank
  means no auth sent, not a separate toggle), Topic prefix (text, default
  `weartrack`), HA discovery toggle.
- Password is write-only: `GET /api/mqtt/config` never echoes the real value
  back (returns blank/masked); `PUT` only overwrites it if a new non-empty
  value is submitted.
- A small status badge (connected / disconnected / error) rendered under the
  form using `client.ts`'s `getStatus()`, so users can verify the broker link
  without checking server logs.

## Message payloads

Topic: `<topic_prefix>/<category-slug>/<event>`
(e.g. `weartrack/gloves/session_start`).

Common fields on every event:

```
event, timestamp (ISO 8601), category_id, category_name,
item_id, item_name, target_wear_seconds, max_wear_seconds,
difficulty_modifier
```

Per-event additions:

| Event | Additional fields |
|---|---|
| `session_start` | `session_id` |
| `session_end` | `session_id`, `actual_duration_seconds`, `rest_seconds`, `risk_level` |
| `rest_start` | `rest_seconds` (total owed) |
| `rest_end` | `rest_seconds`, `elapsed_rest_seconds` |
| `decay_start` | `decay_state`, `decay_full_time` (projected) |
| `decay_finish` | `decay_state`, `decay_percentage` (100) |

All decay-related events include `decay_state`/`decay_percentage` where
meaningful. All events QoS 0, not retained. HA discovery config topics are
the one exception — retained, per Home Assistant's spec.

## Home Assistant discovery

When `ha_discovery_enabled`:

- One retained discovery config topic per category:
  `homeassistant/sensor/weartrack_<category_id>/config`.
- Entity state and attributes reflect the latest published event payload for
  that category. A dedicated `<prefix>/<category-slug>/state` topic (retained)
  holds the latest full event payload for the category; the HA discovery
  config's `state_topic`/`json_attributes_topic` both point here. Every
  event publish (session/rest/decay) also republishes to this state topic in
  addition to its own event topic.
- Republished on every `events/poller.ts` tick (30s) for all current
  categories, rather than hooking into category create/update/delete
  directly — the poller already iterates every category each tick, so this
  covers category changes within one tick without adding a dependency from
  `controllers/categories.ts` into the MQTT module. Publishes are retained
  and idempotent (same content republished is a no-op for subscribers), so
  the extra traffic has no side effect. Also republished immediately when
  the MQTT config itself is saved (covers broker/prefix changes).

## Testing

- `events.ts` payload builders: pure-function unit tests, no DB/network.
- `poller.ts` edge/threshold detection: integration-style tests against the
  real in-memory SQLite DB (seed `event_poller_state` rows directly, same as
  `notifications/controller.test.ts`'s direct-DB-assertion style) asserting
  exactly one event fires per transition across repeated ticks for all
  twelve bus events, that re-running a tick against a row already reflecting
  the post-transition state does not refire the event (the restart-safety
  property), that `halfway_notified`/`decay_soon_notified` reset to `0` when
  a new rest cycle starts (`resting` flips `0` → `1`), and that the four
  session-anchored `*_notified` columns reset to `0` when `last_session_id`
  changes (a new session started) without firing an event for the reset.
- `client.ts`: thin publish interface so tests inject a fake publisher;
  "not configured in test env → skip" convention matches
  `notifications/sender.ts`'s `isConfigured` gate (no real broker in CI).
- `notifications/runner.ts`: replace the old scheduler/due-computation tests
  with tests asserting `sender.send()` is called once per bus event received,
  and not called again on a repeated/duplicate event.
- Settings API (`config-store.ts` + routes): integration tests against the
  real Hono app + in-memory SQLite, same pattern as
  `notifications/controller.test.ts` (assert DB rows after PUT, assert
  password never echoed on GET).

## Out of scope (v1)

- TLS/`mqtts://` support.
- Multi-broker / multi-tenant config (single global config row).
- Retained/QoS-1 delivery for event messages (only HA discovery topics are
  retained).
