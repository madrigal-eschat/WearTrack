# Active-Session Row Layout — Design Spec

**Date:** 2026-07-06

## Overview

Rework the layout of active-session rows in `ActionPane.vue` (Home page).
Today, Worn/Remaining/Target/Max stats sit in the trailing `#after` slot
beside the Stop button, squeezing the progress bar into the narrower `#inner`
slot. This moves the stats under the bar, freeing horizontal space so the
category and item names can share one title line.

Idle (no active session) rows are untouched — this only changes the
`entry.session !== null` branch of the active-session row.

## Layout

Three stacked rows inside the `#inner` slot (replacing today's bar-only
`#inner` + stats-and-button `#after`):

1. **Title line:** category name at today's `.title` size/weight, item name
   inline after it at a smaller/dimmer weight (today's subtitle styling, now
   on the same line instead of its own). **Stop** button trails on this same
   line, right-aligned.
2. **Bar:** full row width (no longer sharing space with stats/button).
   Fill/target-marker logic unchanged.
3. **Stats line:** `Worn · Remaining · Target · Max`, in that order, in a
   flex-wrap row. Wraps first between Remaining and Target when width is
   tight (reproducing today's two-line grouping — Worn+Remaining, then
   Target+Max — on narrow screens); renders as one line on wide screens.

The `#after` slot is no longer used for the active-session branch — Stop
moves into the `#inner` title row.

## Interaction with the lap-counter spec

Independent of [2026-07-06-lap-counter-design.md](2026-07-06-lap-counter-design.md).
The lap badge and glow/sparkle effects render on the bar row; this spec only
repositions surrounding text and the Stop button. No conflicts.

## Testing

- **Component tests:** update `ActionPane.spec.ts` assertions that target the
  old `#after`-slot DOM structure (Worn/Remaining/Target/Max placement, Stop
  button position) to the new structure. Add a case for the stats line
  wrapping behavior at narrow width if feasible with the existing test setup.
- **Visual/manual check:** confirm the stats line wraps between
  Remaining/Target (not elsewhere) at mobile width, and category/item name
  overflow (long names) doesn't break the title+Stop line.

## Out of scope

- Idle-row layout (item picker, Wear button, decay warnings) — unchanged.
- Any behavior change — this is layout only, no new data or calculations.
