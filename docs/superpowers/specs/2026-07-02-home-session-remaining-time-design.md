# Home tab: remaining time in active session

## Problem

`ActionPane.vue` shows Worn / Target / Max for an active wear session, but not how much time is left. User wants a "remaining" figure visible while a session is active.

## Design

### Layout

Replace the current single-column stack (Worn, Target, Max) in the active-session `#after` block of `ActionPane.vue` (currently `src/frontend/src/components/ActionPane.vue:41-45`) with two rows, each a flex row pairing two label+value items:

- **Row 1:** `Worn <elapsed>` — `Remaining <value>`
- **Row 2:** `Target <target>` — `Max <max>` (Max item omitted if `entry.session.max_wear_seconds === null`, same as today)

Each label+value pair keeps the existing style (`text-xs text-gray-400 uppercase tracking-wide` label, `text-sm text-gray-600` value). Rows use `flex gap-3` (or similar) to place the two pairs side by side; the two rows stack vertically with the existing `mt-0.5` spacing.

### Remaining value logic

Computed from already-available data (`sessionSeconds`, `targetWearSeconds`, `maxWearSeconds`); no backend/API changes.

- `elapsed < target` → show `target − elapsed`, formatted via existing `formatDuration`.
- `target ≤ elapsed` and max is set and `elapsed < max` → show `max − elapsed`.
- `elapsed ≥ max`, OR max is not set and `elapsed ≥ target` → show text `Stop wearing` instead of a duration, styled in a warning color (reuse the red/orange severity convention already used by `rowBg`, e.g. `text-red-500`).

### Testing

- Unit test the new remaining-value helper for the three phases (before target, between target and max, past max/no-max-past-target).
- Component test: active session row renders two rows of two label/value pairs; remaining value updates correctly as elapsed time crosses target and max thresholds; "Stop wearing" renders with warning styling.
