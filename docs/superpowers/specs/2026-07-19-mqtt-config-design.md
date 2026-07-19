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
  typed payloads for six event names: `session_start`, `session_end`,
  `rest_start`, `rest_end`, `decay_start`, `decay_finish`. This is the one
  place in the backend where transitions become discrete events; both
  `mqtt/` and `notifications/` subscribe to it rather than each deriving
  state independently.
- **`poller.ts`** — a single 30s tick (unchanged cadence from today's
  notification scheduler) that recomputes rest/decay state per category
  (reusing `computeDecay`-style logic, extracted into a shared function) and
  diffs it against last-known state, emitting `rest_start` / `rest_end` /
  `decay_start` / `decay_finish` on the bus exactly once per transition.
  Started from `server.ts` unconditionally (cheap to run even with no
  subscribers configured). Last-known state is **DB-backed, not in-memory**
  (see `event_poller_state` table below) — an in-memory map would forget
  everything on restart and misread an already-decaying category as a fresh
  transition on the next tick, re-firing `decay_start` (and duplicating the
  MQTT/notification side effects) for an event that already happened before
  the restart. A category with no row yet is initialized to its current
  computed state without firing an event (avoids backfiring historic
  transitions on first run).
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
- **`subscriber.ts`** — registers listeners for all six bus events at
  startup (gated on `isConfigured`/`enabled`), builds each payload via
  `events.ts`, and publishes via `client.ts` (QoS 0, not retained).
- **`discovery.ts`** — when `ha_discovery_enabled`, publishes a **retained**
  Home Assistant MQTT discovery config topic per category
  (`homeassistant/sensor/weartrack_<category_id>/config`), describing a
  sensor entity whose state/attributes come from the latest published event
  payload for that category. Republished on category create/update/delete and
  on MQTT config save (so HA re-discovers after a broker change).

### `src/backend/src/notifications/` — existing module, updated

- `scheduler.ts` subscribes to the bus's `rest_end` event instead of
  independently re-deriving that specific transition from
  `previous.ended_at + rest_seconds` — removing the one piece of logic that
  was duplicated between the two modules.
- `halfway` and `decay_soon` notification types are **not** moved to the bus:
  they're lead-time warnings ("decay starts in N minutes"), a different
  computation from edge detection, and stay as scheduler-owned due-checks
  exactly as they work today.

This is new plumbing (no event bus existed before), but it's now a single
shared one rather than one per consumer.

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
  resting INTEGER NOT NULL DEFAULT 0        -- 0/1, is rest currently active
);
```

One row per category, written by `events/poller.ts` after each tick.
Durable across restarts by design — see `poller.ts` above.

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
- Republished whenever: a category is created/updated/deleted, or the MQTT
  config is saved (covers broker/prefix changes so HA re-discovers).

## Testing

- `events.ts` payload builders: pure-function unit tests, no DB/network.
- `poller.ts` edge detection: integration-style tests against the real
  in-memory SQLite DB (seed `event_poller_state` rows directly, same as
  `notifications/controller.test.ts`'s direct-DB-assertion style) asserting
  exactly one `rest_start`/`rest_end`/`decay_start`/`decay_finish` fires per
  transition across repeated ticks, and — specifically — that re-running a
  tick against a row already reflecting the post-transition state does not
  refire the event (the restart-safety property).
- `client.ts`: thin publish interface so tests inject a fake publisher;
  "not configured in test env → skip" convention matches
  `notifications/sender.ts`'s `isConfigured` gate (no real broker in CI).
- Settings API (`config-store.ts` + routes): integration tests against the
  real Hono app + in-memory SQLite, same pattern as
  `notifications/controller.test.ts` (assert DB rows after PUT, assert
  password never echoed on GET).

## Out of scope (v1)

- TLS/`mqtts://` support.
- Multi-broker / multi-tenant config (single global config row).
- Retained/QoS-1 delivery for event messages (only HA discovery topics are
  retained).
