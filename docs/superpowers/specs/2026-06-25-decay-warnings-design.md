# Design: Decay warnings & rest-period Wear button

Date: 2026-06-25

## Overview

Two related improvements to the home tab's action pane:

1. Show a "Start before" date on idle category rows that have prior wear, plus progressive decay warnings when that date has passed.
2. Grey out (without disabling) the Wear button during a rest period, and show a penalty-aware confirmation dialog if the user taps it anyway.

---

## API changes

`GET /api/sessions/current` gains two fields per category entry, computed from the `previous` session already fetched in that handler.

```ts
decay_start_time: number | null
decay_state: 'none' | 'decaying' | 'fully_decayed'
```

### `decay_start_time`

```
previous.ended_at + previous.rest_seconds + category.break_grace_time
```

`null` when there is no prior non-injury session for the category.

### `decay_state`

Let `daysSinceGrace = Math.floor((now − decay_start_time) / 86400)` and `decayFactor = break_decay_multiplier ** daysSinceGrace`.

| Condition | Value |
|---|---|
| `previous` is null, or `now ≤ decay_start_time` | `'none'` |
| past deadline and `(prev_target + initial_target) × decayFactor > initial_target` | `'decaying'` |
| past deadline and `(prev_target + initial_target) × decayFactor ≤ initial_target` | `'fully_decayed'` |

`daysSinceGrace = 0` (first partial day past the deadline) counts as `'decaying'` since no actual multiplication has been applied yet but the clock is ticking.

The comparison is DM-agnostic: `difficulty_multiplier` cancels out, so the threshold is the same for every item in the category.

---

## Frontend type changes

`CurrentEntry` in `src/frontend/src/composables/useWear.ts`:

```ts
export interface CurrentEntry {
  category: Category;
  item: Item | null;
  session: Session | null;
  items: ItemWithLastSession[];
  decay_start_time: number | null;   // new
  decay_state: 'none' | 'decaying' | 'fully_decayed';  // new
}
```

`fetchCurrent` deserialises from the API response automatically; no other composable changes needed.

---

## UI changes — `ActionPane.vue`

All changes are confined to the idle branch (`v-else` — no active session).

### "Start before" date

Shown below the target/max line when `decay_start_time !== null`. Format: day + short month, no year (e.g. "15 Jan"). Use `toLocaleDateString` with `{ day: 'numeric', month: 'short' }`.

```
Start before: 15 Jan
```

### Decay warning labels

Shown below "Start before", only one at a time:

| `decay_state` | Colour | Text |
|---|---|---|
| `'decaying'` | Orange | ⚠ Durations are decaying |
| `'fully_decayed'` | Red | ⚠ Target and max have returned to initial values |

### Wear button — rest-period grey state

When `restRemainingMinutes(entry) > 0`:
- Add `opacity-60` class to the button (visual grey, not a disabled attribute).
- `:disabled` remains tied only to `!selectedItem[entry.category.id]` (no item selected).
- Click is intercepted: resting → `showRestWarning(entry)`; not resting → existing `onWear(entry)`.

### Rest confirmation dialog

A Konsta `k-dialog` rendered at the bottom of `ActionPane.vue` (single shared instance, toggled by reactive state).

**Title:** Start during rest?

**Body:** "X min of rest remaining. Starting early will halve your target: **Y** instead of the normal value."

- "Y" is the already-computed `expected_target` for the selected item (during rest the backend already returns the penalised value, so no extra calculation needed).
- Rest remaining comes from the existing `restRemainingMinutes()` helper.

**Buttons:** Cancel | Start anyway

"Start anyway" calls `onWear(entry)` as normal.

---

## Out of scope

- No changes to active-session rows.
- No changes to the decay formula itself.
- No year shown in the "Start before" date.
