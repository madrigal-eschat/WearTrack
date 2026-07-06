# Active-Session Row Layout — Design Spec

**Date:** 2026-07-06

## Overview

Rework the layout of both active-session and idle rows in `ActionPane.vue`
(Home page) for visual parity between the two states. Today, active-session
stats (Worn/Remaining/Target/Max) sit in the trailing `#after` slot beside the
Stop button, squeezing the progress bar into the narrower `#inner` slot; idle
rows have their own different arrangement with rest/decay info as separate
text lines. Both become the same three-row shape: **title line**, **row2**
(bar, or a state bar for idle), **stats line**.

## Active-session row layout

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

### Overdue state

- In the stats line, the `Remaining` value becomes **`Overdue`**, styled
  red-600, in the same position as any other stat value.
- A **"Stop wearing"** call-to-action appears under the title line (in the
  gap between title and bar rows), styled as a prominent warning.

## Idle row layout

Mirrors the active-session shape:

1. **Title line:** category name (prominent, left) + item `<select>` picker +
   **Wear** button trailing right, all on one line (today these are on
   separate lines).
2. **Row2:** state-dependent bar/label, replacing today's separate rest and
   decay text lines. Priority when multiple states could apply: **resting >
   decaying > default**.
3. **Stats line:** `Target | Max` by default (see below for the resting
   override).

### Row2 states

1. **Resting:** `[bed icon] Rest` label + light-grey bar, filling left→right
   as rest elapses (0% at rest start → 100% when rest ends — same fill
   direction as a normal wear bar). Stats line for this state becomes
   `Remaining <rest time left> | Total <rest duration>` — this **replaces**
   `Target | Max` entirely while resting; `Target | Max` return once rest
   ends. The existing "Start during rest?" popover (shown when clicking Wear
   during rest) is unchanged — still explains Target/Max will be larger if
   the user waits out the rest.
2. **Decaying** (not resting): `[decay icon] Decay` label + black bar,
   starting full and un-filling from the left as the decay window elapses.
   The decay bar carries a drop-shadow, giving it a slightly unsettling look
   distinct from every other bar state. Below the bar, a bold black-labelled
   line **"Total decay in `<time left>`"**, styled like a normal duration
   line but bold. Stats line stays `Target | Max` (reflecting decayed
   values). Once fully decayed (bar empty), the line switches to **"Target
   and max have fully decayed"**.
3. **Default** (not resting, not decaying): row2 shows **"Start before
   `<date>`"** (today's decay-start label, relocated here). If there is no
   previous session at all for this category (first-ever use), it instead
   reads **"Start your first session"**. Stats line stays `Target | Max`.

Row2 always reserves its height even when showing the plain "Start before" /
"Start your first session" label, so row height stays consistent across all
idle/active/resting/decaying states.

## Component extraction

The bar and everything that renders on/around it — fill, target marker, lap
badge, glow/sparkle effects (from the lap-counter spec), and the rest/decay
bar variants (this spec) — move into their own component,
`WearProgressBar.vue`, rather than living inline in `ActionPane.vue`. This
keeps `ActionPane.vue` focused on row layout/data-wiring and makes the bar's
visual states independently testable.

Rough props shape (finalized during implementation planning):

```
mode: 'wear' | 'rest' | 'decay'
fillFraction: number        // 0–1
color: string                // item color (wear) or fixed grey/black (rest/decay)
targetMarkerFraction?: number  // wear mode only
lapTier?: number             // 0–4, wear mode only, drives glow/sparkle
```

`ActionPane.vue` computes the mode/fraction/color for each row (active
wearing, resting, decaying) and passes them down; `WearProgressBar.vue` owns
all rendering and animation for the bar itself.

## Interaction with the lap-counter spec

Builds on [2026-07-06-lap-counter-design.md](2026-07-06-lap-counter-design.md).
The lap badge and glow/sparkle effects render inside `WearProgressBar.vue`
(wear mode); this spec positions the component within the row and adds the
rest/decay modes. No conflicts — the lap spec's `lapTier`/badge logic slots
straight into the props shape above.

## Testing

- **Component tests:** new `WearProgressBar.spec.ts` covering each mode
  (wear/rest/decay) in isolation — fill fraction rendering, target marker,
  lap tier glow/sparkle classes, rest/decay colors and fill direction, decay
  drop-shadow. Update `ActionPane.spec.ts` assertions that target the
  old `#after`-slot DOM structure (Worn/Remaining/Target/Max placement, Stop
  button position) to the new structure. Add cases for: stats line wrapping
  behavior at narrow width; overdue state showing "Overdue" + "Stop wearing";
  idle row2 priority ordering (resting > decaying > default); rest-state
  stats swap (Remaining/Total replacing Target/Max); decay bar un-filling and
  the fully-decayed message swap; first-ever-session label.
- **Visual/manual check:** confirm the stats line wraps between
  Remaining/Target (not elsewhere) at mobile width, category/item name
  overflow (long names) doesn't break the title+Stop/title+picker line, and
  rest/decay bars render in colors not selectable via the normal item color
  picker (light grey / black) so they read as distinct system states.

## Out of scope

- Any behavior change to the underlying rest/decay/lap calculations — this
  spec is layout and visual-state-mapping only, reusing existing derived
  values (`restRemainingSeconds`, `entry.decay_start_time`,
  `entry.decay_state`, etc.).
